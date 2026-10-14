import { createHash } from "node:crypto";
import sharp from "sharp";
import { config } from "../config.js";
import type { Store } from "../store/Store.js";
import type { RenderJob } from "../store/types.js";
import { getGarment } from "../catalog/catalog.js";
import { getStorage, MemoryStorage, type RenderStorage } from "./storage.js";
import { loadGarmentBytes, loadPhotoBytes } from "./assets.js";
import { renderLookCard, composeCompareSheet, type CompareCard } from "./compose.js";
import type { BrowserWorker } from "./worker.js";

export type RenderMode = "local" | "browser" | "stub";

export interface EnqueueInput {
  userId: string;
  photoId: string;
  garmentId: string;
  /** `Photo.renderSalt` — required so cache keys (and render URLs) aren't
   * guessable from photoId + garmentId alone. */
  renderSalt: string;
}

export interface PreviewResult {
  status: "done" | "rendering";
  url?: string;
  webp?: Buffer;
  retryAfterSeconds?: number;
}

const MAX_INLINE_BYTES = 200 * 1024;

/**
 * In-process render queue with dedupe by cache key. Rendering is **never** in a
 * tool-call path: `preview`/`compare` are cache reads, a miss enqueues and
 * returns `{ status: "rendering" }`.
 *
 * Modes: `local` (default) composes a look card with sharp; `browser` drives the
 * try-on app's WebMCP tools through headless Chromium (see worker.ts); `stub`
 * emits a solid placeholder (tests).
 */
export class RenderQueue {
  private readonly inFlight = new Set<string>();
  private readonly storage: RenderStorage;
  private readonly mode: RenderMode;
  private browser?: Promise<BrowserWorker>;
  // Renders run strictly one at a time, never concurrently. `browser` mode
  // reuses a single long-lived page (see worker.ts) so concurrent calls would
  // race on that one page's state regardless of cause; `local`/`stub` modes
  // have no such hazard, but serializing them too costs nothing measurable
  // and keeps one code path.
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: Store,
    opts: { mode?: RenderMode; storage?: RenderStorage } = {},
  ) {
    this.mode = opts.mode ?? config.renderMode;
    this.storage = opts.storage ?? (this.mode === "stub" ? new MemoryStorage() : getStorage());
  }

  cacheKey(photoId: string, garmentId: string, renderSalt: string): string {
    return createHash("sha256")
      .update(`${photoId} ${garmentId} ${renderSalt} ${config.tryonAppVersion} ${this.mode}`)
      .digest("hex")
      .slice(0, 32);
  }

  async preview(input: EnqueueInput): Promise<PreviewResult> {
    const key = this.cacheKey(input.photoId, input.garmentId, input.renderSalt);
    const job = await this.store.getRenderJob(key);
    if (job?.status === "done" && job.url) {
      const webp = await this.storage.getRender(key);
      return { status: "done", url: job.url, webp: webp && webp.length <= MAX_INLINE_BYTES ? webp : undefined };
    }
    await this.enqueue(input);
    return { status: "rendering", retryAfterSeconds: 5 };
  }

  async enqueue(input: EnqueueInput): Promise<RenderJob> {
    const key = this.cacheKey(input.photoId, input.garmentId, input.renderSalt);
    const existing = await this.store.getRenderJob(key);
    if (existing && existing.status !== "failed") return existing;

    const job: RenderJob = {
      key,
      userId: input.userId,
      photoId: input.photoId,
      garmentId: input.garmentId,
      status: "queued",
      updatedAt: new Date().toISOString(),
    };
    await this.store.upsertRenderJob(job);

    if (!this.inFlight.has(key)) {
      this.inFlight.add(key);
      this.chain = this.chain.then(() => this.run(key, input));
    }
    return job;
  }

  private async run(key: string, input: EnqueueInput): Promise<void> {
    try {
      await this.store.setRenderStatus(key, "running");
      const webp = await this.produce(input);
      const url = await this.storage.putRender(key, webp);
      await this.store.setRenderStatus(key, "done", { url });
    } catch (err) {
      await this.store.setRenderStatus(key, "failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async produce(input: EnqueueInput): Promise<Buffer> {
    const garment = getGarment(input.garmentId);
    const photos = await this.store.listPhotos(input.userId);
    const photo = photos.find((p) => p.id === input.photoId);
    if (!photo) throw new Error(`unknown photo ${input.photoId}`);

    if (this.mode === "stub") {
      return sharp({
        create: { width: 720, height: 960, channels: 3, background: swatch(garment?.meta.color) },
      })
        .webp({ quality: 60 })
        .toBuffer();
    }

    if (this.mode === "browser") {
      const worker = await (this.browser ??= import("./worker.js").then((m) => m.createBrowserWorker()));
      const png = await worker.render({ photoS3Key: photo.s3Key, garmentId: input.garmentId });
      return sharp(png).resize(720, 960, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
    }

    // local
    const [photoBytes, garmentPng] = await Promise.all([
      loadPhotoBytes(photo.s3Key),
      loadGarmentBytes(input.garmentId),
    ]);
    return renderLookCard({
      photo: photoBytes,
      garmentPng,
      name: garment?.meta.name ?? input.garmentId,
      price: garment?.meta.price,
      occasion: garment?.meta.occasion,
      color: garment?.meta.color,
    });
  }

  private compareKey(looks: { renderKey: string }[]): string {
    return createHash("sha256")
      .update(looks.map((l) => l.renderKey).join("|"))
      .digest("hex")
      .slice(0, 32);
  }

  /**
   * Kick off (or no-op) the compose for a set of looks. Synchronous — registers
   * the in-flight key before yielding so `settle()` and dedupe see it. Called
   * fire-and-forget from `save_look` so "compare them" is a warm cache hit.
   */
  warmCompare(looks: { renderKey: string; label: string }[]): void {
    const key = this.compareKey(looks);
    const tag = `cmp:${key}`;
    if (this.inFlight.has(tag)) return;
    this.inFlight.add(tag);
    void (async () => {
      try {
        if (await this.storage.getCompare(key)) return;
        const cards: CompareCard[] = [];
        for (const l of looks) {
          const webp = await this.storage.getRender(l.renderKey);
          if (webp) cards.push({ webp, label: l.label });
        }
        if (cards.length < 2) return;
        await this.storage.putCompare(key, await composeCompareSheet(cards));
      } catch {
        /* leave it for the next compare_looks call to retry */
      } finally {
        this.inFlight.delete(tag);
      }
    })();
  }

  /**
   * Compare sheet as a cache read: a hit returns the URL + bytes; a miss starts
   * the compose in the background and returns `{ status: "composing" }` so the
   * tool call stays under the latency budget.
   */
  async compare(
    looks: { renderKey: string; label: string }[],
  ): Promise<{ status: "done" | "composing"; url?: string; webp?: Buffer; missing: string[]; retryAfterSeconds?: number }> {
    const key = this.compareKey(looks);

    const cached = await this.storage.getCompare(key);
    if (cached) {
      return {
        status: "done",
        url: this.storage.publicCompareUrl(key),
        webp: cached.length <= MAX_INLINE_BYTES ? cached : undefined,
        missing: [],
      };
    }

    const missing: string[] = [];
    let have = 0;
    for (const l of looks) {
      if (await this.storage.getRender(l.renderKey)) have++;
      else missing.push(l.label);
    }
    if (have < 2) return { status: "done", missing };

    this.warmCompare(looks);
    return { status: "composing", retryAfterSeconds: 3, missing: [] };
  }

  /** Resolve once every queued render has finished. For tests and seed scripts
   * that need the cache warm before asserting; not used in the request path. */
  async settle(timeoutMs = 15_000): Promise<void> {
    const start = Date.now();
    while (this.inFlight.size > 0 && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  async renderBytes(key: string): Promise<Buffer | undefined> {
    const buf = await this.storage.getRender(key);
    return buf && buf.length <= MAX_INLINE_BYTES ? buf : undefined;
  }

  async close(): Promise<void> {
    if (this.browser) await (await this.browser).close();
  }
}

function swatch(color?: string): { r: number; g: number; b: number } {
  const map: Record<string, [number, number, number]> = {
    magenta: [200, 40, 120],
    navy: [30, 40, 90],
    green: [40, 120, 70],
    pink: [230, 150, 180],
    red: [170, 40, 50],
    cream: [235, 225, 200],
    indigo: [70, 70, 150],
  };
  const [r, g, b] = map[color ?? ""] ?? [120, 120, 120];
  return { r, g, b };
}
