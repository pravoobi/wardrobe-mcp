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
    expect(hits.some((g) => g.id === "lehenga-pink")).toBe(false); // sangeet but ₹12,500
  });

  it("ranks exact colour match first", () => {
    const hits = searchCatalog({ occasion: "sangeet", color: "magenta" });
    expect(hits[0]?.meta.color).toBe("magenta");
  });

  it("is deterministic", () => {
    const a = searchCatalog({ query: "floral", occasion: "brunch" }).map((g) => g.id);
    const b = searchCatalog({ query: "floral", occasion: "brunch" }).map((g) => g.id);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
