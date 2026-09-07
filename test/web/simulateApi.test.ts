import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { mountSimulatorApi } from "../../src/web/simulateApi.js";
import { makeBearerAuth } from "../../src/auth/bearer.js";
import { getStore } from "../../src/store/index.js";

const store = getStore();
const bearerAuth = makeBearerAuth(store);

function appWith(send: BedrockRuntimeClient["send"]): Hono {
  const app = new Hono();
  mountSimulatorApi(app, bearerAuth, { client: { send } as unknown as BedrockRuntimeClient });
  return app;
}

const body = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ messages: [{ role: "user", content: [{ text: "hi" }] }], tools: [], ...extra });

describe("POST /api/simulate/turn", () => {
  it("401s without a bearer token — this route is gated like /mcp", async () => {
    const app = appWith(async () => {
      throw new Error("Bedrock should not be called");
    });
    const res = await app.request("/api/simulate/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body(),
    });
    expect(res.status).toBe(401);
  });

  it("returns the model's message and stopReason on success", async () => {
    const app = appWith(async () =>
      ({
        output: { message: { role: "assistant", content: [{ text: "hi there" }] } },
        stopReason: "end_turn",
      }) as never,
    );
    const res = await app.request("/api/simulate/turn", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer dev_praveen" },
      body: body(),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { message: { content: { text: string }[] }; stopReason: string };
    expect(json.stopReason).toBe("end_turn");
    expect(json.message.content[0]!.text).toBe("hi there");
  });

  it("400s on a malformed body without calling Bedrock", async () => {
    const app = appWith(async () => {
      throw new Error("Bedrock should not be called");
    });
    const res = await app.request("/api/simulate/turn", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer dev_praveen" },
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
  });

  it("502s when Bedrock errors, surfacing the message", async () => {
    const app = appWith(async () => {
      throw new Error("ValidationException: Operation not allowed");
    });
    const res = await app.request("/api/simulate/turn", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer dev_praveen" },
      body: body(),
    });
    expect(res.status).toBe(502);
    const json = (await res.json()) as { error: string; message: string };
    expect(json.error).toBe("bedrock_error");
    expect(json.message).toMatch(/Operation not allowed/);
  });

  it("converts MCP-style tools into Bedrock toolConfig", async () => {
    let seenToolConfig: unknown;
    const app = appWith(async (cmd: unknown) => {
      seenToolConfig = (cmd as { input: { toolConfig?: unknown } }).input.toolConfig;
      return { output: { message: { role: "assistant", content: [] } }, stopReason: "end_turn" } as never;
    });
    await app.request("/api/simulate/turn", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer dev_praveen" },
      body: body({
        tools: [{ name: "suggest_outfits", description: "suggest", inputSchema: { type: "object", properties: {} } }],
      }),
    });
    expect(seenToolConfig).toMatchObject({
      tools: [{ toolSpec: { name: "suggest_outfits", description: "suggest" } }],
    });
  });
});
