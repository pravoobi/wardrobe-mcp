/** Render one look and write it to disk, for eyeballing.
 *   tsx scripts/render-one.ts <garmentId> [tryonPhotoId]            # local compositor
 *   tsx scripts/render-one.ts <garmentId> [tryonPhotoId] --browser  # real try-on bridge
 */
import { writeFile } from "node:fs/promises";
import { loadPhotoBytes, loadGarmentBytes } from "../src/render/assets.js";
import { renderLookCard } from "../src/render/compose.js";
import { getGarment } from "../src/catalog/catalog.js";

const garmentId = process.argv[2] ?? "dress-magenta-wrap-01";
const photoId = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "photo-01";
const useBrowser = process.argv.includes("--browser");

const t0 = performance.now();
let webp: Buffer;

if (useBrowser) {
  const { createBrowserWorker } = await import("../src/render/worker.js");
  const sharp = (await import("sharp")).default;
  const worker = await createBrowserWorker();
  try {
    const png = await worker.render({ photoS3Key: `tryon:${photoId}`, garmentId });
    webp = await sharp(png).resize(720, 960, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
  } finally {
    await worker.close();
  }
} else {
  const g = getGarment(garmentId);
  const [photo, garmentPng] = await Promise.all([
    loadPhotoBytes(`tryon:${photoId}`),
    loadGarmentBytes(garmentId),
  ]);
  webp = await renderLookCard({
    photo,
    garmentPng,
    name: g?.meta.name ?? garmentId,
    price: g?.meta.price,
    occasion: g?.meta.occasion,
    color: g?.meta.color,
  });
}

const out = `look-${garmentId}${useBrowser ? "-browser" : ""}.webp`;
await writeFile(out, webp);
console.log(`wrote ${out}  ${(webp.length / 1024).toFixed(1)} KB  in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
