import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { config, PROTOCOL_MIN } from "./config.js";
import { mountDiscovery } from "./auth/prm.js";
import { makeBearerAuth } from "./auth/bearer.js";
import { mountOAuth } from "./auth/oauthServer.js";
import { getStore } from "./store/index.js";
import { RenderQueue } from "./render/queue.js";
import { createMcpServer } from "./mcp/server.js";
import type { ToolContext } from "./mcp/context.js";
import { mountSimulatorApi } from "./web/simulateApi.js";

const store = getStore();
const render = new RenderQueue(store);
const bearerAuth = makeBearerAuth(store);

export const app = new Hono();

// Bearer-token auth (not cookies), so a wildcard origin is safe — every route
// still enforces its own auth regardless of who's asking. Without this, any
// browser-based MCP client on a different origin (MCP Inspector's web UI,
// found the hard way — its POST /mcp failed with an opaque "Failed to fetch",
// no preflight handler, no Access-Control-Allow-Origin anywhere) can't
// connect at all, even though curl/server-side clients work fine.
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Accept", "Mcp-Protocol-Version", "Mcp-Session-Id"],
    exposeHeaders: ["Mcp-Session-Id"],
  }),
);

app.get("/healthz", (c) => c.json({ ok: true, protocolMin: PROTOCOL_MIN }));

mountDiscovery(app);
mountOAuth(app, store);

// Rendered looks (dev). Prod serves these from CloudFront.
app.use("/renders/*", serveStatic({ root: config.localRenderDir, rewriteRequestPath: (p) => p.replace(/^\/renders/, "") }));

// Phase 5: the simulated Alexa+ web app — a real MCP client + OAuth 2.1 PKCE
// flow in the browser, talking to this same server's /mcp over Streamable HTTP.
app.use("/simulator", serveStatic({ path: "./web/simulator.html" }));
app.use("/simulator/*", serveStatic({ root: "./web", rewriteRequestPath: (p) => p.replace(/^\/simulator/, "") }));
mountSimulatorApi(app, bearerAuth);

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
