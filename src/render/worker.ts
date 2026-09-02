/// <reference lib="dom" />
import type { Browser, Page } from "playwright";
import { config } from "../config.js";

/**
 * The renderer bridge. The try-on pipeline is browser-only (LiteRT.js,
 * WebGPU/Wasm), so we don't port it — we drive the deployed app's **own WebMCP
 * tools** through headless Chromium:
 *
 *   document.modelContext.tools.get("apply_tryon").execute({ garmentId })
 *
 * then snapshot the result canvas. Verified against the live app: `apply_tryon`
 * kicks off async rendering ("rendering in the app preview now") and the
 * composite lands on a `<canvas>`; `save_look` is metadata-only.
 *
 * Headless Chromium has no WebGPU on most hosts, so the app falls back to
 * Wasm/XNNPACK — correct but slow (see docs/friction-log.md). This worker is
 * therefore opt-in via `RENDER_MODE=browser`; the default `local` mode uses the
 * sharp compositor. Either way rendering is never in a tool-call path.
 */
export interface BrowserWorker {
  render(input: { photoS3Key: string; garmentId: string }): Promise<Buffer>;
  close(): Promise<void>;
}

export async function createBrowserWorker(): Promise<BrowserWorker> {
  const { chromium } = await import("playwright");
  const browser: Browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebAssemblyJSPI"],
  });

  const pageUrl = `${config.tryonAppUrl.replace(/\/+$/, "")}/?present`;

  async function freshPage(): Promise<Page> {
    const page = await browser.newPage({ viewport: { width: 960, height: 1400 } });
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(
      () => {
        const mc = (document as unknown as { modelContext?: { tools?: Map<string, unknown> } }).modelContext;
        return (mc?.tools?.size ?? 0) >= 5;
      },
      null,
      { timeout: 60_000 },
    );
    return page;
  }

  return {
    async render({ photoS3Key, garmentId }): Promise<Buffer> {
      const page = await freshPage();
      try {
        // Load the customer's photo. Test photos load by button; uploads go
        // through the file input.
        if (photoS3Key.startsWith("tryon:")) {
          const id = photoS3Key.slice("tryon:".length);
          await page.getByRole("button", { name: id, exact: true }).click({ timeout: 120_000 });
        } else {
          const { loadPhotoBytes } = await import("./assets.js");
          const bytes = await loadPhotoBytes(photoS3Key);
          await page.setInputFiles('input[type="file"][accept*="image"]', {
            name: "photo.jpg",
            mimeType: "image/jpeg",
            buffer: bytes,
          });
        }

        await page.evaluate(async (gid) => {
          const mc = (document as unknown as {
            modelContext: { tools: Map<string, { execute(a: unknown): Promise<unknown> }> };
          }).modelContext;
          return mc.tools.get("apply_tryon")!.execute({ garmentId: gid });
        }, garmentId);

        // Wait for the composite canvas to stop changing.
        await waitForStableCanvas(page, Number(process.env.RENDER_SETTLE_MS ?? 45_000));

        const dataUrl = await page.evaluate(() => {
          const c = Array.from(document.querySelectorAll("canvas")).sort(
            (a, b) => b.width * b.height - a.width * a.height,
          )[0];
          return c ? c.toDataURL("image/png") : null;
        });
        if (!dataUrl) throw new Error("no try-on canvas found after apply_tryon");
        return Buffer.from(dataUrl.split(",")[1]!, "base64");
      } finally {
        await page.close();
      }
    },

    async close(): Promise<void> {
      await browser.close();
    },
  };
}

async function waitForStableCanvas(page: Page, budgetMs: number): Promise<void> {
  const start = Date.now();
  let last = "";
  let stableSince = 0;
  while (Date.now() - start < budgetMs) {
    const sig = await page.evaluate(() => {
      const c = Array.from(document.querySelectorAll("canvas")).sort(
        (a, b) => b.width * b.height - a.width * a.height,
      )[0];
      if (!c) return "";
      const g = c.getContext("2d");
      // Sample a few pixels as a cheap change signature (WebGL canvases: skip).
      try {
        if (!g) return `${c.width}x${c.height}`;
        const pts = [0.3, 0.5, 0.7].map((f) => {
          const d = g.getImageData(Math.floor(c.width * f), Math.floor(c.height * f), 1, 1).data;
          return `${d[0]},${d[1]},${d[2]}`;
        });
        return `${c.width}x${c.height}:${pts.join("|")}`;
      } catch {
        return `${c.width}x${c.height}`;
      }
    });
    if (sig && sig === last) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince > 2_500) return;
    } else {
      stableSince = 0;
      last = sig;
    }
    await page.waitForTimeout(750);
  }
}
