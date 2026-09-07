import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
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

  // Must be a ResourceTemplate, not a plain string: passing the string
  // "wardrobe://looks/{lookId}" registers a *fixed* resource whose URI literally
  // contains the braces, so `wardrobe://looks/look-1` returns "not found" and
  // resources/templates/list comes back empty. The template also gives us the
  // parsed `{ lookId }` instead of splitting the URI by hand.
  server.registerResource(
    "look",
    new ResourceTemplate("wardrobe://looks/{lookId}", {
      list: async () => {
        const looks = await ctx.store.listLooks(ctx.user.userId);
        return {
          resources: looks.map((l) => ({
            name: l.label ?? l.id,
            uri: `wardrobe://looks/${l.id}`,
            mimeType: "application/json",
          })),
        };
      },
    }),
    {
      title: "Saved look",
      description: "A single look the customer saved, with its render URL.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const raw = variables.lookId;
      const lookId = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
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
