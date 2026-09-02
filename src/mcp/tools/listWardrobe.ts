import { z } from "zod";
import type { ToolContext } from "../context.js";
import { toolResult } from "../responses.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const listWardrobeSchema = {
  category: z.string().optional().describe("Filter by garment category, e.g. 'kurta-set'."),
  occasion: z.string().optional().describe("Filter by occasion, e.g. 'sangeet'."),
  color: z.string().optional().describe("Filter by colour, e.g. 'navy'."),
};

const Input = z.object(listWardrobeSchema);
export type ListWardrobeInput = z.infer<typeof Input>;

export async function listWardrobe(
  input: ListWardrobeInput,
  ctx: ToolContext,
): Promise<CallToolResult> {
  const items = await ctx.store.listWardrobe(ctx.user.userId);
  const norm = (s: string) => s.toLowerCase();

  const filtered = items.filter((it) => {
    if (input.category && norm(it.meta.category) !== norm(input.category)) return false;
    if (input.color && norm(it.meta.color) !== norm(input.color)) return false;
    if (input.occasion && !it.meta.occasion.map(norm).includes(norm(input.occasion))) return false;
    return true;
  });

  const structuredContent = {
    count: filtered.length,
    items: filtered.map((it) => ({
      garmentId: it.garmentId,
      name: it.meta.name,
      category: it.meta.category,
      color: it.meta.color,
      occasion: it.meta.occasion,
      price: it.meta.price,
      priceUsd: it.meta.priceUsd,
      source: it.source,
    })),
  };

  if (items.length === 0) {
    return toolResult({
      text: "Your wardrobe is empty. Add pieces by saying \"add the navy kurta to my wardrobe\", or upload your own in the Wardrobe companion app.",
      structuredContent,
    });
  }
  if (filtered.length === 0) {
    return toolResult({
      text: "Nothing in your wardrobe matches that. Try a different colour or occasion.",
      structuredContent,
    });
  }

  const names = filtered.slice(0, 3).map((it) => it.meta.name).join(", ");
  return toolResult({
    text: `You have ${filtered.length} matching ${filtered.length === 1 ? "piece" : "pieces"}: ${names}${filtered.length > 3 ? ", and more" : ""}.`,
    structuredContent,
  });
}
