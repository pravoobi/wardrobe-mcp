import { z } from "zod";
import { requireRead, type ToolContext } from "../context.js";
import { toolResult } from "../responses.js";
import { searchCatalog as runSearch } from "../../catalog/searchCatalog.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const searchCatalogSchema = {
  query: z.string().optional().describe("Free-text search over name, colour and occasion."),
  occasion: z.string().optional().describe("Occasion the outfit is for, e.g. 'sangeet'."),
  color: z.string().optional().describe("Preferred colour."),
  category: z.string().optional().describe("Garment category, e.g. 'sherwani'."),
  maxPrice: z.number().positive().optional().describe("Budget ceiling in Indian rupees."),
};

const Input = z.object(searchCatalogSchema);
export type SearchCatalogInput = z.infer<typeof Input>;

export async function searchCatalog(
  input: SearchCatalogInput,
  ctx: ToolContext,
): Promise<CallToolResult> {
  requireRead(ctx.user);

  const hits = runSearch(input).slice(0, 5);

  const structuredContent = {
    count: hits.length,
    results: hits.map((g) => ({
      garmentId: g.id,
      name: g.meta.name,
      category: g.category,
      color: g.meta.color,
      occasion: g.meta.occasion,
      price: g.meta.price,
      priceUsd: g.meta.priceUsd,
      productUrl: g.meta.productUrl,
    })),
  };

  if (hits.length === 0) {
    return toolResult({
      text: "I couldn't find anything matching that in the catalog. Try a wider budget or a different occasion.",
      structuredContent,
    });
  }

  const top = hits[0]!;
  const priceStr =
    top.meta.price !== undefined ? ` at ₹${top.meta.price.toLocaleString("en-IN")}` : "";
  return toolResult({
    text: `Top match: ${top.meta.name}${priceStr}. I found ${hits.length} option${hits.length === 1 ? "" : "s"} in total.`,
    structuredContent,
  });
}
