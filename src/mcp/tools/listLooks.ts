import { z } from "zod";
import type { ToolContext } from "../context.js";
import { toolResult } from "../responses.js";
import { getGarment } from "../../catalog/catalog.js";
import { publicUrlForKey } from "../../render/storage.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const listLooksSchema = {};

const Input = z.object(listLooksSchema);
export type ListLooksInput = z.infer<typeof Input>;

export async function listLooks(_input: ListLooksInput, ctx: ToolContext): Promise<CallToolResult> {
  const looks = await ctx.store.listLooks(ctx.user.userId);

  const structuredContent = {
    count: looks.length,
    looks: looks.map((l) => ({
      lookId: l.id,
      label: l.label,
      garmentId: l.garmentId,
      name: getGarment(l.garmentId)?.meta.name,
      previewUrl: publicUrlForKey(l.renderKey),
    })),
  };

  if (looks.length === 0) {
    return toolResult({
      text: "You haven't saved any looks yet. Preview an outfit and say \"save that\".",
      structuredContent,
    });
  }

  const labels = looks.map((l) => l.label ?? l.id).join(", ");
  return toolResult({
    text: `You have ${looks.length} saved look${looks.length === 1 ? "" : "s"}: ${labels}.`,
    structuredContent,
  });
}
