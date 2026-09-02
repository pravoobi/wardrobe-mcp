import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./context.js";
import { errorResult } from "./responses.js";

import { listWardrobe, listWardrobeSchema } from "./tools/listWardrobe.js";
import { searchCatalog, searchCatalogSchema } from "./tools/searchCatalog.js";
import { suggestOutfits, suggestOutfitsSchema } from "./tools/suggestOutfits.js";
import { previewLook, previewLookSchema } from "./tools/previewLook.js";
import { saveLook, saveLookSchema } from "./tools/saveLook.js";
import { listLooks, listLooksSchema } from "./tools/listLooks.js";
import { compareLooks, compareLooksSchema } from "./tools/compareLooks.js";
import { recordReaction, recordReactionSchema } from "./tools/recordReaction.js";
import { addToWardrobe, addToWardrobeSchema } from "./tools/addToWardrobe.js";

/**
 * The whole tool contract in one place. Names follow the try-on WebMCP tools so
 * "same contract, new transport" is literally true. Descriptions are written for
 * a voice assistant — they say what to say next.
 *
 * FROZEN at end of Phase 2. `test/fixtures/tools-list.json` asserts no drift.
 */
export function registerWardrobeTools(server: McpServer, ctx: ToolContext): void {
  const tool = <S extends Record<string, unknown>>(
    name: string,
    description: string,
    schema: S,
    annotations: { readOnlyHint?: boolean; idempotentHint?: boolean },
    handler: (input: never, ctx: ToolContext) => Promise<import("@modelcontextprotocol/sdk/types.js").CallToolResult>,
  ): void => {
    server.registerTool(
      name,
      { description, inputSchema: schema as never, annotations: { title: name, ...annotations } },
      (async (args: unknown) => {
        try {
          return await handler(args as never, ctx);
        } catch (err) {
          return errorResult(err instanceof Error ? err.message : String(err));
        }
      }) as never,
    );
  };

  tool(
    "list_wardrobe",
    "List the clothes the customer owns or has saved. Filter by category, occasion or colour. If it comes back empty, tell them how to add pieces — by voice ('add the navy kurta') or in the Wardrobe companion app.",
    listWardrobeSchema,
    { readOnlyHint: true },
    listWardrobe,
  );

  tool(
    "search_catalog",
    "Search the shoppable catalog by occasion, colour, category, budget or free text. Prices are in Indian rupees; a US-dollar figure is included too. Read the top one or two options aloud and offer to show them on the customer.",
    searchCatalogSchema,
    { readOnlyHint: true, idempotentHint: true },
    searchCatalog,
  );

  tool(
    "suggest_outfits",
    "Recommend up to three outfits for an occasion, ranked deterministically (occasion fit, then what they own, then budget, then colour). Each option has a one-line reason you can say verbatim. After listing them, offer to show one on the customer with preview_look.",
    suggestOutfitsSchema,
    { readOnlyHint: true },
    suggestOutfits,
  );

  tool(
    "preview_look",
    "Show a garment rendered on the customer's own photo. If it returns 'rendering', tell them 'give me a few seconds and ask again' and move on. After showing a preview, ask how it looks — only the customer can judge the fit.",
    previewLookSchema,
    {},
    previewLook,
  );

  tool(
    "save_look",
    "Save the current garment as a named look so it can be compared or bought later. Confirm the label back to the customer.",
    saveLookSchema,
    {},
    saveLook,
  );

  tool(
    "list_looks",
    "List the looks the customer has saved this session, with their labels.",
    listLooksSchema,
    { readOnlyHint: true },
    listLooks,
  );

  tool(
    "compare_looks",
    "Put two or three saved looks side by side in one image. Missing ids are reported, not treated as errors. After showing it, ask which one they want to go with.",
    compareLooksSchema,
    { readOnlyHint: true },
    compareLooks,
  );

  tool(
    "record_reaction",
    "Record how the customer felt about a look (love, like, try_another, reject). Use the returned guidance to decide what to do next.",
    recordReactionSchema,
    {},
    recordReaction,
  );

  tool(
    "add_to_wardrobe",
    "Add a catalog garment to the customer's wardrobe. This also starts rendering it on their photos in the background so future previews are instant.",
    addToWardrobeSchema,
    {},
    addToWardrobe,
  );
}
