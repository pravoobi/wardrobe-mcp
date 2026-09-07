import { describe, expect, it } from "vitest";
import { makeHarness, textOf } from "../helpers.js";
import { planWeek } from "../../src/mcp/tools/planWeek.js";

describe("plan_week", () => {
  it("never repeats a garment across the week, even for the same occasion twice", async () => {
    const { ctx } = await makeHarness();
    const res = await planWeek(
      {
        events: [
          { day: "Monday", occasion: "sangeet" },
          { day: "Wednesday", occasion: "sangeet" },
          { day: "Friday", occasion: "office" },
        ],
      },
      ctx,
    );
    const sc = res.structuredContent as { days: { day: string; occasion: string; garmentId: string }[]; unresolved: unknown[] };
    expect(sc.days).toHaveLength(3);
    const ids = sc.days.map((d) => d.garmentId);
    expect(new Set(ids).size).toBe(3); // no repeats
    expect(sc.days[0]).toMatchObject({ day: "Monday", occasion: "sangeet" });
    expect(sc.days[1]).toMatchObject({ day: "Wednesday", occasion: "sangeet" });
    expect(sc.days[2]).toMatchObject({ day: "Friday", occasion: "office" });
    expect(sc.unresolved).toEqual([]);
    expect(textOf(res)).toMatch(/Monday/);
  });

  it("reports a day it can't resolve instead of erroring", async () => {
    const { ctx } = await makeHarness();
    const res = await planWeek({ events: [{ day: "Tuesday", occasion: "graduation-ceremony" }] }, ctx);
    const sc = res.structuredContent as { days: unknown[]; unresolved: { day: string; occasion: string }[] };
    expect(sc.days).toEqual([]);
    expect(sc.unresolved).toEqual([{ day: "Tuesday", occasion: "graduation-ceremony" }]);
    expect(textOf(res)).toMatch(/couldn't/i);
  });

  it("is deterministic for the same input", async () => {
    const { ctx } = await makeHarness();
    const events = [
      { day: "Mon", occasion: "sangeet" },
      { day: "Tue", occasion: "sangeet" },
    ];
    const a = (await planWeek({ events }, ctx)).structuredContent as { days: { garmentId: string }[] };
    const b = (await planWeek({ events }, ctx)).structuredContent as { days: { garmentId: string }[] };
    expect(a.days.map((d) => d.garmentId)).toEqual(b.days.map((d) => d.garmentId));
  });
});
