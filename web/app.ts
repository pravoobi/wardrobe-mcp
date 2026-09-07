/**
 * Phase 5 — the simulated Alexa+ web app.
 *
 * A real MCP client (this literal `@modelcontextprotocol/sdk` package, bundled
 * for the browser by `scripts/build-web.mjs` — no CDN) does a real OAuth 2.1
 * PKCE login against this server's own `/oauth/*` endpoints, then drives the
 * real `/mcp` endpoint over Streamable HTTP exactly as Alexa+ would. The only
 * thing "simulated" is the voice device itself: typed text stands in for
 * speech, and a small Bedrock loop (via the `/api/simulate/turn` proxy —
 * server-side, because the browser can't hold AWS credentials) stands in for
 * Alexa+'s own reasoning about which wardrobe tool to call next.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult, Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";

const ORIGIN = window.location.origin;
const CLIENT_ID = "web-simulator";
const REDIRECT_URI = `${ORIGIN}/simulator`;
const SESSION_KEY = "wardrobe_sim_v1";

const QUICK_PHRASES = [
  "I have a sangeet on Saturday. What should I wear? Budget eight thousand.",
  "Show me the first one on me.",
  "Save that.",
  "Now show me another option.",
  "Compare them.",
];

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

interface ContentBlock {
  text?: string;
  toolUse?: { toolUseId: string; name: string; input: unknown };
  toolResult?: { toolUseId: string; status?: "success" | "error"; content: { text?: string }[] };
}
interface ConvMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}

// ---------------------------------------------------------------- DOM ----
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const statusEl = $("status");
const connectBtn = $<HTMLButtonElement>("connectBtn");
const transcriptEl = $("transcript");
const screenEl = $("screen");
const micDot = $("micDot");
const micLabel = $("micLabel");
const composer = $<HTMLFormElement>("composer");
const utteranceInput = $<HTMLInputElement>("utterance");
const sendBtn = composer.querySelector("button[type=submit]") as HTMLButtonElement;
const quickPhrasesEl = $("quickPhrases");

for (const phrase of QUICK_PHRASES) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = phrase;
  b.addEventListener("click", () => {
    if (sendBtn.disabled) return;
    void sendTurn(phrase);
  });
  quickPhrasesEl.appendChild(b);
}

function setStatus(text: string, cls?: "connected" | "error"): void {
  statusEl.textContent = text;
  statusEl.className = cls ?? "";
}
function setComposerEnabled(enabled: boolean): void {
  utteranceInput.disabled = !enabled;
  sendBtn.disabled = !enabled;
  if (enabled) utteranceInput.placeholder = "Type what you'd say to Alexa+…";
}
function setMicLive(live: boolean): void {
  micDot.classList.toggle("live", live);
  micLabel.textContent = live ? "thinking…" : "idle";
}
function addBubble(kind: "user" | "alexa" | "tool" | "error", text: string): void {
  const div = document.createElement("div");
  div.className = `bubble ${kind}`;
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = kind === "user" ? "You" : kind === "alexa" ? "Alexa+" : kind === "tool" ? "tool call" : "error";
  div.appendChild(who);
  div.appendChild(document.createTextNode(text));
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}
function showOnScreen(dataUrl: string): void {
  screenEl.innerHTML = "";
  const img = document.createElement("img");
  img.src = dataUrl;
  img.alt = "rendered look";
  screenEl.appendChild(img);
}

// -------------------------------------------------------------- PKCE ----
function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomString(len = 64): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}
async function challengeFromVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

// ------------------------------------------------------------ tokens ----
function loadTokens(): Tokens | undefined {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : undefined;
  } catch {
    return undefined;
  }
}
function saveTokens(t: Tokens): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(t));
}
function clearTokens(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

// -------------------------------------------------------------- OAuth ----
async function startLogin(): Promise<void> {
  const verifier = randomString();
  const state = randomString(16);
  sessionStorage.setItem("wardrobe_sim_pkce_verifier", verifier);
  sessionStorage.setItem("wardrobe_sim_pkce_state", state);

  const challenge = await challengeFromVerifier(verifier);
  const u = new URL("/oauth/authorize", ORIGIN);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", CLIENT_ID);
  u.searchParams.set("redirect_uri", REDIRECT_URI);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("resource", `${ORIGIN}/mcp`);
  u.searchParams.set("scope", "wardrobe:read wardrobe:write");
  u.searchParams.set("state", state);
  window.location.assign(u.toString());
}

async function exchangeCode(code: string): Promise<Tokens> {
  const verifier = sessionStorage.getItem("wardrobe_sim_pkce_verifier") ?? "";
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    resource: `${ORIGIN}/mcp`,
  });
  const res = await fetch("/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return { access_token: json.access_token, refresh_token: json.refresh_token, expires_at: Date.now() + json.expires_in * 1000 };
}

async function refreshTokens(t: Tokens): Promise<Tokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: t.refresh_token,
    resource: `${ORIGIN}/mcp`,
  });
  const res = await fetch("/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
  const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return { access_token: json.access_token, refresh_token: json.refresh_token, expires_at: Date.now() + json.expires_in * 1000 };
}

async function ensureFreshToken(): Promise<string> {
  let t = loadTokens();
  if (!t) throw new Error("not connected");
  if (t.expires_at - Date.now() < 60_000) {
    t = await refreshTokens(t);
    saveTokens(t);
  }
  return t.access_token;
}

// ---------------------------------------------------------- MCP client ----
let mcpClient: Client | undefined;
let mcpTools: McpTool[] = [];

async function connectMcp(accessToken: string): Promise<void> {
  const client = new Client({ name: "wardrobe-mcp-simulator", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL("/mcp", ORIGIN), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  await client.connect(transport);
  const { tools } = await client.listTools();
  mcpClient = client;
  mcpTools = tools;
}

// --------------------------------------------------------- chat loop ----
let conversation: ConvMessage[] = [];

async function sendTurn(userText: string): Promise<void> {
  if (!mcpClient) return;
  utteranceInput.value = "";
  addBubble("user", userText);
  conversation.push({ role: "user", content: [{ text: userText }] });
  setComposerEnabled(false);
  setMicLive(true);

  try {
    const toolDefs = mcpTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));

    for (let round = 0; round < 6; round++) {
      const accessToken = await ensureFreshToken();
      const res = await fetch("/api/simulate/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ messages: conversation, tools: toolDefs }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: string };
        addBubble("error", err.message ?? `reasoning step failed (${res.status})`);
        break;
      }
      const { message, stopReason } = (await res.json()) as { message: ConvMessage; stopReason: string };
      conversation.push(message);

      const spoken = message.content.filter((b) => b.text).map((b) => b.text!.trim()).filter(Boolean);
      if (spoken.length) addBubble("alexa", spoken.join(" "));

      const toolUses = message.content.filter((b) => b.toolUse).map((b) => b.toolUse!);
      if (stopReason !== "tool_use" || toolUses.length === 0) break;

      const resultBlocks: ContentBlock[] = [];
      for (const tu of toolUses) {
        addBubble("tool", `${tu.name}(${JSON.stringify(tu.input)})`);
        try {
          const result: CallToolResult = await mcpClient.callTool({ name: tu.name, arguments: tu.input as Record<string, unknown> });
          const text = (result.content ?? [])
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join(" ");
          const image = (result.content ?? []).find((c) => c.type === "image") as
            | { type: "image"; data: string; mimeType: string }
            | undefined;
          if (image) showOnScreen(`data:${image.mimeType};base64,${image.data}`);
          resultBlocks.push({
            toolResult: {
              toolUseId: tu.toolUseId,
              status: result.isError ? "error" : "success",
              content: [{ text: JSON.stringify({ spoken: text, structuredContent: result.structuredContent }) }],
            },
          });
        } catch (err) {
          resultBlocks.push({
            toolResult: {
              toolUseId: tu.toolUseId,
              status: "error",
              content: [{ text: err instanceof Error ? err.message : String(err) }],
            },
          });
        }
      }
      conversation.push({ role: "user", content: resultBlocks });
    }
  } catch (err) {
    addBubble("error", err instanceof Error ? err.message : String(err));
  } finally {
    setComposerEnabled(true);
    setMicLive(false);
    utteranceInput.focus();
  }
}

composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = utteranceInput.value.trim();
  if (text) void sendTurn(text);
});

// ------------------------------------------------------------- boot ----
connectBtn.addEventListener("click", () => {
  if (loadTokens()) {
    clearTokens();
    window.location.href = REDIRECT_URI;
    return;
  }
  void startLogin();
});

async function boot(): Promise<void> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    setStatus(`login failed: ${url.searchParams.get("error_description") ?? oauthError}`, "error");
    return;
  }

  if (code) {
    const expectedState = sessionStorage.getItem("wardrobe_sim_pkce_state");
    window.history.replaceState({}, "", REDIRECT_URI);
    if (state !== expectedState) {
      setStatus("login failed: state mismatch", "error");
      return;
    }
    try {
      const tokens = await exchangeCode(code);
      saveTokens(tokens);
    } catch (err) {
      setStatus(`login failed: ${err instanceof Error ? err.message : String(err)}`, "error");
      return;
    }
  }

  const tokens = loadTokens();
  if (!tokens) {
    setStatus("not connected");
    connectBtn.textContent = "Connect";
    return;
  }

  try {
    const accessToken = await ensureFreshToken();
    await connectMcp(accessToken);
    setStatus(`connected — ${mcpTools.length} tools`, "connected");
    connectBtn.textContent = "Disconnect";
    setComposerEnabled(true);
    utteranceInput.focus();
  } catch (err) {
    clearTokens();
    setStatus(`connection failed: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
}

void boot();
