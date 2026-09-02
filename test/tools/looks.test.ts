import { describe, expect, it } from "vitest";
import { makeHarness } from "../helpers.js";
import { previewLook } from "../../src/mcp/tools/previewLook.js";
import { saveLook } from "../../src/mcp/tools/saveLook.js";
import { listLooks } from "../../src/mcp/tools/listLooks.js";
import { compareLooks } from "../../src/mcp/tools/compareLooks.js";
import { recordReaction } from "../../src/mcp/tools/recordReaction.js";

const settle = () => new Promise((r) => setTimeout(r, 50));

describe("look flow", () => {
  it("preview then save then list then compare then react", async () => {
    const { ctx } = await makeHarness();

    const p1 = await previewLook({ garmentId: "kurta-magenta-bandhani" }, ctx);
    // First call is a cache miss -> rendering; stub worker completes fast.
    expect((p1.structuredContent as { status: string }).status).toMatch(/rendering|done/);
    await settle();

    const s1 = await saveLook({ garmentId: "kurta-magenta-bandhani", label: "magenta" }, ctx);
    const s2 = await saveLook({ garmentId: "kurta-navy-silk", label: "navy" }, ctx);
    expect((s1.structuredContent as { lookId: string }).lookId).toBe("look-1");
    expect((s2.structuredContent as { lookId: string }).lookId).toBe("look-2");

    const list = await listLooks({}, ctx);
    expect((list.structuredContent as { count: number }).count).toBe(2);

    const cmp = await compareLooks({ lookIds: ["look-1", "look-2"] }, ctx);
    expect(cmp.isError).toBeFalsy();
    expect((cmp.structuredContent as { compareUrl: string }).compareUrl).toContain("/renders/compare/");

    const react = await recordReaction({ lookId: "look-1", reaction: "love" }, ctx);
    expect((react.structuredContent as { guidance: string }).guidance).toMatch(/purchase link/i);
  });

  it("compare reports missing ids instead of erroring when 2+ resolve", async () => {
    const { ctx } = await makeHarness();
    await saveLook({ garmentId: "kurta-magenta-bandhani" }, ctx);
    await saveLook({ garmentId: "kurta-navy-silk" }, ctx);
    const cmp = await compareLooks({ lookIds: ["look-1", "look-2", "look-9"] }, ctx);
    expect(cmp.isError).toBeFalsy();
    expect((cmp.structuredContent as { missing: string[] }).missing).toEqual(["look-9"]);
  });

  it("preview_look errors without a photo", async () => {
    const { ctx } = await makeHarness({ withPhoto: false });
    const res = await previewLook({ garmentId: "kurta-navy-silk" }, ctx);
    expect(res.isError).toBe(true);
  });
});
