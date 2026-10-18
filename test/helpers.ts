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
 * Mirrors how a client polls a `{ status: "rendering" | "composing" }` reply.
 * 40 tries (2s) was enough on a fast dev machine but not always on a cold CI
 * runner: `warmCompare`'s first attempt (fired from `save_look`) almost
 * always bails because the just-enqueued render isn't done yet, so the real
 * compose only starts on this loop's *next* `compare_looks` call, and a
 * first-ever `sharp`/libvips call in the process has real startup cost. 120
 * tries (6s) gives that enough room without masking a genuinely stuck job. */
export async function callUntil<T>(
  call: () => Promise<{ structuredContent?: unknown }>,
  done: (sc: T) => boolean,
  tries = 120,
): Promise<{ structuredContent?: unknown }> {
  let last = await call();
  for (let i = 0; i < tries && !done(last.structuredContent as T); i++) {
    await new Promise((r) => setTimeout(r, 50));
    last = await call();
  }
  return last;
}
