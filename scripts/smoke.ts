/**
 * End-to-end smoke: boots the server in-process, connects a real MCP client
 * over Streamable HTTP, and runs the full sangeet flow from a cold seed —
 * suggest → preview → save → preview → compare → react — asserting the 401
 * shape, the negotiated protocol version, and that every image-returning tool
 * answers from cache in < 100 ms. Run: npm run smoke
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_ENV = "test"; // stop src/server.ts from auto-listening; we serve() here
process.env.STORE ??= "sqlite";
process.env.SQLITE_PATH = ":memory:";
process.env.PORT ??= "3999";
process.env.MCP_CANONICAL_URL = `http://localhost:${process.env.PORT}/mcp`;
process.env.PUBLIC_RENDER_BASE_URL = `http://localhost:${process.env.PORT}/renders`;
process.env.RENDER_MODE ??= "local"; // exercise the real sharp compositor
process.env.LOCAL_RENDER_DIR = mkdtempSync(join(tmpdir(), "wardrobe-renders-"));

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

  // --- 401 shape ---
  const noAuth = await fetch(`${BASE}/mcp`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
  assert(noAuth.status === 401, `expected 401, got ${noAuth.status}`);
  assert(!noAuth.headers.has("www-authenticate"), "401 must NOT carry WWW-Authenticate");
  console.log("✓ unauthenticated POST /mcp -> 401 without WWW-Authenticate");

  // --- discovery ---
  const prm = (await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json()) as Record<string, unknown>;
  assert(prm.resource === process.env.MCP_CANONICAL_URL, "PRM resource mismatch");
  const as = (await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json()) as Record<string, string[]>;
  assert(as.code_challenge_methods_supported?.includes("S256"), "AS metadata must advertise S256");
  console.log("✓ discovery documents present (resource + S256)");

  // --- OAuth 2.1: authorize -> consent -> token -> use ---
  await oauthLoop();

  // --- cold seed: demo user + whole-catalog pre-render ---
  const rendered = await seedDemo();
  console.log(`✓ cold seed: ${rendered} looks pre-rendered (mode ${process.env.RENDER_MODE})`);

  // --- MCP client ---
  const client = new Client({ name: "smoke", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
    requestInit: { headers: { Authorization: TOKEN } },
  });
  await client.connect(transport);

  const negotiated = (transport as unknown as { protocolVersion?: string }).protocolVersion;
  assert(!!negotiated && negotiated >= PROTOCOL_MIN, `protocol ${negotiated} < ${PROTOCOL_MIN}`);
  console.log(`✓ negotiated protocol ${negotiated}`);

  const { tools } = await client.listTools();
  assert(tools.length === 11, `expected 11 tools, got ${tools.length}`);
  console.log(`✓ tools/list -> ${tools.length} tools`);

  const timed = async (name: string, args: Record<string, unknown>) => {
    const t0 = performance.now();
    const res = await client.callTool({ name, arguments: args });
    return { res, ms: performance.now() - t0 };
  };

  // suggest
  const suggest = await timed("suggest_outfits", { occasion: "sangeet", budget: 8000 });
  const opts = (suggest.res.structuredContent as { options: { garmentId: string; color: string }[] }).options;
  console.log(`✓ suggest_outfits -> ${opts.length} options in ${suggest.ms.toFixed(0)}ms`);
  console.log(`  "${(suggest.res.content as { text: string }[])[0]?.text}"`);
  assert(opts.length >= 1 && opts.length <= 3, "expected 1-3 options");
  assert(suggest.ms < 500, `suggest_outfits ${suggest.ms.toFixed(0)}ms > 500ms`);

  const magenta = opts.find((o) => o.color === "magenta") ?? opts[0]!;
  const other = opts.find((o) => o.garmentId !== magenta.garmentId) ?? opts[0]!;

  // preview (cache hit, must be fast + carry an image)
  {
    const { res, ms } = await timed("preview_look", { garmentId: magenta.garmentId });
    const sc = res.structuredContent as { status: string; lookPreviewUrl?: string };
    const hasImage = (res.content as { type: string }[]).some((c) => c.type === "image");
    console.log(`✓ preview_look ${magenta.garmentId} -> ${sc.status} in ${ms.toFixed(0)}ms (image block: ${hasImage})`);
    assert(sc.status === "done", `expected cache hit, got ${sc.status}`);
    assert(ms < 100, `preview_look ${ms.toFixed(0)}ms > 100ms`);
    assert(hasImage, "preview_look should return an inline image block");
    const img = await fetch(sc.lookPreviewUrl!);
    assert(img.ok && (img.headers.get("content-type") ?? "").includes("webp"), "preview URL must serve a webp");
  }

  // save two, compare
  const s1 = await client.callTool({ name: "save_look", arguments: { garmentId: magenta.garmentId, label: "magenta" } });
  const s2 = await client.callTool({ name: "save_look", arguments: { garmentId: other.garmentId, label: other.color } });
  const l1 = (s1.structuredContent as { lookId: string }).lookId;
  const l2 = (s2.structuredContent as { lookId: string }).lookId;
  console.log(`✓ save_look x2 -> ${l1}, ${l2}`);

  {
    let attempt = await timed("compare_looks", { lookIds: [l1, l2] });
    let sc = attempt.res.structuredContent as { status: string; compareUrl?: string; missing: string[]; retryAfterSeconds?: number };
    assert(attempt.ms < 500, `compare_looks ${attempt.ms.toFixed(0)}ms > 500ms`);
    while (sc.status === "composing") {
      await new Promise((r) => setTimeout(r, (sc.retryAfterSeconds ?? 3) * 1000));
      attempt = await timed("compare_looks", { lookIds: [l1, l2] });
      sc = attempt.res.structuredContent as typeof sc;
      assert(attempt.ms < 500, `compare_looks retry ${attempt.ms.toFixed(0)}ms > 500ms`);
    }
    const hasImage = (attempt.res.content as { type: string }[]).some((c) => c.type === "image");
    console.log(`✓ compare_looks -> ${sc.compareUrl!.split("/").pop()} (cache hit ${attempt.ms.toFixed(0)}ms, image: ${hasImage}, missing: ${sc.missing.length})`);
    assert(sc.missing.length === 0, `unexpected missing looks: ${sc.missing}`);
    const sheet = await fetch(sc.compareUrl!);
    assert(sheet.ok, "compare sheet must be served");
  }

  const react = await client.callTool({ name: "record_reaction", arguments: { lookId: l1, reaction: "love" } });
  console.log(`✓ record_reaction love -> "${(react.content as { text: string }[])[0]?.text}"`);

  await client.close();
  server.close();
  console.log("\nSMOKE OK");
}

async function oauthLoop(): Promise<void> {
  const { pkceS256 } = await import("../src/auth/crypto.js");
  const { randomBytes } = await import("node:crypto");
  const verifier = randomBytes(48).toString("base64url");
  const q = new URLSearchParams({
    response_type: "code",
    client_id: "mcp-inspector-local",
    redirect_uri: "http://localhost",
    scope: "wardrobe:read wardrobe:write",
    state: "smoke",
    code_challenge: pkceS256(verifier),
    code_challenge_method: "S256",
    resource: process.env.MCP_CANONICAL_URL!,
  });
  const page = await fetch(`${BASE}/oauth/authorize?${q}`);
  assert(page.status === 200 && (await page.text()).includes("wants to connect"), "authorize page");

  q.set("userId", "praveen");
  const consent = await fetch(`${BASE}/link`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: q,
    redirect: "manual",
  });
  assert(consent.status === 302, "consent should redirect");
  const code = new URL(consent.headers.get("location")!).searchParams.get("code")!;

  const tok = (await (
    await fetch(`${BASE}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: "http://localhost",
        client_id: "mcp-inspector-local",
        resource: process.env.MCP_CANONICAL_URL!,
      }),
    })
  ).json()) as { access_token: string; refresh_token: string };
  assert(tok.access_token?.startsWith("wat_"), "access token issued");

  const mcp = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${tok.access_token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert(mcp.status === 200, `OAuth access token rejected by /mcp (${mcp.status})`);
  console.log("✓ OAuth 2.1 PKCE loop -> access token works on /mcp");
}

async function seedDemo(): Promise<number> {
  const { getStore } = await import("../src/store/index.js");
  const { RenderQueue } = await import("../src/render/queue.js");
  const { catalog } = await import("../src/catalog/catalog.js");
  const store = getStore();
  const render = new RenderQueue(store);
  await store.upsertUser({ id: "praveen", displayName: "Praveen", createdAt: new Date().toISOString() });
  const photo = await store.addPhoto({ id: "photo-1", userId: "praveen", s3Key: "tryon:photo-01", width: 768, height: 1152, isPrimary: true });
  for (const g of catalog) {
    await render.enqueue({ userId: "praveen", photoId: photo.id, garmentId: g.id, renderSalt: photo.renderSalt });
  }
  await render.settle(120_000);
  const jobs = await Promise.all(
    catalog.map((g) => store.getRenderJob(render.cacheKey("photo-1", g.id, photo.renderSalt))),
  );
  const done = jobs.filter((j) => j?.status === "done").length;
  assert(done === catalog.length, `only ${done}/${catalog.length} renders completed`);
  return done;
}

function assert(cond: unknown, msg: string): asserts cond {
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
