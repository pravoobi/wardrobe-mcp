import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/mcp/server.js";
import type { ToolContext } from "../../src/mcp/context.js";
import { MemoryStorage } from "../../src/render/storage.js";
import { RenderQueue } from "../../src/render/queue.js";
import { SqliteStore } from "../../src/store/sqlite.js";

/**
 * Regression for the live bug in friction log #11: an unexpected exception
 * (there, an S3 AccessDenied naming the App Runner instance role's ARN)
 * reached the MCP client verbatim. registerTools.ts's catch-all must mask
 * anything that isn't a deliberate ToolError.
 */
describe("tool error masking", () => {
  it("never leaks a raw internal exception message to the client", async () => {
    const store = new SqliteStore(":memory:");
    await store.upsertUser({ id: "u1", displayName: "U", createdAt: new Date().toISOString() });

    const SENSITIVE =
      "AccessDenied: arn:aws:sts::064308050230:assumed-role/wardrobe-mcp-apprunner-instance/x is not authorized";
    // Make a real tool's store call throw a raw, sensitive-looking error.
    store.listWardrobe = async () => {
      throw new Error(SENSITIVE);
    };

    const ctx: ToolContext = {
      store,
      render: new RenderQueue(store, { mode: "stub", storage: new MemoryStorage() }),
      user: { userId: "u1", scopes: ["wardrobe:read", "wardrobe:write"] },
    };

    const server = createMcpServer(ctx);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const res = await client.callTool({ name: "list_wardrobe", arguments: {} });
    const text = (res.content as { type: string; text?: string }[])[0]?.text ?? "";

    expect(res.isError).toBe(true);
    expect(text).not.toContain("arn:aws");
    expect(text).not.toContain("064308050230");
    expect(text).toMatch(/something went wrong/i);

    await client.close();
  });

  it("still shows a deliberate ToolError message verbatim (e.g. missing scope)", async () => {
    const store = new SqliteStore(":memory:");
    await store.upsertUser({ id: "u1", displayName: "U", createdAt: new Date().toISOString() });

    const ctx: ToolContext = {
      store,
      render: new RenderQueue(store, { mode: "stub", storage: new MemoryStorage() }),
      user: { userId: "u1", scopes: ["wardrobe:read"] }, // no write
    };

    const server = createMcpServer(ctx);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const res = await client.callTool({
      name: "add_to_wardrobe",
      arguments: { garmentId: "dress-navy-floral-01" },
    });
    const text = (res.content as { type: string; text?: string }[])[0]?.text ?? "";

    expect(res.isError).toBe(true);
    expect(text).toMatch(/wardrobe:write permission/i);

    await client.close();
  });
});
