import { describe, expect, it } from "vitest";
import { makeHarness, callUntil } from "../helpers.js";
import { previewLook } from "../../src/mcp/tools/previewLook.js";
import { saveLook } from "../../src/mcp/tools/saveLook.js";
import { listLooks } from "../../src/mcp/tools/listLooks.js";
import { compareLooks } from "../../src/mcp/tools/compareLooks.js";
import { recordReaction } from "../../src/mcp/tools/recordReaction.js";
import type { ToolContext } from "../../src/mcp/context.js";

const compareDone = (ctx: ToolContext, ids: string[]) =>
  callUntil<{ status: string }>(
    () => compareLooks({ lookIds: ids }, ctx),
    (sc) => sc.status === "done",
  );

describe("look flow", () => {
  it("preview then save then list then compare then react", async () => {
    const { ctx, render } = await makeHarness();

    const p1 = await previewLook({ garmentId: "dress-magenta-wrap-01" }, ctx);
    expect((p1.structuredContent as { status: string }).status).toMatch(/rendering|done/);
    await render.settle();

    const p2 = await previewLook({ garmentId: "dress-magenta-wrap-01" }, ctx);
    expect((p2.structuredContent as { status: string }).status).toBe("done");
    expect((p2.structuredContent as { lookPreviewUrl: string }).lookPreviewUrl).toMatch(/\/renders\/.+\.webp$/);

    const s1 = await saveLook({ garmentId: "dress-magenta-wrap-01", label: "magenta" }, ctx);
    const s2 = await saveLook({ garmentId: "dress-navy-floral-01", label: "navy" }, ctx);
    expect((s1.structuredContent as { lookId: string }).lookId).toBe("look-1");
    expect((s2.structuredContent as { lookId: string }).lookId).toBe("look-2");
    await render.settle();

    const list = await listLooks({}, ctx);
    expect((list.structuredContent as { count: number }).count).toBe(2);

    const cmp = await compareDone(ctx, ["look-1", "look-2"]);
    const sc = cmp.structuredContent as { compareUrl: string; missing: string[] };
    expect(sc.compareUrl).toContain("/renders/compare/");
    expect(sc.missing).toEqual([]);

    const react = await recordReaction({ lookId: "look-1", reaction: "love" }, ctx);
    expect((react.structuredContent as { guidance: string }).guidance).toMatch(/purchase link/i);
  });

  it("compare reports missing ids instead of erroring when 2+ resolve", async () => {
    const { ctx, render } = await makeHarness();
    await saveLook({ garmentId: "dress-magenta-wrap-01" }, ctx);
    await saveLook({ garmentId: "dress-navy-floral-01" }, ctx);
    await render.settle();
    const cmp = await compareDone(ctx, ["look-1", "look-2", "look-9"]);
    expect(cmp.structuredContent).toMatchObject({ status: "done" });
    expect((cmp.structuredContent as { missing: string[] }).missing).toEqual(["look-9"]);
  });

  it("preview_look errors without a photo", async () => {
    const { ctx } = await makeHarness({ withPhoto: false });
    const res = await previewLook({ garmentId: "dress-navy-floral-01" }, ctx);
    expect(res.isError).toBe(true);
  });
});
