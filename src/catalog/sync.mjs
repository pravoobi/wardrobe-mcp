// Re-pull the catalog from the try-on repo so the two never drift.
// Strips try-on anchor data; keeps id / category / meta only.
// Usage: node src/catalog/sync.mjs

import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC =
  "https://raw.githubusercontent.com/pravoobi/try-on/main/src/garments/catalog.json";
const DEST = fileURLToPath(new URL("./catalog.json", import.meta.url));

const res = await fetch(SRC);
if (!res.ok) {
  console.error(`sync-catalog: GET ${SRC} -> ${res.status}`);
  process.exit(1);
}
const upstream = await res.json();
const current = JSON.parse(readFileSync(DEST, "utf8"));

const garments = (upstream.garments ?? upstream).map((g) => ({
  id: g.id,
  category: g.category,
  meta: {
    name: g.meta?.name ?? g.name,
    color: g.meta?.color ?? g.color,
    occasion: g.meta?.occasion ?? g.occasion ?? [],
    price: g.meta?.price ?? g.price,
    sleeves: g.meta?.sleeves ?? g.sleeves,
    length: g.meta?.length ?? g.length,
    productUrl: g.meta?.productUrl ?? g.productUrl,
  },
}));

const next = {
  ...current,
  tryonAppVersion: upstream.version ?? upstream.tryonAppVersion ?? current.tryonAppVersion,
  garments,
};

writeFileSync(DEST, JSON.stringify(next, null, 2) + "\n");
console.log(`sync-catalog: wrote ${garments.length} garments to ${DEST}`);
