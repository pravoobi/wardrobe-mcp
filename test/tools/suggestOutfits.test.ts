import { describe, expect, it } from "vitest";
import { makeHarness, textOf } from "../helpers.js";
import { suggestOutfits } from "../../src/mcp/tools/suggestOutfits.js";
import { addToWardrobe } from "../../src/mcp/tools/addToWardrobe.js";

describe("suggest_outfits", () => {
  it("returns 1-3 occasion-appropriate options within budget", async () => {
    const { ctx } = await makeHarness();
    const res = await suggestOutfits({ occasion: "sangeet", budget: 8000 }, ctx);
    const sc = res.structuredContent as { options: { price?: number; garmentId: string }[] };
    expect(sc.options.length).toBeGreaterThanOrEqual(1);
    expect(sc.options.length).toBeLessThanOrEqual(3);
    expect(sc.options.every((o) => (o.price ?? 0) <= 8000)).toBe(true);
    expect(textOf(res)).toMatch(/sangeet/i);
  });

  it("prefers owned pieces when they fit the occasion", async () => {
    const { ctx } = await makeHarness();
    await addToWardrobe({ garmentId: "kurta-maroon-velvet" }, ctx);
    const res = await suggestOutfits({ occasion: "sangeet", prefer: "owned" }, ctx);
    const sc = res.structuredContent as { options: { garmentId: string; owned: boolean }[] };
    expect(sc.options.every((o) => o.owned)).toBe(true);
    expect(sc.options[0]?.garmentId).toBe("kurta-maroon-velvet");
  });

  it("is deterministic for the same input", async () => {
    const { ctx } = await makeHarness();
    const a = (await suggestOutfits({ occasion: "reception", budget: 15000 }, ctx))
      .structuredContent as { options: { garmentId: string }[] };
    const b = (await suggestOutfits({ occasion: "reception", budget: 15000 }, ctx))
      .structuredContent as { options: { garmentId: string }[] };
    expect(a.options.map((o) => o.garmentId)).toEqual(b.options.map((o) => o.garmentId));
  });
});
