import { z } from "zod";
import type { ToolContext } from "../context.js";
import { toolResult, errorResult } from "../responses.js";
import { getGarment } from "../../catalog/catalog.js";
import { publicUrlForKey } from "../../render/storage.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const compareLooksSchema = {
  lookIds: z
    .array(z.string())
    .min(2)
    .max(3)
    .describe("Two or three saved look ids to place side by side."),
};

const Input = z.object(compareLooksSchema);
export type CompareLooksInput = z.infer<typeof Input>;

export async function compareLooks(
  input: CompareLooksInput,
  ctx: ToolContext,
): Promise<CallToolResult> {
  const found = [];
  const missing = [];
  for (const id of input.lookIds) {
    const look = await ctx.store.getLook(ctx.user.userId, id);
    if (look) found.push(look);
    else missing.push(id);
  }

  if (found.length < 2) {
    return errorResult(
      `I need at least two saved looks to compare. Missing: ${missing.join(", ")}.`,
      { missing },
    );
  }

  const compareUrl = await ctx.render.compareUrl(found.map((l) => l.renderKey));

  const looks = found.map((l) => ({
    lookId: l.id,
    label: l.label,
    name: getGarment(l.garmentId)?.meta.name,
    previewUrl: publicUrlForKey(l.renderKey),
  }));

  const names = looks.map((l) => l.label ?? l.name ?? l.lookId).join(" vs ");
  return toolResult({
    text: `Here's ${names} side by side.${missing.length ? ` I couldn't find ${missing.join(", ")}.` : ""} Which one do you want to go with?`,
    structuredContent: { compareUrl, looks, missing },
  });
}
