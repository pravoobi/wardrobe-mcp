import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./context.js";
import { registerWardrobeTools } from "./registerTools.js";
import { registerWardrobeResources } from "./resources.js";
import { registerWardrobePrompts } from "./prompts.js";

/** A fresh MCP server bound to one authenticated caller. Stateless HTTP means
 * one of these per request — cheap, since registration is just closures. */
export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: "wardrobe-mcp", version: "0.1.0" },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions:
        "This server is a customer's wardrobe and stylist memory. Every tool is a fast structured lookup. Read the `text` field aloud; use `structuredContent` for detail and image URLs.",
    },
  );

  registerWardrobeTools(server, ctx);
  registerWardrobeResources(server, ctx);
  registerWardrobePrompts(server);

  return server;
}
