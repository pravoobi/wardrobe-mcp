import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Garment } from "../store/types.js";

// Read at runtime (not `import ... json`) so no build step has to copy the file.
const raw = JSON.parse(
  readFileSync(fileURLToPath(new URL("./catalog.json", import.meta.url)), "utf8"),
) as { tryonAppVersion: string; usdPerInr: number; garments: Garment[] };

export const tryonAppVersion: string = raw.tryonAppVersion;
export const usdPerInr: number = raw.usdPerInr;

/** Catalog with `priceUsd` derived once from the fixed demo rate. */
export const catalog: readonly Garment[] = raw.garments.map((g) => ({
  ...g,
  meta: {
    ...g.meta,
    priceUsd: g.meta.price !== undefined ? Math.round(g.meta.price * usdPerInr) : undefined,
  },
}));

const byId = new Map(catalog.map((g) => [g.id, g]));

export function getGarment(id: string): Garment | undefined {
  return byId.get(id);
}
