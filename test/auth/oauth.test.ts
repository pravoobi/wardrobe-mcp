import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { app } from "../../src/server.js";
import { getStore } from "../../src/store/index.js";
import { pkceS256, sha256 } from "../../src/auth/crypto.js";

const CLIENT = "mcp-inspector-local";
const REDIRECT = "http://localhost";
const RESOURCE = "http://localhost:3000/mcp";

let server: ServerType;
let base: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => {
      base = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });
});
afterAll(() => server.close());

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: pkceS256(verifier) };
}

function authorizeUrl(over: Record<string, string> = {}): string {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT,
    redirect_uri: REDIRECT,
    scope: "wardrobe:read wardrobe:write",
    state: "xyz",
    code_challenge_method: "S256",
    resource: RESOURCE,
    ...over,
  });
  return `${base}/oauth/authorize?${p}`;
}

/** Full authorize → consent → code. */
async function getCode(challenge: string): Promise<string> {
  const auth = await fetch(authorizeUrl({ code_challenge: challenge }));
  expect(auth.status).toBe(200);
  expect(await auth.text()).toContain("wants to connect");

  const form = new URLSearchParams({
    client_id: CLIENT,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: "wardrobe:read wardrobe:write",
    state: "xyz",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
    userId: "praveen",
  });
  const res = await fetch(`${base}/link`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  const loc = new URL(res.headers.get("location")!);
  expect(loc.searchParams.get("state")).toBe("xyz");
  return loc.searchParams.get("code")!;
}

async function token(body: Record<string, string>): Promise<{ status: number; json: Record<string, string> }> {
  const res = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  expect(res.headers.get("cache-control")).toBe("no-store");
  return { status: res.status, json: (await res.json()) as Record<string, string> };
}

describe("OAuth 2.1 — happy path", () => {
  it("authorize → consent → token → access the MCP server → refresh", async () => {
    const { verifier, challenge } = pkce();
    const code = await getCode(challenge);

    const t = await token({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      client_id: CLIENT,
      resource: RESOURCE,
    });
    expect(t.status).toBe(200);
    expect(t.json.token_type).toBe("Bearer");
    expect(t.json.scope).toBe("wardrobe:read wardrobe:write");
    expect(t.json.access_token).toMatch(/^wat_/);
    expect(t.json.refresh_token).toMatch(/^wrt_/);

    // the access token works on /mcp
    const mcp = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${t.json.access_token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(mcp.status).toBe(200);

    // refresh rotates
    const r = await token({ grant_type: "refresh_token", refresh_token: t.json.refresh_token! });
    expect(r.status).toBe(200);
    expect(r.json.access_token).not.toBe(t.json.access_token);

    // old refresh token is now dead
    const reuse = await token({ grant_type: "refresh_token", refresh_token: t.json.refresh_token! });
    expect(reuse.status).toBe(400);
    expect(reuse.json.error).toBe("invalid_grant");
  });
});

describe("OAuth 2.1 — /authorize rejections", () => {
  it("unknown client_id: 400, no redirect", async () => {
    const res = await fetch(authorizeUrl({ client_id: "nope", code_challenge: "x" }), { redirect: "manual" });
    expect(res.status).toBe(400);
  });

  it("redirect_uri not registered: 400, no redirect", async () => {
    const res = await fetch(authorizeUrl({ redirect_uri: "https://evil.example", code_challenge: "x" }), {
      redirect: "manual",
    });
    expect(res.status).toBe(400);
  });

  it("plain code_challenge_method: redirect with error=invalid_request", async () => {
    const res = await fetch(authorizeUrl({ code_challenge: "x", code_challenge_method: "plain" }), {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
  });

  it("wrong resource: redirect with error=invalid_target", async () => {
    const res = await fetch(authorizeUrl({ code_challenge: "x", resource: "https://example.com/mcp" }), {
      redirect: "manual",
    });
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("invalid_target");
  });

  it("unknown scope: redirect with error=invalid_scope", async () => {
    const res = await fetch(authorizeUrl({ code_challenge: "x", scope: "wardrobe:admin" }), { redirect: "manual" });
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("invalid_scope");
  });
});

describe("OAuth 2.1 — /token rejections", () => {
  it("reused authorization code: invalid_grant", async () => {
    const { verifier, challenge } = pkce();
    const code = await getCode(challenge);
    const body = {
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      client_id: CLIENT,
    };
    expect((await token(body)).status).toBe(200);
    const second = await token(body);
    expect(second.status).toBe(400);
    expect(second.json.error).toBe("invalid_grant");
  });

  it("wrong PKCE verifier: invalid_grant", async () => {
    const { challenge } = pkce();
    const code = await getCode(challenge);
    const t = await token({
      grant_type: "authorization_code",
      code,
      code_verifier: "not-the-verifier".padEnd(43, "x"),
      redirect_uri: REDIRECT,
      client_id: CLIENT,
    });
    expect(t.status).toBe(400);
    expect(t.json.error).toBe("invalid_grant");
  });

  it("redirect_uri mismatch: invalid_grant", async () => {
    const { verifier, challenge } = pkce();
    const code = await getCode(challenge);
    const t = await token({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: "http://localhost:9999/other",
      client_id: CLIENT,
    });
    expect(t.json.error).toBe("invalid_grant");
  });

  it("resource mismatch at token: invalid_target", async () => {
    const { verifier, challenge } = pkce();
    const code = await getCode(challenge);
    const t = await token({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      client_id: CLIENT,
      resource: "https://example.com/mcp",
    });
    expect(t.json.error).toBe("invalid_target");
  });

  it("expired authorization code: invalid_grant", async () => {
    const store = getStore();
    const codeHash = sha256("expired-code");
    await store.putAuthCode({
      codeHash,
      clientId: CLIENT,
      userId: "praveen",
      scopes: ["wardrobe:read"],
      redirectUri: REDIRECT,
      codeChallenge: pkceS256("v".repeat(43)),
      resource: RESOURCE,
      expiresAt: Date.now() - 1000,
    });
    const t = await token({
      grant_type: "authorization_code",
      code: "expired-code",
      code_verifier: "v".repeat(43),
      redirect_uri: REDIRECT,
      client_id: CLIENT,
    });
    expect(t.json.error).toBe("invalid_grant");
  });

  it("unsupported grant_type", async () => {
    const t = await token({ grant_type: "password", username: "x", password: "y" });
    expect(t.status).toBe(400);
    expect(t.json.error).toBe("unsupported_grant_type");
  });

  it("refresh cannot widen scope", async () => {
    const form = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT,
      redirect_uri: REDIRECT,
      scope: "wardrobe:read",
      state: "s",
      code_challenge_method: "S256",
      resource: RESOURCE,
      userId: "praveen",
    });
    const { verifier, challenge } = pkce();
    form.set("code_challenge", challenge);
    const consent = await fetch(`${base}/link`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      redirect: "manual",
    });
    const code = new URL(consent.headers.get("location")!).searchParams.get("code")!;
    const t = await token({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      client_id: CLIENT,
    });
    const r = await token({
      grant_type: "refresh_token",
      refresh_token: t.json.refresh_token!,
      scope: "wardrobe:read wardrobe:write",
    });
    expect(r.json.error).toBe("invalid_scope");
  });
});

describe("bearer token lifetime", () => {
  it("expired access token → 401 without WWW-Authenticate", async () => {
    const store = getStore();
    const tokenHash = sha256("stale-access");
    await store.putToken({
      tokenHash,
      kind: "access",
      userId: "praveen",
      scopes: ["wardrobe:read"],
      clientId: CLIENT,
      resource: RESOURCE,
      expiresAt: Date.now() - 1000,
    });
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer stale-access",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.has("www-authenticate")).toBe(false);
  });
});
