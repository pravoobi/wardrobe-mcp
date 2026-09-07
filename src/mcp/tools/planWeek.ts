import { z } from "zod";
import type { ToolContext } from "../context.js";
import { toolResult } from "../responses.js";
import { catalog } from "../../catalog/catalog.js";
import { ADJACENT } from "./suggestOutfits.js";
import type { Garment } from "../../store/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const planWeekSchema = {
  events: z
    .array(
      z.object({
        day: z.string().describe("The day or date this outfit is for, e.g. 'Monday' or 'Oct 12'."),
        occasion: z.string().describe("The occasion for that day, e.g. 'office', 'sangeet'."),
      }),
    )
    .min(1)
    .max(7)
    .describe("Up to a week of events, one outfit each — no garment repeats across the plan."),
};

const Input = z.object(planWeekSchema);
export type PlanWeekInput = z.infer<typeof Input>;

interface DayPlan {
  day: string;
  occasion: string;
  garmentId: string;
  name: string;
  reason: string;
  price?: number;
  owned: boolean;
}

const capitalize = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/**
 * One outfit per event, deterministically ranked (occasion fit, then owned),
 * with no garment repeated across the week. Same ranking spirit as
 * `suggest_outfits`, simplified — no budget/colour inputs per the tool spec.
 */
export async function planWeek(input: PlanWeekInput, ctx: ToolContext): Promise<CallToolResult> {
  const wardrobe = await ctx.store.listWardrobe(ctx.user.userId);
  const ownedIds = new Set(wardrobe.map((w) => w.garmentId));
  const pool: Garment[] = [
    ...wardrobe.map((w) => ({ id: w.garmentId, category: w.meta.category, meta: w.meta })),
    ...catalog.filter((g) => !ownedIds.has(g.id)),
  ];

  const used = new Set<string>();
  const days: DayPlan[] = [];
  const unresolved: { day: string; occasion: string }[] = [];

  for (const event of input.events) {
    const occ = event.occasion.toLowerCase();
    const adjacent = new Set(ADJACENT[occ] ?? []);

    let best: { garment: Garment; owned: boolean; score: number; reason: string } | undefined;
    for (const g of pool) {
      if (used.has(g.id)) continue;
      const occs = g.meta.occasion.map((o) => o.toLowerCase());
      const exact = occs.includes(occ);
      const near = !exact && occs.some((o) => adjacent.has(o));
      if (!exact && !near) continue;

      const owned = ownedIds.has(g.id);
      const reasons = [exact ? `made for ${event.occasion}` : `a look that carries a ${event.occasion}`];
      let score = exact ? 100 : 50;
      if (owned) {
        score += 40;
        reasons.push("already in your wardrobe");
      }
      if (!best || score > best.score) {
        best = { garment: g, owned, score, reason: `${capitalize(reasons.join(", "))}.` };
      }
    }

    if (!best) {
      unresolved.push({ day: event.day, occasion: event.occasion });
      continue;
    }
    used.add(best.garment.id);
    days.push({
      day: event.day,
      occasion: event.occasion,
      garmentId: best.garment.id,
      name: best.garment.meta.name,
      reason: best.reason,
      price: best.garment.meta.price,
      owned: best.owned,
    });
  }

  const spoken = days.map((d) => `${d.day}: ${d.name} for the ${d.occasion}`).join("; ");
  const gap = unresolved.length
    ? ` I couldn't find a different option for ${unresolved.map((u) => u.day).join(", ")}.`
    : "";

  return toolResult({
    text: days.length
      ? `Here's your week — ${spoken}.${gap}`
      : `I couldn't put a week together from what's available.${gap}`,
    structuredContent: { days, unresolved },
  });
}
