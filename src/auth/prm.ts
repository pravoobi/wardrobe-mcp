import type { Hono } from "hono";
import { config } from "../config.js";

/**
 * Authorization Server metadata + Protected Resource Metadata.
 * Amazon's doc names the AS path; the MCP spec names the PRM path. Serving both
 * costs nothing.
 */
export function mountDiscovery(app: Hono): void {
  const scopes = [...config.oauth.scopesSupported];

  const asMetadata = {
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/oauth/authorize`,
    token_endpoint: `${config.issuer}/oauth/token`,
    scopes_supported: scopes,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
  };

  const prmMetadata = {
    resource: config.canonicalUrl,
    authorization_servers: [config.issuer],
    scopes_supported: scopes,
    bearer_methods_supported: ["header"],
    // Amazon's doc expects the S256 hint on the PRM document too.
    code_challenge_methods_supported: ["S256"],
  };

  app.get("/.well-known/oauth-authorization-server", (c) => c.json(asMetadata));
  app.get("/.well-known/oauth-protected-resource", (c) => c.json(prmMetadata));
}
