import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { config, PROTOCOL_MIN } from "./config.js";
import { mountDiscovery } from "./auth/prm.js";
import { bearerAuth } from "./auth/bearer.js";
import { getStore } from "./store/index.js";
import { RenderQueue } from "./render/queue.js";
import { createMcpServer } from "./mcp/server.js";
import type { ToolContext } from "./mcp/context.js";

const store = getStore();
const render = new RenderQueue(store);

export const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true, protocolMin: PROTOCOL_MIN }));

mountDiscovery(app);

// Rendered looks (dev). Prod serves these from CloudFront.
app.use("/renders/*", serveStatic({ root: config.localRenderDir, rewriteRequestPath: (p) => p.replace(/^\/renders/, "") }));

async function handleMcp(c: import("hono").Context): Promise<Response> {
  const user = c.get("user");
  const ctx: ToolContext = { store, render, user };

  const mcp = createMcpServer(ctx);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no Mcp-Session-Id affinity
    enableJsonResponse: true,
  });
  await mcp.connect(transport);

  const incoming = c.env.incoming as IncomingMessage;
  const outgoing = c.env.outgoing as ServerResponse;
  const body = c.req.method === "POST" ? await c.req.json().catch(() => undefined) : undefined;

  outgoing.on("close", () => {
    void transport.close();
    void mcp.close();
  });

  await transport.handleRequest(incoming, outgoing, body);
  return RESPONSE_ALREADY_SENT;
}

app.on(["POST", "GET", "DELETE"], "/mcp", bearerAuth, handleMcp);

if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    console.log(`wardrobe-mcp on http://${config.host}:${info.port}`);
    console.log(`  MCP endpoint : ${config.canonicalUrl}  (min protocol ${PROTOCOL_MIN})`);
    console.log(`  discovery    : ${config.issuer}/.well-known/oauth-protected-resource`);
  });
}
