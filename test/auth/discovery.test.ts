import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { app } from "../../src/server.js";

/**
 * The discovery documents are how a client finds out how to authenticate at all,
 * and Alexa+ is strict about their contents. `npm run smoke` checked these; the
 * test suite didn't, so a regression could ship green.
 */
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

describe("authorization server metadata", () => {
  it("advertises exactly what Alexa+ requires", async () => {
    const res = await fetch(`${base}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as Record<string, unknown>;

    expect(doc.issuer).toBeTruthy();
    expect(doc.authorization_endpoint).toMatch(/\/oauth\/authorize$/);
    expect(doc.token_endpoint).toMatch(/\/oauth\/token$/);
    expect(doc.response_types_supported).toEqual(["code"]);
    expect(doc.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    // S256 only — plain PKCE must never be advertised.
    expect(doc.code_challenge_methods_supported).toEqual(["S256"]);
    expect(doc.scopes_supported).toEqual(["wardrobe:read", "wardrobe:write"]);
  });
});

describe("protected resource metadata", () => {
  it("is served at the bare well-known path", async () => {
    const res = await fetch(`${base}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as Record<string, unknown>;
    expect(doc.resource).toBeTruthy();
    expect(doc.bearer_methods_supported).toEqual(["header"]);
    expect(doc.code_challenge_methods_supported).toEqual(["S256"]);
  });

  // RFC 9728 §3.1 — clients (MCP Inspector among them) probe the path-suffixed
  // variant when the resource isn't at the root. This 404'd before.
  it("is also served at the RFC 9728 path-suffixed variant", async () => {
    const bare = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
    const res = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(bare);
  });
});
