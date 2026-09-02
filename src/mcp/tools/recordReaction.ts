import { z } from "zod";
import { requireWrite, type ToolContext } from "../context.js";
import { toolResult, errorResult } from "../responses.js";
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

// Same guidance strings as try-on's `await_reaction` — they drive the next turn.
const GUIDANCE: Record<ReactionKind, string> = {
  love: "They love it. Confirm the choice and offer the purchase link.",
  like: "They like it. Ask if they want to see another option or lock this one in.",
  try_another: "Not quite. Suggest the next candidate and preview it.",
  reject: "They rejected it. Drop this direction and ask what to change — colour, fit, or formality.",
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
  return toolResult({
    text: guidance,
    structuredContent: { lookId: input.lookId, reaction: input.reaction, guidance },
  });
}
