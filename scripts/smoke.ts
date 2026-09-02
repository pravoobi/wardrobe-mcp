/**
 * End-to-end smoke: boots the server in-process, connects a real MCP client
 * over Streamable HTTP, asserts the negotiated protocol version, and runs the
 * sangeet flow. Run: npm run smoke
 */
process.env.NODE_ENV = "test"; // stop src/server.ts from auto-listening; we serve() here
process.env.STORE ??= "sqlite";
process.env.SQLITE_PATH = ":memory:";
process.env.PORT ??= "3999";
process.env.MCP_CANONICAL_URL = `http://localhost:${process.env.PORT}/mcp`;
process.env.PUBLIC_RENDER_BASE_URL = `http://localhost:${process.env.PORT}/renders`;

const PROTOCOL_MIN = "2025-11-25";
const BASE = `http://localhost:${process.env.PORT}`;
const TOKEN = "Bearer dev_praveen";

async function main(): Promise<void> {
  const { serve } = await import("@hono/node-server");
  const { app } = await import("../src/server.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/streamableHttp.js"
  );
  const server = serve({ fetch: app.fetch, port: Number(process.env.PORT), hostname: "127.0.0.1" });
  await waitFor(`${BASE}/healthz`);

  // --- 401 shape: no token -> 401 with NO WWW-Authenticate header ---
  const noAuth = await fetch(`${BASE}/mcp`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
  assert(noAuth.status === 401, `expected 401, got ${noAuth.status}`);
  assert(!noAuth.headers.has("www-authenticate"), "401 must NOT carry WWW-Authenticate");
  console.log("✓ unauthenticated POST /mcp -> 401 without WWW-Authenticate");

  // --- discovery ---
  const prm = (await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json()) as Record<string, unknown>;
  assert(prm.resource === process.env.MCP_CANONICAL_URL, "PRM resource mismatch");
  const as = (await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json()) as Record<string, string[]>;
  assert(
    Array.isArray(as.code_challenge_methods_supported) && as.code_challenge_methods_supported.includes("S256"),
    "AS metadata must advertise S256",
  );
  console.log("✓ discovery documents present (resource + S256)");

  // --- seed a demo user directly in the store ---
  await seedDemo();

  // --- MCP client ---
  const client = new Client({ name: "smoke", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
    requestInit: { headers: { Authorization: TOKEN } },
  });
  await client.connect(transport);

  const negotiated = (transport as unknown as { protocolVersion?: string }).protocolVersion;
  console.log(`  negotiated protocol version: ${negotiated}`);
  assert(!!negotiated && negotiated >= PROTOCOL_MIN, `protocol ${negotiated} < ${PROTOCOL_MIN}`);

  const { tools } = await client.listTools();
  console.log(`✓ tools/list -> ${tools.map((t) => t.name).join(", ")}`);
  assert(tools.length === 9, `expected 9 tools, got ${tools.length}`);

  const t0 = performance.now();
  const suggest = await client.callTool({
    name: "suggest_outfits",
    arguments: { occasion: "sangeet", budget: 8000 },
  });
  const ms = performance.now() - t0;
  const sc = suggest.structuredContent as { options: unknown[] };
  console.log(`✓ suggest_outfits sangeet <8000 -> ${sc.options.length} options in ${ms.toFixed(1)}ms`);
  console.log(`  "${(suggest.content as { text: string }[])[0]?.text}"`);
  assert(sc.options.length >= 1 && sc.options.length <= 3, "expected 1-3 options");
  assert(ms < 500, `tool latency ${ms.toFixed(1)}ms exceeds 500ms budget`);

  const first = (sc.options as { garmentId: string }[])[0]!;
  const preview = await client.callTool({ name: "preview_look", arguments: { garmentId: first.garmentId } });
  console.log(`✓ preview_look -> ${(preview.structuredContent as { status: string }).status}`);

  const save = await client.callTool({ name: "save_look", arguments: { garmentId: first.garmentId, label: "sangeet pick" } });
  console.log(`✓ save_look -> ${(save.structuredContent as { lookId: string }).lookId}`);

  await client.close();
  server.close();
  console.log("\nSMOKE OK");
}

async function seedDemo(): Promise<void> {
  const { getStore } = await import("../src/store/index.js");
  const { RenderQueue } = await import("../src/render/queue.js");
  const { catalog } = await import("../src/catalog/catalog.js");
  const store = getStore();
  const render = new RenderQueue(store);
  await store.upsertUser({ id: "praveen", displayName: "Praveen", createdAt: new Date().toISOString() });
  await store.addPhoto({ id: "photo-1", userId: "praveen", s3Key: "seed/p.jpg", width: 768, height: 1152, isPrimary: true });
  for (const g of catalog) await render.enqueue({ userId: "praveen", photoId: "photo-1", garmentId: g.id });
  await new Promise((r) => setTimeout(r, 150));
}

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
}

async function waitFor(url: string, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server never came up at ${url}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
