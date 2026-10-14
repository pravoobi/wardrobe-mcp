import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { config, PROTOCOL_MIN } from "./config.js";
import { mountDiscovery } from "./auth/prm.js";
import { makeBearerAuth } from "./auth/bearer.js";
import { mountOAuth } from "./auth/oauthServer.js";
import { rateLimit } from "./auth/rateLimit.js";
import { getStore } from "./store/index.js";
import { RenderQueue } from "./render/queue.js";
import { createMcpServer } from "./mcp/server.js";
import type { ToolContext } from "./mcp/context.js";
import { mountSimulatorApi } from "./web/simulateApi.js";

// Read at runtime (not `import ... json`), same reasoning as catalog.ts: no
// build step has to copy/transform the file. Path is relative to this file,
// which `rootDir: src` keeps aligned with the repo root in both dev
// (src/server.ts) and the built image (dist/server.js).
const pkgVersion = (
  JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as {
    version: string;
  }
).version;

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

app.get("/healthz", async (c) => {
  // `?deep=1` actually touches the store (a GetItem/SELECT for an id that
  // never exists — cheap, side-effect-free) so App Runner can tell "process
  // is up" apart from "process is up but DynamoDB/S3 creds are broken".
  if (c.req.query("deep")) {
    try {
      await store.getUser("__healthcheck__");
    } catch (err) {
      console.error("deep healthcheck failed:", err);
      return c.json({ ok: false, protocolMin: PROTOCOL_MIN }, 503);
    }
  }
  return c.json({ ok: true, protocolMin: PROTOCOL_MIN });
});

app.get("/version", (c) => c.json({ version: pkgVersion, gitSha: process.env.GIT_SHA ?? "dev" }));

// Rate limits: fixed windows, generous enough for real usage, tight enough to
// cap abuse (unmetered Bedrock calls, OAuth code-exchange brute forcing, …).
// See src/auth/rateLimit.ts and friction log #15.
app.use("/link", rateLimit({ windowMs: 60_000, max: 20, name: "/link" }));
app.use("/oauth/token", rateLimit({ windowMs: 60_000, max: 20, name: "/oauth/token" }));
app.use("/api/simulate/turn", rateLimit({ windowMs: 60_000, max: 20, name: "/api/simulate/turn" }));

// Body size caps — every route here expects small JSON/form payloads
// (OAuth params, a conversation turn, a tool call's arguments), never a file
// upload, so a generous-but-bounded cap costs nothing legitimate and closes
// off unbounded-body abuse.
app.use("/link", bodyLimit({ maxSize: 16 * 1024 }));
app.use("/oauth/token", bodyLimit({ maxSize: 16 * 1024 }));
app.use("/api/simulate/turn", bodyLimit({ maxSize: 512 * 1024 }));
app.use("/mcp", bodyLimit({ maxSize: 1024 * 1024 }));

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

app.on(
  ["POST", "GET", "DELETE"],
  "/mcp",
  rateLimit({ windowMs: 60_000, max: 120, name: "/mcp" }),
  bearerAuth,
  handleMcp,
);

if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    console.log(`wardrobe-mcp on http://${config.host}:${info.port}`);
    console.log(`  MCP endpoint : ${config.canonicalUrl}  (min protocol ${PROTOCOL_MIN})`);
    console.log(`  discovery    : ${config.issuer}/.well-known/oauth-protected-resource`);
  });

  // App Runner (and most orchestrators) send SIGTERM before killing the
  // container on every deploy; without this, in-flight requests get severed
  // mid-response instead of finishing.
  const shutdown = (signal: string): void => {
    console.log(`${signal} received, closing server...`);
    server.close((err) => {
      if (err) console.error("error during shutdown:", err);
      process.exit(err ? 1 : 0);
    });
    // Belt-and-suspenders: if some connection never closes, don't hang forever.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
