import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { app } from "../../src/server.js";

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

const post = (headers: Record<string, string> = {}) =>
  fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });

describe("bearer auth on /mcp", () => {
  it("401 without a token, and NO WWW-Authenticate header", async () => {
    const res = await post();
    expect(res.status).toBe(401);
    expect(res.headers.has("www-authenticate")).toBe(false);
    expect((await res.json()) as unknown).toMatchObject({ error: "unauthorized" });
  });

  it("401 for a malformed Authorization header", async () => {
    const res = await post({ authorization: "Basic abc" });
    expect(res.status).toBe(401);
    expect(res.headers.has("www-authenticate")).toBe(false);
  });

  it("passes through with a valid dev token", async () => {
    const res = await post({ authorization: "Bearer dev_praveen" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: { tools: unknown[] } };
    expect(body.result?.tools?.length).toBe(11);
  });
});

describe("discovery documents", () => {
  it("PRM resource is the canonical MCP URL with S256 advertised", async () => {
    const prm = (await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json()) as Record<string, unknown>;
    expect(prm.resource).toBe("http://localhost:3000/mcp");
    const as = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as Record<string, string[]>;
    expect(as.code_challenge_methods_supported).toContain("S256");
  });
});
