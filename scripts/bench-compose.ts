import { renderLookCard, composeCompareSheet } from "../src/render/compose.js";
import { loadPhotoBytes, loadGarmentBytes } from "../src/render/assets.js";
import { getGarment } from "../src/catalog/catalog.js";
const mk = async (gid: string, pid: string) => {
  const [p, gp] = await Promise.all([loadPhotoBytes("tryon:" + pid), loadGarmentBytes(gid)]);
  const g = getGarment(gid)!;
  return renderLookCard({ photo: p, garmentPng: gp, name: g.meta.name, price: g.meta.price, occasion: g.meta.occasion, color: g.meta.color });
};
const a = await mk("dress-magenta-wrap-01", "photo-01");
const b = await mk("dress-navy-floral-01", "photo-02");
for (let i = 0; i < 4; i++) {
  const t = performance.now();
  const s = await composeCompareSheet([{ webp: a, label: "magenta" }, { webp: b, label: "navy" }]);
  console.log(`compose ${(performance.now() - t).toFixed(0)}ms  ${(s.length / 1024).toFixed(0)}KB`);
}
