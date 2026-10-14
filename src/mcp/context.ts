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

export function requireWrite(user: UserContext): void {
  if (!user.scopes.includes("wardrobe:write")) {
    throw new Error("This action needs the wardrobe:write permission.");
  }
}

export function requireRead(user: UserContext): void {
  if (!user.scopes.includes("wardrobe:read")) {
    throw new Error("This action needs the wardrobe:read permission.");
  }
}
