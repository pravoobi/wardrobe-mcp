import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { app } from "../../src/server.js";
import { getStore } from "../../src/store/index.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/tools-list.json", import.meta.url));
const PROTOCOL_MIN = "2025-11-25";

let server: ServerType;
let base: string;

beforeAll(async () => {
  // Seed a demo user + photo into the same store singleton the server uses.
  const store = getStore();
  await store.upsertUser({ id: "praveen", displayName: "Praveen", createdAt: new Date().toISOString() });
  await store.addPhoto({ id: "photo-1", userId: "praveen", s3Key: "s/p.jpg", width: 768, height: 1152, isPrimary: true });

  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => {
      base = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });
});

afterAll(() => server.close());

async function connect(): Promise<Client> {
  const client = new Client({ name: "e2e", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer dev_praveen" } },
    }),
  );
  return client;
}

describe("real MCP client over Streamable HTTP", () => {
  it("negotiates protocol >= 2025-11-25", async () => {
    const client = new Client({ name: "e2e", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer dev_praveen" } },
    });
    await client.connect(transport);
    const negotiated = (transport as unknown as { protocolVersion?: string }).protocolVersion;
    expect(negotiated).toBeDefined();
    expect(negotiated! >= PROTOCOL_MIN).toBe(true);
    await client.close();
  });

  it("tool contract has not drifted", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const snapshot = tools
      .map((t) => ({
        name: t.name,
        inputSchema: sortedKeys(t.inputSchema?.properties ?? {}),
        annotations: t.annotations ?? {},
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (!existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, JSON.stringify(snapshot, null, 2) + "\n");
    }
    const expected = JSON.parse(readFileSync(FIXTURE, "utf8")) as unknown;
    expect(snapshot).toEqual(expected);
    await client.close();
  });

  it("runs the sangeet flow", async () => {
    const client = await connect();
    const suggest = await client.callTool({
      name: "suggest_outfits",
      arguments: { occasion: "sangeet", budget: 8000 },
    });
    const options = (suggest.structuredContent as { options: { garmentId: string }[] }).options;
    expect(options.length).toBeGreaterThanOrEqual(1);

    const preview = await client.callTool({
      name: "preview_look",
      arguments: { garmentId: options[0]!.garmentId },
    });
    expect(["rendering", "done"]).toContain((preview.structuredContent as { status: string }).status);
    await client.close();
  });
});

function sortedKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).sort();
}
