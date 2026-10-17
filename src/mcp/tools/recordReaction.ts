import { z } from "zod";
import { requireWrite, type ToolContext } from "../context.js";
import { toolResult, errorResult } from "../responses.js";
import { getGarment } from "../../catalog/catalog.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ReactionKind } from "../../store/types.js";

export const recordReactionSchema = {
  lookId: z.string().describe("The saved look the user is reacting to."),
  reaction: z
    .enum(["love", "like", "try_another", "reject"])
    .describe("How the user felt about the look on them."),
  note: z.string().optional().describe("Anything the user said about why."),
};

const Input = z.object(recordReactionSchema);
export type RecordReactionInput = z.infer<typeof Input>;

// Speakable replies — per the tool contract, `text` must be something Alexa+ can read
// aloud verbatim, not an instruction for an LLM to act on. `structuredContent.guidance`
// keeps the same semantic meaning (same four cases as try-on's `await_reaction`) for a
// client that wants to reason about what to do next.
const GUIDANCE: Record<ReactionKind, string> = {
  love: "Loved it — I'll get you the purchase link for this one.",
  like: "Glad you like it. Want to see another option, or should we lock this one in?",
  try_another: "No problem, let's see the next option.",
  reject: "Got it — want to try a different colour, fit, or something more formal?",
};

export async function recordReaction(
  input: RecordReactionInput,
  ctx: ToolContext,
): Promise<CallToolResult> {
  requireWrite(ctx.user);

  const look = await ctx.store.getLook(ctx.user.userId, input.lookId);
  if (!look) return errorResult(`I don't have a saved look called "${input.lookId}".`);

  await ctx.store.addReaction({
    id: `r-${Date.now()}-${input.lookId}`,
    userId: ctx.user.userId,
    lookId: input.lookId,
    kind: input.reaction,
    note: input.note,
    at: new Date().toISOString(),
  });

  const guidance = GUIDANCE[input.reaction];
  const purchaseUrl = input.reaction === "love" ? getGarment(look.garmentId)?.meta.productUrl : undefined;

  return toolResult({
    text: guidance,
    structuredContent: {
      lookId: input.lookId,
      reaction: input.reaction,
      guidance,
      ...(purchaseUrl ? { purchaseUrl } : {}),
    },
  });
}
