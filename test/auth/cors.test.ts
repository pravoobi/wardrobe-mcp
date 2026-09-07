import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { app } from "../../src/server.js";

/**
 * Regression test for friction log #10: a browser-based MCP client on a
 * different origin (MCP Inspector's web UI, found the hard way) couldn't
 * connect at all — no preflight handler, no Access-Control-Allow-Origin
 * anywhere. Bearer-token auth (not cookies) makes a wildcard origin safe.
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

describe("CORS on /mcp", () => {
  it("answers a preflight OPTIONS request", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:6274",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,authorization",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toMatch(/POST/);
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toMatch(/authorization/);
  });

  it("carries Access-Control-Allow-Origin on the real response, and still no WWW-Authenticate", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:6274" },
      body: "{}",
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.has("www-authenticate")).toBe(false);
  });
});
