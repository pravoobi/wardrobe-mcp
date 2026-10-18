import { describe, expect, it } from "vitest";
import { makeHarness, callUntil } from "../helpers.js";
import { previewLook } from "../../src/mcp/tools/previewLook.js";
import { saveLook } from "../../src/mcp/tools/saveLook.js";
import { listLooks } from "../../src/mcp/tools/listLooks.js";
import { compareLooks } from "../../src/mcp/tools/compareLooks.js";
import { recordReaction } from "../../src/mcp/tools/recordReaction.js";
import { placeOrder } from "../../src/mcp/tools/placeOrder.js";
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
    const reactSc = react.structuredContent as { guidance: string; purchaseUrl?: string };
    expect(reactSc.guidance).toMatch(/purchase link/i);
    expect(reactSc.purchaseUrl).toMatch(/^https:\/\//);

    // Only "love" attaches a purchase link — other reactions don't offer one.
    const reject = await recordReaction({ lookId: "look-2", reaction: "reject" }, ctx);
    expect((reject.structuredContent as { purchaseUrl?: string }).purchaseUrl).toBeUndefined();
  });

  it("place_order is a simulated checkout — no real payment, clearly says so", async () => {
    const { ctx } = await makeHarness();
    await saveLook({ garmentId: "dress-magenta-wrap-01", label: "magenta" }, ctx);

    const order = await placeOrder({ lookId: "look-1", size: "M" }, ctx);
    expect(order.content[0]).toMatchObject({ type: "text" });
    expect((order.content[0] as { text: string }).text).toMatch(/simulated order.*no real payment/i);

    const sc = order.structuredContent as {
      orderId: string;
      size: string;
      deliveryDate: string;
      simulated: boolean;
    };
    expect(sc.orderId).toMatch(/^demo-order-/);
    expect(sc.size).toBe("M");
    expect(sc.deliveryDate.length).toBeGreaterThan(0);
    expect(sc.simulated).toBe(true);
  });

  it("place_order on a missing look id errors instead of guessing", async () => {
    const { ctx } = await makeHarness();
    const order = await placeOrder({ lookId: "look-99", size: "M" }, ctx);
    expect(order.isError).toBe(true);
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
