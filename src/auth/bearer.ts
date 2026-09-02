import type { Context, Next } from "hono";
import { tokenStore } from "./tokens.js";
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
 */
export async function bearerAuth(c: Context, next: Next): Promise<Response | void> {
  const header = c.req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);

  const unauthorized = (): Response =>
    c.json(
      { error: "unauthorized", error_description: "A valid Bearer access token is required." },
      401,
    );

  if (!match) return unauthorized();

  const user = tokenStore.resolve(match[1]!.trim());
  if (!user) return unauthorized();

  c.set("user", user);
  await next();
}
