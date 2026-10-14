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

describe("ops endpoints", () => {
  it("/healthz is ok", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("/healthz?deep=1 actually touches the store", async () => {
    const res = await fetch(`${base}/healthz?deep=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("/version reports a real semver and a gitSha field", async () => {
    const res = await fetch(`${base}/version`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: string; gitSha: string };
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.gitSha).toBeTruthy();
  });

  // Each test uses its own synthetic IP (via X-Forwarded-For) so they don't
  // share a rate-limit window with each other or with other test files that
  // exercise the same routes.
  it("rate-limits repeated /link requests from the same IP", async () => {
    const ip = "203.0.113.11";
    const body = new URLSearchParams({
      response_type: "code",
      client_id: "mcp-inspector-local",
      redirect_uri: "http://localhost",
      scope: "wardrobe:read",
      state: "x",
      code_challenge: "x",
      code_challenge_method: "S256",
      resource: "http://localhost:3000/mcp",
      userId: "praveen",
    });
    let last: Response | undefined;
    for (let i = 0; i < 21; i++) {
      last = await fetch(`${base}/link`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ip },
        body,
        redirect: "manual",
      });
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get("retry-after")).toBeTruthy();
  });

  it("does not rate-limit a different IP on the same route", async () => {
    const res = await fetch(`${base}/link`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-for": "203.0.113.99",
      },
      body: new URLSearchParams({
        client_id: "mcp-inspector-local",
        redirect_uri: "http://localhost",
        resource: "http://localhost:3000/mcp",
        userId: "praveen",
      }),
      redirect: "manual",
    });
    expect(res.status).not.toBe(429);
  });

  // Regression: POST /link rendered the consent page again (on an unrecognized
  // userId) using the caller-supplied `resource` before validating it.
  // renderLinkPage does `new URL(p.resource).host`, which throws on a
  // malformed/missing resource -- an unauthenticated POST with incomplete
  // form data crashed the request with an unhandled TypeError instead of a
  // clean 400.
  it("rejects an oversized /link body with 413", async () => {
    const res = await fetch(`${base}/link`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-for": "203.0.113.77",
      },
      body: new URLSearchParams({ client_id: "x".repeat(20_000) }),
    });
    expect(res.status).toBe(413);
  });

  it("POST /link with a missing resource returns a clean 400, not a crash", async () => {
    const res = await fetch(`${base}/link`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-for": "203.0.113.50",
      },
      body: new URLSearchParams({ client_id: "mcp-inspector-local", redirect_uri: "http://localhost" }),
      redirect: "manual",
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("invalid resource");
  });
});
