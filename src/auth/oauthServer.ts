import type { Hono } from "hono";
import { config } from "../config.js";
import type { Store } from "../store/Store.js";
import type { OAuthToken } from "../store/types.js";
import { getClient } from "./clients.js";
import { opaqueToken, sha256, verifyPkceS256 } from "./crypto.js";
import { renderLinkPage, DEMO_USERS, type AuthParams } from "./linkPage.js";

/**
 * A minimal OAuth 2.1 authorization server, in-process. Exactly what Alexa+
 * expects and nothing it rejects:
 *   - authorization-code + PKCE **S256 only**
 *   - RFC 8707 `resource` — mandatory, must equal the canonical MCP URL
 *   - public clients, pre-registered (no Dynamic Client Registration)
 *   - `401` from /mcp carries **no** `WWW-Authenticate` (see bearer.ts)
 */
export function mountOAuth(app: Hono, store: Store): void {
  const { authCodeTtlSeconds } = config.oauth;

  // ---------- /oauth/authorize ----------
  app.get("/oauth/authorize", (c) => {
    const q = c.req.query();
    const p: AuthParams = {
      client_id: q.client_id ?? "",
      redirect_uri: q.redirect_uri ?? "",
      response_type: q.response_type ?? "",
      scope: q.scope ?? config.oauth.scopesSupported.join(" "),
      state: q.state ?? "",
      code_challenge: q.code_challenge ?? "",
      code_challenge_method: q.code_challenge_method ?? "",
      resource: q.resource ?? "",
    };

    const client = getClient(p.client_id);
    // client_id / redirect_uri problems must NOT redirect (OAuth 2.1 §4.1.2.1).
    if (!client) return c.text("unknown client_id", 400);
    if (!client.redirectUris.includes(p.redirect_uri)) {
      return c.text("redirect_uri does not match a registered value", 400);
    }

    const back = (error: string, description: string) => {
      const u = new URL(p.redirect_uri);
      u.searchParams.set("error", error);
      u.searchParams.set("error_description", description);
      if (p.state) u.searchParams.set("state", p.state);
      return c.redirect(u.toString(), 302);
    };

    if (p.response_type !== "code") return back("unsupported_response_type", "response_type must be 'code'");
    if (p.code_challenge_method !== "S256") return back("invalid_request", "code_challenge_method must be S256");
    if (!p.code_challenge) return back("invalid_request", "code_challenge is required");
    if (p.resource.replace(/\/$/, "") !== config.canonicalUrl) {
      return back("invalid_target", `resource must be ${config.canonicalUrl}`);
    }
    const bad = p.scope.split(/\s+/).filter((s) => s && !config.oauth.scopesSupported.includes(s as never));
    if (bad.length) return back("invalid_scope", `unknown scope: ${bad.join(", ")}`);

    return c.html(renderLinkPage(p));
  });

  // ---------- /link  (demo login + consent) ----------
  app.post("/link", async (c) => {
    const form = await c.req.parseBody();
    const p: AuthParams = {
      client_id: str(form.client_id),
      redirect_uri: str(form.redirect_uri),
      response_type: str(form.response_type),
      scope: str(form.scope),
      state: str(form.state),
      code_challenge: str(form.code_challenge),
      code_challenge_method: str(form.code_challenge_method),
      resource: str(form.resource),
    };
    const userId = str(form.userId);

    const client = getClient(p.client_id);
    if (!client || !client.redirectUris.includes(p.redirect_uri)) {
      return c.text("invalid client or redirect_uri", 400);
    }
    if (!DEMO_USERS.some((u) => u.id === userId)) {
      return c.html(renderLinkPage(p, "Pick a demo user to continue."), 400);
    }
    if (p.resource.replace(/\/$/, "") !== config.canonicalUrl) {
      return c.text("invalid resource", 400);
    }

    const scopes = p.scope.split(/\s+/).filter(Boolean);
    await store.upsertUser({
      id: userId,
      displayName: DEMO_USERS.find((u) => u.id === userId)!.name,
      createdAt: new Date().toISOString(),
    });

    const code = opaqueToken("wac");
    await store.putAuthCode({
      codeHash: sha256(code),
      clientId: p.client_id,
      userId,
      scopes,
      redirectUri: p.redirect_uri,
      codeChallenge: p.code_challenge,
      resource: config.canonicalUrl,
      expiresAt: Date.now() + authCodeTtlSeconds * 1000,
    });

    const u = new URL(p.redirect_uri);
    u.searchParams.set("code", code);
    if (p.state) u.searchParams.set("state", p.state);
    return c.redirect(u.toString(), 302);
  });

  // ---------- /oauth/token ----------
  app.post("/oauth/token", async (c) => {
    const form = await c.req.parseBody();
    const grant = str(form.grant_type);
    const noStore = (body: unknown, status = 200) => {
      c.header("Cache-Control", "no-store");
      c.header("Pragma", "no-cache");
      return c.json(body as object, status as 200);
    };
    const err = (error: string, description: string, status = 400) =>
      noStore({ error, error_description: description }, status);

    if (grant === "authorization_code") {
      const code = str(form.code);
      const verifier = str(form.code_verifier);
      const redirectUri = str(form.redirect_uri);
      const clientId = str(form.client_id);
      if (!code || !verifier || !redirectUri || !clientId) {
        return err("invalid_request", "code, code_verifier, redirect_uri and client_id are required");
      }

      const rec = await store.takeAuthCode(sha256(code)); // single-use
      if (!rec) return err("invalid_grant", "authorization code is invalid or already used");
      if (rec.expiresAt < Date.now()) return err("invalid_grant", "authorization code expired");
      if (rec.clientId !== clientId) return err("invalid_grant", "client_id mismatch");
      if (rec.redirectUri !== redirectUri) return err("invalid_grant", "redirect_uri mismatch");
      if (str(form.resource) && str(form.resource).replace(/\/$/, "") !== rec.resource) {
        return err("invalid_target", "resource mismatch");
      }
      if (!verifyPkceS256(verifier, rec.codeChallenge)) {
        return err("invalid_grant", "PKCE verification failed");
      }

      const tokens = await issuePair(store, {
        userId: rec.userId,
        scopes: rec.scopes,
        clientId: rec.clientId,
        resource: rec.resource,
      });
      return noStore(tokens);
    }

    if (grant === "refresh_token") {
      const refresh = str(form.refresh_token);
      if (!refresh) return err("invalid_request", "refresh_token is required");

      const rec = await store.getToken(sha256(refresh));
      if (!rec || rec.kind !== "refresh") return err("invalid_grant", "refresh token is invalid");
      if (rec.expiresAt < Date.now()) {
        await store.deleteToken(rec.tokenHash);
        return err("invalid_grant", "refresh token expired");
      }
      if (str(form.resource) && str(form.resource).replace(/\/$/, "") !== rec.resource) {
        return err("invalid_target", "resource mismatch");
      }
      let scopes = rec.scopes;
      const requested = str(form.scope).split(/\s+/).filter(Boolean);
      if (requested.length) {
        if (requested.some((s) => !rec.scopes.includes(s))) {
          return err("invalid_scope", "refresh cannot widen scope");
        }
        scopes = requested;
      }

      await store.deleteTokensByRefresh(rec.tokenHash); // rotate
      const tokens = await issuePair(store, {
        userId: rec.userId,
        scopes,
        clientId: rec.clientId,
        resource: rec.resource,
      });
      return noStore(tokens);
    }

    return err("unsupported_grant_type", `grant_type '${grant}' is not supported`);
  });
}

interface IssueInput {
  userId: string;
  scopes: string[];
  clientId: string;
  resource: string;
}

async function issuePair(
  store: Store,
  input: IssueInput,
): Promise<{
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}> {
  const { accessTokenTtlSeconds, refreshTokenTtlSeconds } = config.oauth;
  const access = opaqueToken("wat");
  const refresh = opaqueToken("wrt");
  const refreshHash = sha256(refresh);
  const now = Date.now();

  const common = { userId: input.userId, scopes: input.scopes, clientId: input.clientId, resource: input.resource };
  const refreshRec: OAuthToken = {
    ...common,
    tokenHash: refreshHash,
    kind: "refresh",
    expiresAt: now + refreshTokenTtlSeconds * 1000,
  };
  const accessRec: OAuthToken = {
    ...common,
    tokenHash: sha256(access),
    kind: "access",
    expiresAt: now + accessTokenTtlSeconds * 1000,
    refreshHash,
  };
  await store.putToken(refreshRec);
  await store.putToken(accessRec);

  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: accessTokenTtlSeconds,
    refresh_token: refresh,
    scope: input.scopes.join(" "),
  };
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
