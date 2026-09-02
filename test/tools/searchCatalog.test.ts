import { describe, expect, it } from "vitest";
import { searchCatalog } from "../../src/catalog/searchCatalog.js";

describe("searchCatalog", () => {
  it("treats occasion as a hard filter", () => {
    const hits = searchCatalog({ occasion: "sangeet" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((g) => g.meta.occasion.includes("sangeet"))).toBe(true);
  });

  it("respects maxPrice", () => {
    const hits = searchCatalog({ occasion: "sangeet", maxPrice: 7000 });
    expect(hits.every((g) => (g.meta.price ?? 0) <= 7000)).toBe(true);
    expect(hits.some((g) => g.id === "kurta-navy-silk")).toBe(false); // 7499
  });

  it("ranks exact colour match above text-only match", () => {
    const hits = searchCatalog({ occasion: "sangeet", color: "magenta" });
    expect(hits[0]?.meta.color).toBe("magenta");
  });

  it("is deterministic", () => {
    const a = searchCatalog({ query: "kurta", occasion: "festive" }).map((g) => g.id);
    const b = searchCatalog({ query: "kurta", occasion: "festive" }).map((g) => g.id);
    expect(a).toEqual(b);
  });
});
