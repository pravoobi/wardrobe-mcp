# wardrobe-mcp

A **self-hosted MCP server** that gives Alexa+ a customer's wardrobe: what they own, what
they've saved, what they could buy — and, the differentiator, what any of it **looks like
on them**, rendered by the existing on-device virtual try-on pipeline
([`pravoobi/try-on`](https://github.com/pravoobi/try-on)).

> "Alexa, I have a sangeet on Saturday. What should I wear? Budget eight thousand."
> → `suggest_outfits` reads out 3 options with reasons → "Show me the magenta one on me."
> → `preview_look` returns a rendered try-on on the Echo Show → "Save that." → "Compare them."
> → "Go with the magenta." → `record_reaction(love)` → Alexa+ offers the purchase link.

**Thesis:** Alexa+ is the stylist's *voice*; this server is the stylist's *memory and eyes*.
Every tool is a thin, fast, structured lookup. Anything slow (rendering) is pre-computed.

Built for the Amazon *Build, Ship, Shape* hackathon — **Alexa+** track, plus the **AWS
Builder** and **Open Source** mini challenges. MIT licensed.

## Architecture

```
  Alexa+ (MCP client) ──Streamable HTTP + Bearer──► wardrobe-mcp (Node 22 + TS)
                                                     ├─ /mcp        MCP server (tools, resources, prompts)
                                                     ├─ /oauth/*    OAuth 2.1 AS (PKCE S256, resource param)
                                                     ├─ /.well-known/oauth-*   discovery
                                                     └─ /renders/*  rendered looks (dev; CloudFront in prod)
                          store/   SQLite (dev) │ DynamoDB (prod)
                          render/  queue → Playwright worker → drives try-on's own WebMCP tools
```

**The renderer bridge:** the try-on pipeline is browser-only (LiteRT.js, WebGPU/Wasm). We
don't port it. The render worker launches headless Chromium, opens the deployed try-on app,
and calls the page's **own WebMCP tools** (`apply_tryon`, `save_look`, `compare_looks`) via
`document.modelContext.executeTool`, then pulls the snapshot PNG. One tool contract, two
transports. Rendering is never in the request path — `preview_look` / `compare_looks` are
cache reads; a miss enqueues and returns `{ status: "rendering", retryAfterSeconds }`.

## Tool surface

| Tool | Purpose |
|---|---|
| `list_wardrobe` | Clothes the customer owns/saved (filter by category / occasion / colour). |
| `search_catalog` | Ranked catalog search — occasion, colour, category, budget, free text. |
| `suggest_outfits` | Up to 3 outfits for an occasion, **deterministically ranked** (no LLM). |
| `preview_look` | A garment rendered on the customer's photo. Cache read. |
| `save_look` | Persist a look with a label. |
| `list_looks` | The looks saved this session. |
| `compare_looks` | 2–3 saved looks side by side. |
| `record_reaction` | `love` / `like` / `try_another` / `reject` → guidance for the next turn. |
| `add_to_wardrobe` | Add a catalog garment; triggers background pre-render. |

Resources: `wardrobe://catalog`, `wardrobe://looks/{lookId}`. Prompt: `style_me`.

## Run it locally

```bash
npm install
cp .env.example .env
npm run seed      # demo user "Praveen" + photo + pre-rendered looks
npm run dev       # http://localhost:3000/mcp
```

Auth in dev: send `Authorization: Bearer dev_praveen` (any `dev_<userId>` works; full
OAuth 2.1 lands in Phase 3). Point MCP Inspector at `http://localhost:3000/mcp`.

Expose it for Alexa+:

```bash
cloudflared tunnel --url http://localhost:3000
```

## Verify

```bash
npm run typecheck
npm test          # unit + auth + e2e MCP client
npm run smoke     # boots the server, runs the sangeet flow over a real MCP client
```

`npm run smoke` asserts: unauthenticated `POST /mcp` → `401` **without** `WWW-Authenticate`;
discovery documents advertise `S256`; negotiated protocol ≥ `2025-11-25`; `suggest_outfits`
answers in < 500 ms.

## Status

- [x] **Phase 1** — skeleton MCP over Streamable HTTP, catalog + wardrobe + suggest tools, SQLite store, smoke flow.
- [x] Full tool surface wired with a stub renderer (image tools answer from cache).
- [ ] **Phase 2** — real Playwright renderer bridge; freeze tool schemas.
- [ ] **Phase 3** — OAuth 2.1 AS (PKCE, `resource`), DynamoDB + S3/CloudFront, Bedrock tagging, AWS App Runner.
- [ ] **Phase 4** — Alexa+ add-on (`alexa-ai deploy`).

See [`CLAUDE.md`](CLAUDE.md) for the full plan and [`docs/`](docs/) for the friction log,
product feedback, and submission notes.
