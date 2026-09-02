import { z } from "zod";
import type { ToolContext } from "../context.js";
import { toolResult, errorResult } from "../responses.js";
import { getGarment } from "../../catalog/catalog.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const previewLookSchema = {
  garmentId: z.string().describe("The garment to render on the user."),
  photoId: z
    .string()
    .optional()
    .describe("Which of the user's photos to use. Defaults to their primary photo."),
};

const Input = z.object(previewLookSchema);
export type PreviewLookInput = z.infer<typeof Input>;

export async function previewLook(
  input: PreviewLookInput,
  ctx: ToolContext,
): Promise<CallToolResult> {
  const garment = getGarment(input.garmentId);
  const name = garment?.meta.name ?? input.garmentId;

  const photo = input.photoId
    ? (await ctx.store.listPhotos(ctx.user.userId)).find((p) => p.id === input.photoId)
    : await ctx.store.getPrimaryPhoto(ctx.user.userId);

  if (!photo) {
    return errorResult(
      "I don't have a photo of you yet. Add one in the Wardrobe companion app and I can show you the look.",
    );
  }

  const result = await ctx.render.preview({
    userId: ctx.user.userId,
    photoId: photo.id,
    garmentId: input.garmentId,
  });

  if (result.status === "rendering") {
    return toolResult({
      text: `Rendering ${name} on you now. Give me a few seconds and ask again.`,
      structuredContent: { status: "rendering", retryAfterSeconds: result.retryAfterSeconds },
    });
  }

  return toolResult({
    text: `Here's ${name} on you. How does it look? Only you can judge the fit.`,
    structuredContent: { status: "done", lookPreviewUrl: result.url, garmentId: input.garmentId },
    imageBase64: result.webp?.toString("base64"),
  });
}
