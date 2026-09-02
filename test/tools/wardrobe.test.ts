import { describe, expect, it } from "vitest";
import { makeHarness, textOf } from "../helpers.js";
import { listWardrobe } from "../../src/mcp/tools/listWardrobe.js";
import { addToWardrobe } from "../../src/mcp/tools/addToWardrobe.js";

describe("list_wardrobe / add_to_wardrobe", () => {
  it("explains how to add when empty", async () => {
    const { ctx } = await makeHarness();
    const res = await listWardrobe({}, ctx);
    expect((res.structuredContent as { count: number }).count).toBe(0);
    expect(textOf(res)).toMatch(/companion app|add/i);
  });

  it("adds a catalog item and lists it", async () => {
    const { ctx } = await makeHarness();
    await addToWardrobe({ garmentId: "kurta-navy-silk" }, ctx);
    const res = await listWardrobe({}, ctx);
    const sc = res.structuredContent as { count: number; items: { garmentId: string }[] };
    expect(sc.count).toBe(1);
    expect(sc.items[0]?.garmentId).toBe("kurta-navy-silk");
  });

  it("is idempotent on repeated add", async () => {
    const { ctx } = await makeHarness();
    await addToWardrobe({ garmentId: "kurta-navy-silk" }, ctx);
    await addToWardrobe({ garmentId: "kurta-navy-silk" }, ctx);
    const res = await listWardrobe({}, ctx);
    expect((res.structuredContent as { count: number }).count).toBe(1);
  });

  it("rejects an unknown garment id", async () => {
    const { ctx } = await makeHarness();
    const res = await addToWardrobe({ garmentId: "not-real" }, ctx);
    expect(res.isError).toBe(true);
  });

  it("filters by occasion", async () => {
    const { ctx } = await makeHarness();
    await addToWardrobe({ garmentId: "kurta-navy-silk" }, ctx); // sangeet/wedding/reception
    await addToWardrobe({ garmentId: "kurta-mustard-cotton" }, ctx); // haldi/festive/casual
    const res = await listWardrobe({ occasion: "haldi" }, ctx);
    const sc = res.structuredContent as { items: { garmentId: string }[] };
    expect(sc.items.map((i) => i.garmentId)).toEqual(["kurta-mustard-cotton"]);
  });

  it("requires wardrobe:write scope", async () => {
    const { ctx } = await makeHarness({ scopes: ["wardrobe:read"] });
    await expect(addToWardrobe({ garmentId: "kurta-navy-silk" }, ctx)).rejects.toThrow(/permission/i);
  });
});
