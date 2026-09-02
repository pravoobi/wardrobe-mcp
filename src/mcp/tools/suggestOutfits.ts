import { z } from "zod";
import type { ToolContext } from "../context.js";
import { toolResult } from "../responses.js";
import { catalog } from "../../catalog/catalog.js";
import type { Garment } from "../../store/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const suggestOutfitsSchema = {
  occasion: z.string().describe("The event, e.g. 'sangeet', 'reception', 'haldi'."),
  budget: z.number().positive().optional().describe("Budget in Indian rupees."),
  color: z.string().optional().describe("Preferred colour, if the user has one."),
  prefer: z
    .enum(["owned", "catalog", "any"])
    .optional()
    .describe("Whether to lean on pieces the user already owns, the catalog, or either."),
};

const Input = z.object(suggestOutfitsSchema);
export type SuggestOutfitsInput = z.infer<typeof Input>;

interface Candidate {
  garment: Garment;
  owned: boolean;
  score: number;
  reason: string;
}

export async function suggestOutfits(
  input: SuggestOutfitsInput,
  ctx: ToolContext,
): Promise<CallToolResult> {
  const occ = input.occasion.toLowerCase();
  const color = input.color?.toLowerCase();
  const prefer = input.prefer ?? "any";

  const wardrobe = await ctx.store.listWardrobe(ctx.user.userId);
  const ownedIds = new Set(wardrobe.map((w) => w.garmentId));

  const pool: Garment[] = [
    ...wardrobe.map((w) => ({
      id: w.garmentId,
      category: w.meta.category,
      meta: w.meta,
    })),
    ...catalog.filter((g) => !ownedIds.has(g.id)),
  ];

  const candidates: Candidate[] = [];
  for (const g of pool) {
    const owned = ownedIds.has(g.id);
    if (prefer === "owned" && !owned) continue;
    if (prefer === "catalog" && owned) continue;

    const occasionMatch = g.meta.occasion.map((o) => o.toLowerCase()).includes(occ);
    const withinBudget = input.budget === undefined || (g.meta.price ?? 0) <= input.budget;
    const colorMatch = color !== undefined && g.meta.color.toLowerCase() === color;

    // Deterministic ranking: occasion match > owned > budget fit > colour.
    let score = 0;
    const reasons: string[] = [];
    if (occasionMatch) {
      score += 100;
      reasons.push(`made for a ${input.occasion}`);
    }
    if (owned) {
      score += 40;
      reasons.push("already in your wardrobe");
    }
    if (withinBudget) {
      score += 20;
      if (input.budget !== undefined) reasons.push("within budget");
    } else {
      score -= 50;
      reasons.push("over budget");
    }
    if (colorMatch) {
      score += 10;
      reasons.push(`your ${input.color}`);
    }
    // Tie-break: cheaper first.
    score += g.meta.price ? Math.max(0, 5 - g.meta.price / 4000) : 0;

    if (!occasionMatch && score < 60) continue;

    candidates.push({
      garment: g,
      owned,
      score,
      reason: capitalize(reasons.join(", ")) + ".",
    });
  }

  const top = candidates
    .sort((a, b) => b.score - a.score || (a.garment.meta.price ?? 0) - (b.garment.meta.price ?? 0))
    .slice(0, 3);

  const primaryPhoto = await ctx.store.getPrimaryPhoto(ctx.user.userId);

  const options = await Promise.all(
    top.map(async (c) => {
      let previewUrl: string | undefined;
      if (primaryPhoto) {
        const key = ctx.render.cacheKey(primaryPhoto.id, c.garment.id);
        const job = await ctx.store.getRenderJob(key);
        if (job?.status === "done") previewUrl = job.url;
      }
      return {
        garmentId: c.garment.id,
        name: c.garment.meta.name,
        reason: c.reason,
        price: c.garment.meta.price,
        priceUsd: c.garment.meta.priceUsd,
        color: c.garment.meta.color,
        owned: c.owned,
        productUrl: c.garment.meta.productUrl,
        previewUrl,
      };
    }),
  );

  const structuredContent = { occasion: input.occasion, budget: input.budget, options };

  if (options.length === 0) {
    return toolResult({
      text: `I don't have a good ${input.occasion} option${input.budget ? ` under ₹${input.budget.toLocaleString("en-IN")}` : ""} right now. Want me to widen the budget?`,
      structuredContent,
    });
  }

  const spoken = options
    .map((o, i) => `${i + 1}. ${o.name}${o.price ? `, ₹${o.price.toLocaleString("en-IN")}` : ""} — ${o.reason}`)
    .join(" ");
  return toolResult({
    text: `Here ${options.length === 1 ? "is one option" : `are ${options.length} options`} for the ${input.occasion}: ${spoken} Say "show me the ${options[0]!.color} one on me" to see it.`,
    structuredContent,
  });
}

const capitalize = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
