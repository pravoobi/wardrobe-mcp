import { SqliteStore } from "../src/store/sqlite.js";
import { RenderQueue } from "../src/render/queue.js";
import { MemoryStorage } from "../src/render/storage.js";
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
  const render = new RenderQueue(store, { mode: "stub", storage: new MemoryStorage() });

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

/** Retry a tool call until its structuredContent satisfies `done` (or give up).
 * Mirrors how a client polls a `{ status: "rendering" | "composing" }` reply. */
export async function callUntil<T>(
  call: () => Promise<{ structuredContent?: unknown }>,
  done: (sc: T) => boolean,
  tries = 40,
): Promise<{ structuredContent?: unknown }> {
  let last = await call();
  for (let i = 0; i < tries && !done(last.structuredContent as T); i++) {
    await new Promise((r) => setTimeout(r, 50));
    last = await call();
  }
  return last;
}
