import { SqliteStore } from "../src/store/sqlite.js";
import { RenderQueue } from "../src/render/queue.js";
import type { ToolContext } from "../src/mcp/context.js";

export interface TestHarness {
  store: SqliteStore;
  render: RenderQueue;
  ctx: ToolContext;
}

export async function makeHarness(
  opts: { scopes?: string[]; withPhoto?: boolean; userId?: string } = {},
): Promise<TestHarness> {
  const userId = opts.userId ?? "praveen";
  const store = new SqliteStore(":memory:");
  const render = new RenderQueue(store);

  await store.upsertUser({ id: userId, displayName: "Praveen", createdAt: new Date().toISOString() });
  if (opts.withPhoto ?? true) {
    await store.addPhoto({
      id: "photo-1",
      userId,
      s3Key: "seed/p.jpg",
      width: 768,
      height: 1152,
      isPrimary: true,
    });
  }

  const ctx: ToolContext = {
    store,
    render,
    user: { userId, scopes: opts.scopes ?? ["wardrobe:read", "wardrobe:write"] },
  };
  return { store, render, ctx };
}

export function textOf(result: { content: unknown }): string {
  const first = (result.content as { type: string; text?: string }[])[0];
  return first?.text ?? "";
}
