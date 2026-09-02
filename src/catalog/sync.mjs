// Re-pull the catalog from the try-on repo so the two never drift.
// Strips try-on render data (anchors, local image path); keeps id / category /
// meta, and synthesizes a product URL (a deep link back into the try-on app).
// Usage: node src/catalog/sync.mjs

import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = "https://raw.githubusercontent.com/pravoobi/try-on/main/src/garments/catalog.json";
const APP = "https://pravoobi.github.io/try-on";
const DEST = fileURLToPath(new URL("./catalog.json", import.meta.url));

const res = await fetch(SRC);
if (!res.ok) {
  console.error(`sync-catalog: GET ${SRC} -> ${res.status}`);
  process.exit(1);
}
const upstream = await res.json();
const current = JSON.parse(readFileSync(DEST, "utf8"));

const list = Array.isArray(upstream) ? upstream : (upstream.garments ?? []);
const garments = list.map((g) => ({
  id: g.id,
  category: g.category,
  meta: {
    name: g.meta?.name ?? g.name,
    color: g.meta?.color ?? g.color,
    occasion: g.meta?.occasion ?? g.occasion ?? [],
    price: g.meta?.price ?? g.price,
    sleeves: g.meta?.sleeves ?? g.sleeves,
    length: g.meta?.length ?? g.length,
    productUrl: `${APP}/?try=${encodeURIComponent(g.id)}`,
  },
}));

const next = {
  _note:
    "Metadata-only copy of try-on/src/garments/catalog.json. Render anchors and image paths are intentionally stripped. Re-pull with `npm run sync-catalog`.",
  source: "https://github.com/pravoobi/try-on/blob/main/src/garments/catalog.json",
  tryonAppVersion: process.env.TRYON_APP_VERSION ?? current.tryonAppVersion ?? "dev",
  usdPerInr: current.usdPerInr ?? 0.012,
  garments,
};

writeFileSync(DEST, JSON.stringify(next, null, 2) + "\n");
console.log(`sync-catalog: wrote ${garments.length} garments to ${DEST}`);
for (const g of garments) console.log(`  ${g.id}  (${g.category}, ${g.meta.color}, ₹${g.meta.price})`);
