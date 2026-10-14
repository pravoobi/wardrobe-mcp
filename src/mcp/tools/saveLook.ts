import { z } from "zod";
import { requireWrite, type ToolContext } from "../context.js";
import { toolResult, errorResult } from "../responses.js";
import { getGarment } from "../../catalog/catalog.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const saveLookSchema = {
  garmentId: z.string().describe("The garment to save as a look on the user."),
  label: z.string().optional().describe("A short name for the look, e.g. 'sangeet magenta'."),
};

const Input = z.object(saveLookSchema);
export type SaveLookInput = z.infer<typeof Input>;

export async function saveLook(input: SaveLookInput, ctx: ToolContext): Promise<CallToolResult> {
  requireWrite(ctx.user);

  const photo = await ctx.store.getPrimaryPhoto(ctx.user.userId);
  if (!photo) {
    return errorResult("I need a photo of you before I can save a look, and that needs to be added on the account first.");
  }

  const garment = getGarment(input.garmentId);
  const renderKey = ctx.render.cacheKey(photo.id, input.garmentId);

  // Make sure the render exists (cache hit is instant; miss enqueues).
  const preview = await ctx.render.preview({
    userId: ctx.user.userId,
    photoId: photo.id,
    garmentId: input.garmentId,
  });

  const look = await ctx.store.addLook({
    userId: ctx.user.userId,
    garmentId: input.garmentId,
    photoId: photo.id,
    label: input.label,
    renderKey,
  });

  const all = await ctx.store.listLooks(ctx.user.userId);

  // Warm the compare sheet for the two most recent looks so "compare them" is
  // an instant cache hit. Fire-and-forget — never blocks the response.
  if (all.length >= 2) {
    const [a, b] = all.slice(-2);
    ctx.render.warmCompare([
      { renderKey: a!.renderKey, label: a!.label ?? a!.id },
      { renderKey: b!.renderKey, label: b!.label ?? b!.id },
    ]);
  }

  return toolResult({
    text: `Saved as ${look.label ?? look.id}${garment ? ` — ${garment.meta.name}` : ""}. You have ${all.length} saved look${all.length === 1 ? "" : "s"}.`,
    structuredContent: {
      lookId: look.id,
      label: look.label,
      previewUrl: preview.url,
      status: preview.status,
      looks: all.map((l) => ({ lookId: l.id, label: l.label, garmentId: l.garmentId })),
    },
  });
}
