import { z } from "zod";
import type { ToolContext } from "../context.js";
import { toolResult, errorResult } from "../responses.js";
import { getGarment } from "../../catalog/catalog.js";
import { publicUrlForKey } from "../../render/storage.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Look } from "../../store/types.js";

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
  const found: Look[] = [];
  const notFound: string[] = [];
  for (const id of input.lookIds) {
    const look = await ctx.store.getLook(ctx.user.userId, id);
    if (look) found.push(look);
    else notFound.push(id);
  }

  if (found.length < 2) {
    return errorResult(
      `I need at least two saved looks to compare. Missing: ${notFound.join(", ")}.`,
      { missing: notFound },
    );
  }

  const labelFor = (l: (typeof found)[number]): string =>
    l.label ?? getGarment(l.garmentId)?.meta.name ?? l.id;

  const compare = await ctx.render.compare(
    found.map((l) => ({ renderKey: l.renderKey, label: labelFor(l) })),
  );

  const looks = found.map((l) => ({
    lookId: l.id,
    label: l.label,
    name: getGarment(l.garmentId)?.meta.name,
    previewUrl: publicUrlForKey(l.renderKey),
  }));

  const names = found.map(labelFor).join(" vs ");

  if (compare.status === "composing") {
    return toolResult({
      text: `Putting ${names} side by side — ask me to compare them again in a moment.`,
      structuredContent: {
        status: "composing",
        retryAfterSeconds: compare.retryAfterSeconds,
        looks,
        missing: notFound,
      },
    });
  }

  const missing = [...notFound, ...compare.missing];
  return toolResult({
    text: `Here's ${names} side by side.${notFound.length ? ` I couldn't find ${notFound.join(", ")}.` : ""} Which one do you want to go with?`,
    structuredContent: { status: "done", compareUrl: compare.url, looks, missing },
    imageBase64: compare.webp?.toString("base64"),
  });
}
