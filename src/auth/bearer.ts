import type { Context, Next } from "hono";
import { config } from "../config.js";
import type { Store } from "../store/Store.js";
import { sha256 } from "./crypto.js";
import type { UserContext } from "../mcp/context.js";

declare module "hono" {
  interface ContextVariableMap {
    user: UserContext;
  }
}

/**
 * Bearer auth for /mcp. Alexa+ discovery expects a bare `401` with a JSON body
 * and **no** `WWW-Authenticate` header — this contradicts the MCP spec default
 * and most SDK middleware, so we do it by hand and test for the header's
 * absence.
 *
 * A token resolves to a user via the OAuth token store. `dev_<userId>` tokens
 * are also accepted when `config.allowDevTokens` (never in production).
 */
export function makeBearerAuth(store: Store) {
  return async function bearerAuth(c: Context, next: Next): Promise<Response | void> {
    const header = c.req.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header);

    const unauthorized = (): Response =>
      c.json(
        { error: "unauthorized", error_description: "A valid Bearer access token is required." },
        401,
      );

    if (!match) return unauthorized();
    const token = match[1]!.trim();

    const user = await resolveToken(store, token);
    if (!user) return unauthorized();

    c.set("user", user);
    await next();
  };
}

export async function resolveToken(store: Store, token: string): Promise<UserContext | undefined> {
  if (config.allowDevTokens && token.startsWith("dev_")) {
    const userId = token.slice(4);
    if (userId) return { userId, scopes: ["wardrobe:read", "wardrobe:write"] };
  }
  const rec = await store.getToken(sha256(token));
  if (!rec || rec.kind !== "access") return undefined;
  if (rec.expiresAt < Date.now()) {
    await store.deleteToken(rec.tokenHash);
    return undefined;
  }
  if (rec.resource.replace(/\/$/, "") !== config.canonicalUrl) return undefined;
  return { userId: rec.userId, scopes: rec.scopes };
}
