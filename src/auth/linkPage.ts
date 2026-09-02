import { getClient } from "./clients.js";

export interface AuthParams {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  scope: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string;
}

/** Demo identities the /link page offers. Real deployments would authenticate
 * the customer here (email code, SSO, …); the hackathon shows a picker. */
export const DEMO_USERS = [
  { id: "praveen", name: "Praveen" },
  { id: "asha", name: "Asha" },
] as const;

const esc = (s: string): string =>
  s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderLinkPage(p: AuthParams, error?: string): string {
  const client = getClient(p.client_id);
  const scopes = p.scope.split(/\s+/).filter(Boolean);
  const hidden = (Object.keys(p) as (keyof AuthParams)[])
    .map((k) => `<input type="hidden" name="${k}" value="${esc(p[k])}">`)
    .join("");

  const userButtons = DEMO_USERS.map(
    (u) =>
      `<button type="submit" name="userId" value="${u.id}" class="user">Continue as <strong>${esc(u.name)}</strong></button>`,
  ).join("");

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link your wardrobe</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; display: grid; place-items: center; min-height: 100vh; background: #faf8f5; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { background: #16130f; color: #f0ede8; } .card { background: #221e19 !important; } }
  .card { background: #fff; padding: 32px; border-radius: 16px; max-width: 380px; box-shadow: 0 8px 40px rgba(0,0,0,.12); }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #8a8a8a; margin: 0 0 20px; font-size: 14px; }
  .scopes { list-style: none; padding: 0; margin: 0 0 20px; }
  .scopes li { padding: 8px 0; border-top: 1px solid rgba(128,128,128,.2); }
  .scopes li::before { content: "✓ "; color: #2f8f52; font-weight: 700; }
  button.user { display: block; width: 100%; padding: 12px; margin: 8px 0; font-size: 15px; border: 1px solid rgba(128,128,128,.3); border-radius: 10px; background: transparent; color: inherit; cursor: pointer; }
  button.user:hover { border-color: #c8286f; }
  .err { background: #fdeaea; color: #a11; padding: 10px 12px; border-radius: 8px; font-size: 14px; margin-bottom: 16px; }
  @media (prefers-color-scheme: dark) { .err { background: #3a1a1a; color: #f6b6b6; } }
</style></head><body>
<form class="card" method="POST" action="/link">
  <h1>${esc(client?.name ?? p.client_id)} wants to connect</h1>
  <p class="sub">to your Wardrobe on <code>${esc(new URL(p.resource).host)}</code></p>
  ${error ? `<div class="err">${esc(error)}</div>` : ""}
  <ul class="scopes">
    ${scopes.map((s) => `<li>${s === "wardrobe:write" ? "Save looks and add items to your wardrobe" : "See your wardrobe, saved looks and previews"}</li>`).join("")}
  </ul>
  ${hidden}
  ${userButtons}
</form>
</body></html>`;
}
