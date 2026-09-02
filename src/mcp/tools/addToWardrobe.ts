import { z } from "zod";
import { requireWrite, type ToolContext } from "../context.js";
import { toolResult, errorResult } from "../responses.js";
import { getGarment } from "../../catalog/catalog.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const addToWardrobeSchema = {
  garmentId: z.string().describe("The catalog garment id to add, e.g. 'kurta-navy-silk'."),
};

const Input = z.object(addToWardrobeSchema);
export type AddToWardrobeInput = z.infer<typeof Input>;

export async function addToWardrobe(
  input: AddToWardrobeInput,
  ctx: ToolContext,
): Promise<CallToolResult> {
  requireWrite(ctx.user);

  const garment = getGarment(input.garmentId);
  if (!garment) {
    return errorResult(`I don't have a garment with id "${input.garmentId}" in the catalog.`);
  }

  await ctx.store.addWardrobeItem({
    id: `w-${ctx.user.userId}-${garment.id}`,
    userId: ctx.user.userId,
    garmentId: garment.id,
    source: "catalog",
    addedAt: new Date().toISOString(),
    meta: { ...garment.meta, category: garment.category },
  });

  // Background pre-render for every photo the user has — never in the request path.
  const photos = await ctx.store.listPhotos(ctx.user.userId);
  for (const photo of photos) {
    void ctx.render.enqueue({ userId: ctx.user.userId, photoId: photo.id, garmentId: garment.id });
  }

  const items = await ctx.store.listWardrobe(ctx.user.userId);
  return toolResult({
    text: `Added ${garment.meta.name} to your wardrobe. You now have ${items.length} ${items.length === 1 ? "piece" : "pieces"}.`,
    structuredContent: {
      added: { garmentId: garment.id, name: garment.meta.name },
      wardrobeCount: items.length,
      items: items.map((it) => ({ garmentId: it.garmentId, name: it.meta.name })),
    },
  });
}
