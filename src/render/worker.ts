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
    // `channel: "chromium"` is load-bearing, not cosmetic. Playwright's default
    // headless uses `chromium_headless_shell`, which ships with no GPU stack at
    // all: `navigator.gpu` exists but `requestAdapter()` returns null, the try-on
    // app never gets a WebGPU device, and its test-photo buttons stay `disabled`
    // forever — the page just sits there with no error, no failed request, and no
    // model download ever starting. The full Chrome-for-Testing binary has the
    // graphics stack, gets an adapter, and the buttons enable in ~3s.
    // Measured 2026-09-07: headless shell = stuck >6min; channel:chromium = 3s.
    // Note: `--use-angle=swiftshader` does NOT help here — it actively prevents
    // adapter creation. The flags below are incidental; the channel is the fix.
    channel: "chromium",
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebAssemblyJSPI"],
  });

  const pageUrl = `${config.tryonAppUrl.replace(/\/+$/, "")}/?present`;

  async function newPage(): Promise<Page> {
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

  // Reuse ONE page across every render() call instead of a fresh page per
  // call — model load is the expensive part of the try-on pipeline, so
  // reopening it per garment is wasteful. Track which photo is currently
  // loaded so we only click the test-photo button when it's actually
  // changing (see friction log #4b for the full debugging trail behind
  // this shape).
  let page: Promise<Page> | undefined;
  let loadedPhotoKey: string | undefined;

  return {
    async render({ photoS3Key, garmentId }): Promise<Buffer> {
      const p = await (page ??= newPage());
      if (photoS3Key !== loadedPhotoKey) {
        // Load the customer's photo. Test photos load by button; uploads go
        // through the file input.
        if (photoS3Key.startsWith("tryon:")) {
          const id = photoS3Key.slice("tryon:".length);
          await p.getByRole("button", { name: id, exact: true }).click({ timeout: 120_000 });
        } else {
          const { loadPhotoBytes } = await import("./assets.js");
          const bytes = await loadPhotoBytes(photoS3Key);
          await p.setInputFiles('input[type="file"][accept*="image"]', {
            name: "photo.jpg",
            mimeType: "image/jpeg",
            buffer: bytes,
          });
        }
        loadedPhotoKey = photoS3Key;
        // Let the photo-load handler settle before the first apply_tryon.
        // Without this, the very first render on a freshly-loaded photo can
        // fire while the pipeline is still initializing for that photo, and
        // every apply_tryon after it silently keeps rendering against that
        // half-initialized state — same wrong (stale) canvas forever, no
        // error. See friction log #4b.
        await p.waitForTimeout(1_500);
      }

      await p.evaluate(async (gid) => {
        const mc = (document as unknown as {
          modelContext: { tools: Map<string, { execute(a: unknown): Promise<unknown> }> };
        }).modelContext;
        return mc.tools.get("apply_tryon")!.execute({ garmentId: gid });
      }, garmentId);

      // Fixed wait for the try-on pipeline to finish compositing onto the
      // canvas. There's no DOM signal to poll for completion, so this is a
      // flat sleep rather than a wait-for-condition (see friction log #4b).
      await p.waitForTimeout(6_000);

      const dataUrl = await p.evaluate(() => {
        const c = Array.from(document.querySelectorAll("canvas")).sort(
          (a, b) => b.width * b.height - a.width * a.height,
        )[0];
        return c ? c.toDataURL("image/png") : null;
      });
      if (!dataUrl) throw new Error("no try-on canvas found after apply_tryon");
      return Buffer.from(dataUrl.split(",")[1]!, "base64");
    },

    async close(): Promise<void> {
      await browser.close();
    },
  };
}
