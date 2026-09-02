/** Pre-registered OAuth clients. Alexa+ forbids Dynamic Client Registration,
 * so every client id is known ahead of time. */
export interface OAuthClient {
  clientId: string;
  redirectUris: string[];
  name: string;
}

export const CLIENTS: Record<string, OAuthClient> = {
  "alexa-plus": {
    clientId: "alexa-plus",
    // Filled in from the Alexa+ add-on config during Phase 4.
    redirectUris: ["https://layla.amazon.com/api/skill/link/callback", "https://pitangui.amazon.com/api/skill/link/callback"],
    name: "Alexa+",
  },
  "mcp-inspector-local": {
    clientId: "mcp-inspector-local",
    redirectUris: ["http://localhost", "http://localhost:6274/oauth/callback", "http://127.0.0.1:6274/oauth/callback"],
    name: "MCP Inspector (local)",
  },
};

export function getClient(clientId: string): OAuthClient | undefined {
  return CLIENTS[clientId];
}
