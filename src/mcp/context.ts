import type { Store } from "../store/Store.js";
import type { RenderQueue } from "../render/queue.js";

/** Authenticated caller identity, attached by the Bearer middleware. */
export interface UserContext {
  userId: string;
  scopes: string[];
}

/** Everything a tool needs, injected so tools stay pure and HTTP-free. */
export interface ToolContext {
  store: Store;
  render: RenderQueue;
  user: UserContext;
}

/**
 * Thrown for an expected, safe-to-speak-aloud refusal (missing scope, bad
 * input). The registerTools.ts catch-all shows `message` for these verbatim;
 * anything else thrown (an AWS SDK exception, a store error) is logged with
 * full detail server-side and answered with a generic message instead, so an
 * internal exception's raw text — which can carry an account id or role ARN,
 * as it did in practice (friction log #11) — never reaches the client.
 */
export class ToolError extends Error {}

export function requireWrite(user: UserContext): void {
  if (!user.scopes.includes("wardrobe:write")) {
    throw new ToolError("This action needs the wardrobe:write permission.");
  }
}

export function requireRead(user: UserContext): void {
  if (!user.scopes.includes("wardrobe:read")) {
    throw new ToolError("This action needs the wardrobe:read permission.");
  }
}
