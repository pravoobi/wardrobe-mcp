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
and calls the page's **own WebMCP tools** via
`document.modelContext.tools.get("apply_tryon").execute(...)`, then snapshots the result
canvas. One tool contract, two transports. Rendering is never in the request path —
`preview_look` / `compare_looks` are cache reads; a miss enqueues and returns
`{ status: "rendering" | "composing", retryAfterSeconds }`.

Two render modes (`RENDER_MODE`):

| mode | what it does | when |
|---|---|---|
| `local` *(default)* | composes a look card with `sharp` from the flat garment PNG + the customer photo — fast, offline, deterministic | dev, tests, demo |
| `browser` | the real bridge above — drives the deployed try-on app in headless Chromium | GPU-capable host / `xvfb` |
| `stub` | solid-colour placeholder | unit tests |

Headless Chromium has no WebGPU on most hosts, so `browser` mode is slow (Wasm/CPU
fallback) — hence it's opt-in and `local` is the default. See
[`docs/friction-log.md`](docs/friction-log.md) #4.

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
| `plan_week` | Up to a week of events, one outfit each, never repeating a garment. |

Resources: `wardrobe://catalog`, `wardrobe://looks/{lookId}`. Prompt: `style_me`.

## Run it locally

```bash
npm install
cp .env.example .env
npm run seed      # demo user "Praveen" + try-on test photo + whole-catalog pre-render
npm run dev       # http://localhost:3000/mcp
```

`npm run seed` fetches the catalog garment PNGs and a test photo from the deployed try-on
app (cached under `data/assets/`). Render one look to eyeball it:
`tsx scripts/render-one.ts dress-magenta-wrap-01 photo-01` (add `--browser` for the real
bridge).

**Or one command, no Node install needed:**

```bash
docker compose up --build          # http://localhost:3000
docker compose run --rm seed       # once, in another terminal — demo user + pre-rendered looks
```

SQLite + local renders persist on the host under `./data` and `./renders` (both
gitignored), so a later `docker compose up` picks up where you left off. `seed` uses the
`build` image stage (has `tsx` + `scripts/`) rather than the slim production one.

## Auth (OAuth 2.1)

A minimal OAuth 2.1 authorization server runs in the same process — exactly what Alexa+
expects, nothing it rejects:

- authorization-code + PKCE **S256 only**; RFC 8707 `resource` mandatory, must equal the
  canonical MCP URL; public pre-registered clients (no Dynamic Client Registration)
- `GET /.well-known/oauth-authorization-server` + `/.well-known/oauth-protected-resource`
- `GET /oauth/authorize` → `/link` demo consent → `POST /oauth/token` (15-min access,
  30-day refresh, rotating; all persisted hashed)
- unauthenticated `POST /mcp` → **`401` with no `WWW-Authenticate`** (Amazon's quirk)

Dev shortcut: `Authorization: Bearer dev_praveen` works when `ALLOW_DEV_TOKENS=true`
(auto-off when `NODE_ENV=production`). Point MCP Inspector at `http://localhost:3000/mcp`
and it runs the full PKCE dance.

Expose it for Alexa+: `cloudflared tunnel --url http://localhost:3000`. When you do,
restart the dev server with `MCP_CANONICAL_URL` set to the tunnel's `https://…` hostname
(the OAuth `resource` param must match it exactly) and `ALLOW_DEV_TOKENS=false` (a
publicly reachable instance shouldn't accept `dev_*` bearer tokens). Verified
2026-09-07: real OAuth 2.1 PKCE + `tools/call` round trip in ~150 ms through a quick
tunnel — this is currently the fastest path to a genuine remote HTTPS URL while the
App Runner deploy is blocked (see `docs/aws.md`).

## Verify

```bash
npm run typecheck
npm test            # unit + OAuth + Store contract + e2e MCP client  (59 tests)
npm run smoke       # boots the server, runs OAuth + the full sangeet flow
npm run test:dynamo # Store contract against DynamoDB Local (needs Docker)
```

`npm run smoke` asserts: unauthenticated `POST /mcp` → `401` **without** `WWW-Authenticate`;
discovery advertises `S256`; a full PKCE loop yields a token that works on `/mcp`;
negotiated protocol ≥ `2025-11-25`; every image tool a cache hit < 100 ms.

## Status

- [x] **Phase 1** — skeleton MCP over Streamable HTTP, catalog + wardrobe + suggest tools, SQLite store, smoke flow.
- [x] **Phase 2** — renderer bridge (`local` sharp compositor + opt-in `browser` bridge to the try-on app's WebMCP tools), `sharp` compare sheets, cache + queue, whole-catalog pre-render on seed, inline image blocks. Catalog synced from `pravoobi/try-on`. Tool schemas frozen.
- [x] **Phase 3** — OAuth 2.1 AS (PKCE S256, `resource`, refresh rotation, every rejection-path tested); DynamoDB `Store` (single-table, parity suite vs SQLite, verified against DynamoDB Local); S3 + CloudFront render storage; Bedrock garment tagger (feature-flagged); `Dockerfile` (Playwright base) + `apprunner.yaml`.
- [ ] **Phase 3 (ops)** — ECR image pushed, DynamoDB table + S3 bucket + IAM roles live in
  `us-east-1`; Bedrock model access granted. **Blocked:** App Runner `CreateService` and
  CloudFront `CreateDistribution` both refuse with account-verification errors (friction log
  #9) — this AWS account needs an AWS Support verification pass before either can be created.
  S3 serves images directly over HTTPS in the meantime (`CLOUDFRONT_BASE_URL` points at the
  bucket; swapping to a real CloudFront domain later is a one-line env change, no code change).
- [x] ~~**Phase 4** — Alexa+ add-on (`alexa-ai deploy`).~~ Skipped: the add-ons console is
  partner-gated ("coming soon"), not self-serve. Pivoted to Phase 5 (Devpost's officially
  sanctioned simulated-experience path — see friction log #8).
- [x] **Phase 5** — simulated Alexa+ web app (`web/simulator.html`): real OAuth 2.1 PKCE
  login + the real `@modelcontextprotocol/sdk` client (bundled for the browser, no CDN) over
  Streamable HTTP. **The full sangeet flow runs end-to-end in a real browser**: `suggest_outfits`
  → `preview_look` → `save_look` → `preview_look` (another option) → `save_look` →
  `compare_looks`, with real rendered images on the simulated Echo Show screen. Bedrock (the
  reasoning step that picks which tool to call) is still blocked account-wide (friction log
  #9), so `src/web/ruleReasoner.ts` — a small deterministic intent matcher — stands in
  automatically, tagged and visibly labeled in the transcript, never silent. It reverts to
  real Bedrock the moment the account clears, no config to flip back.

The full sangeet flow (`npm run smoke`) runs end-to-end from a cold seed: `suggest_outfits`
→ `preview_look` → `save_look` → `compare_looks` → `record_reaction`, every image tool a
cache hit under 100 ms.

## Deploy to AWS

`STORE=dynamodb STORAGE=s3 TAGGING_PROVIDER=bedrock` in `us-east-1`. Container from the
Playwright base image (`Dockerfile`), run on App Runner (`apprunner.yaml`) with
`min instances = 1`. Full steps + the single-table schema + IAM notes in
[`docs/aws.md`](docs/aws.md). One-time table setup: `npm run aws:table`.

See [`CLAUDE.md`](CLAUDE.md) for the full plan and [`docs/`](docs/) for the friction log,
product feedback, and submission notes.
