import { catalog } from "./catalog.js";
import type { Garment } from "../store/types.js";

/**
 * Ported from try-on/src/webmcp/searchCatalog.ts — same ranking semantics, new
 * caller. Pure and deterministic: no LLM, no network. Alexa+ does the
 * conversational reasoning on top of this.
 */
export interface CatalogQuery {
  query?: string;
  occasion?: string;
  color?: string;
  category?: string;
  maxPrice?: number;
}

export interface CatalogHit {
  garment: Garment;
  score: number;
}

const norm = (s: string): string => s.toLowerCase().trim();

export function searchCatalog(q: CatalogQuery): Garment[] {
  const terms = q.query ? norm(q.query).split(/\s+/).filter(Boolean) : [];
  const wantOccasion = q.occasion ? norm(q.occasion) : undefined;
  const wantColor = q.color ? norm(q.color) : undefined;
  const wantCategory = q.category ? norm(q.category) : undefined;

  const hits: CatalogHit[] = [];

  for (const g of catalog) {
    if (q.maxPrice !== undefined && (g.meta.price ?? Infinity) > q.maxPrice) continue;
    if (wantCategory && norm(g.category) !== wantCategory) continue;

    const haystack = norm(
      [g.meta.name, g.meta.color, g.category, ...g.meta.occasion].join(" "),
    );

    let score = 0;
    if (wantOccasion) {
      if (g.meta.occasion.map(norm).includes(wantOccasion)) score += 5;
      else continue; // occasion is a hard filter when supplied
    }
    if (wantColor) {
      if (norm(g.meta.color) === wantColor) score += 3;
      else if (haystack.includes(wantColor)) score += 1;
    }
    for (const t of terms) {
      if (norm(g.meta.name).includes(t)) score += 2;
      else if (haystack.includes(t)) score += 1;
    }
    // Cheaper items rank slightly higher on ties (budget-conscious demo).
    score += g.meta.price ? Math.max(0, 1 - g.meta.price / 20000) : 0;

    if (score > 0 || (!wantOccasion && !wantColor && terms.length === 0)) {
      hits.push({ garment: g, score });
    }
  }

  return hits
    .sort((a, b) => b.score - a.score || (a.garment.meta.price ?? 0) - (b.garment.meta.price ?? 0))
    .map((h) => h.garment);
}
