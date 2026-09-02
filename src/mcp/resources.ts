import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./context.js";
import { catalog, getGarment } from "../catalog/catalog.js";
import { publicUrlForKey } from "../render/storage.js";

export function registerWardrobeResources(server: McpServer, ctx: ToolContext): void {
  server.registerResource(
    "catalog",
    "wardrobe://catalog",
    {
      title: "Shoppable catalog",
      description: "Read-only JSON of every garment the customer could buy.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(catalog, null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    "look",
    "wardrobe://looks/{lookId}",
    {
      title: "Saved look",
      description: "A single look the customer saved, with its render URL.",
      mimeType: "application/json",
    },
    async (uri) => {
      const lookId = uri.href.split("/").pop() ?? "";
      const look = await ctx.store.getLook(ctx.user.userId, lookId);
      const body = look
        ? {
            lookId: look.id,
            label: look.label,
            garmentId: look.garmentId,
            name: getGarment(look.garmentId)?.meta.name,
            previewUrl: publicUrlForKey(look.renderKey),
            createdAt: look.createdAt,
          }
        : { error: `No look "${lookId}"` };
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(body, null, 2) }],
      };
    },
  );
}
