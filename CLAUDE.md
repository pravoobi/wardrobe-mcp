# CLAUDE.md — Wardrobe MCP Server for Alexa+

Hackathon: Build, Ship, Shape — Amazon Developer Hackathon (Devpost)
Track: **Alexa+** (self-hosted MCP server). Mini challenges: **AWS Builder** + **Open Source**.
Deadline: **Oct 24, 2026, 12:30 AM IST** — treat **Oct 23, 6 PM IST** as the real cutoff.
Repo (new, public, MIT): `github.com/pravoobi/wardrobe-mcp`
Rendering dependency (existing): `github.com/pravoobi/try-on` (deployed on GitHub Pages)

## What this project is

A **self-hosted MCP server** that gives Alexa+ a customer's wardrobe: what they own, what
they've saved, what they could buy, and — the differentiator — what any of it **looks like
on them**, rendered by the existing on-device virtual try-on pipeline.

Customer story (this is the demo script, keep it in mind for every design decision):

> "Alexa, I have a sangeet on Saturday. What should I wear? Budget eight thousand."
> → Alexa+ calls `suggest_outfits` → reads out 3 options with reasons →
> "Show me the magenta one on me." → `preview_look` returns a rendered try-on image on the
> Echo Show → "Save that. Now show me the navy one." → `save_look`, `preview_look` →
> "Compare them." → `compare_looks` returns a side-by-side → "Go with the magenta."
> → `record_reaction(love)` → Alexa+ confirms and offers the purchase link.

**Thesis:** Alexa+ is the stylist's *voice*; this server is the stylist's *memory and eyes*.
Every tool is a thin, fast, structured lookup. Anything slow (rendering) is pre-computed.

**Positioning:** portfolio proof that the WebMCP tool contracts written for the try-on app
port cleanly to a remote MCP server — same catalog, same tool semantics, new transport —
plus a real Alexa+ add-on with OAuth 2.1, AWS-hosted.

## Non-negotiable hackathon requirements (verified against the rules page + Alexa+ docs)

| Requirement | Source | Consequence for us |
|---|---|---|
| Streamable HTTP, MCP spec **2025-11-25 or later** | Devpost rules, Alexa+ quickstart | `@modelcontextprotocol/sdk` ≥ the version that ships the 2025-11-25 protocol; use `StreamableHTTPServerTransport`. No SSE-only fallback. |
| Repo must **call the required technology in code** (an MCP server entry point), not just mention it in README | Devpost rules | `src/server.ts` is the entry point; README links to it. |
| **OAuth 2.1** authorization-code + **PKCE S256**, `resource` parameter, Bearer in `Authorization` header only; PRM document with `code_challenge_methods_supported: ["S256"]`; unauthenticated → `401` **without** `WWW-Authenticate`; **no** Dynamic Client Registration | Alexa+ quickstart | We ship a minimal OAuth 2.1 authorization server in the same process (see Auth). Pre-registered client id for Alexa+. |
| **Round-trip tool latency < 500 ms** | Alexa+ quickstart | No rendering, no LLM calls, no cold Playwright inside a tool call. Pre-render + cache; DynamoDB/SQLite reads only. |
| Server reachable at a **remote HTTPS URL** | Alexa+ quickstart | AWS App Runner (prod) / `cloudflared` tunnel (dev). |
| Images must be **HTTPS** PNG/JPG/WEBP | Alexa+ quickstart | Rendered looks live in S3 behind CloudFront. |
| Alexa+ refreshes tool definitions **only on `alexa-ai deploy`** | Alexa+ quickstart | Tool names/schemas are frozen after Phase 2; changing them means redeploying the add-on. |
| Public repo, **open-source license visible in the About section** | Devpost rules | `LICENSE` (MIT) at repo root **and** set in GitHub → About → License. (try-on has no root LICENSE — add one there too; it's a dependency we show in the video.) |
| Open Source mini challenge: new OSS project **created during the window**, plus form fields — contribution URL, repo URL, GitHub username (`pravoobi`), short "what / how / why it matters" | Devpost rules | New repo created Sep 4 (first commit date is the evidence). Draft the four fields in `docs/submission.md` on Day 1. |
| Demo video **< 3 min**, public YouTube/Vimeo, English, no third-party music/trademarks | Devpost rules | Script in `docs/demo-script.md`. Lead with the sangeet flow, not the architecture. |
| **Product feedback** on every tool/API/SDK used; **friction log** worth up to **10 % judging bonus** | Devpost rules | Keep `docs/friction-log.md` from day one — every snag, in their required format (task / steps / expected vs actual / severity / workaround / suggestion). |
| AWS Builder: documented AWS integrations | Devpost rules | App Runner + S3/CloudFront + DynamoDB + **Bedrock** (garment auto-tagging). Documented in `docs/aws.md` and the feedback answer. |
| Pre-existing project must explain what was built in the window | Devpost rules | The server, auth, renderer bridge, AWS deploy, Alexa+ add-on are all new. try-on's page tools pre-exist and are named as such. |
| Alexa+ add-ons distribute to **US** only; toolkit "available in the United States" | Alexa+ overview | **RESOLVED 2026-09-04, blocked:** console shows "coming soon" at `/alexa/console/ask/addons#/`; docs say "Category SDK and MCP toolkit are available for select partners only." Confirmed via Devpost rules the simulated-web-app path is official (same track, same prizes, same judging criteria, exempt from the runtime-technology-hook requirement but repo must include the simulation's source and the demo must show it working). **Decision: Phase 4 is dropped; Phase 5 is the plan.** We keep the real MCP server + OAuth 2.1 (already built, exceeds the simulated path's minimum bar) and drive it from `web/simulator.html`. |

## Architecture

```
                         ┌──────────────────────────────────────────────┐
  Alexa+ (MCP client)    │  wardrobe-mcp  (Node 22 + TS, AWS App Runner) │
  ── Streamable HTTP ──► │                                              │
     Bearer token        │  /mcp        MCP server (tools, resources)   │
                         │  /oauth/*    OAuth 2.1 AS (authorize, token) │
                         │  /.well-known/oauth-authorization-server     │
                         │  /link       tiny login/consent page          │
                         │  /wardrobe   companion web UI (upload photo,  │
                         │              manage wardrobe) — optional      │
                         │                                              │
                         │  store/      DynamoDB (prod) │ SQLite (dev)   │
                         │  render/     job queue → Playwright worker    │
                         └───────┬───────────────────────────┬──────────┘
                                 │ headless Chromium         │ PUT
                                 ▼                           ▼
                    try-on app (GitHub Pages)          S3 + CloudFront
                    document.modelContext              rendered looks,
                    .executeTool('apply_tryon')        compare sheets
                    + snapshot canvas                  (HTTPS PNG/WEBP)
```

### The renderer bridge (the clever bit — explain this in the video)

The try-on pipeline is browser-only (LiteRT.js, WebGPU/Wasm). We do **not** port it to
Node. Instead, the render worker launches headless Chromium (Playwright — already a
try-on devDependency; `tools/webmcp-smoke.mjs` proves the pattern), opens the deployed
try-on app with `?present`, loads the user's photo, and calls the page's **own WebMCP
tools** — `apply_tryon`, `save_look`, `compare_looks` — via `document.modelContext.executeTool`,
then pulls the snapshot PNG. **WebMCP tools on the page become the implementation of the
remote MCP tools.** One tool contract, two transports.

Rendering takes seconds; Alexa+ allows 500 ms. So rendering is **never** in the request
path:

- On `add_photo` (companion UI) and on `add_to_wardrobe`: enqueue renders for
  `photo × every wardrobe garment`. Catalog is small (8 curated items + growth), so this is
  seconds of work, done once.
- `preview_look` / `compare_looks` are cache reads. On a miss they enqueue and return
  `{ status: "rendering", retryAfterSeconds: 5 }` with a spoken hint, and Alexa+ can ask
  again. Cache key: `sha256(photoId + garmentId + tryonAppVersion)`.
- Compare sheets are composed server-side with `sharp` from cached single renders (fast),
  not by re-driving the browser.

### Stack

- **Runtime:** Node 22, TypeScript strict, ESM.
- **MCP:** `@modelcontextprotocol/sdk` (Streamable HTTP transport, stateless mode — no
  session affinity needed behind App Runner). Verify the installed SDK negotiates
  `2025-11-25` (or `2026-07-28`) at build time and log the negotiated version on
  `initialize`.
- **HTTP:** Hono (small, fast, works on Node and Lambda if we ever move).
- **Validation:** `zod` for tool input schemas (the SDK converts to JSON Schema).
- **Store:** `store/` interface with two impls — `sqlite` (`better-sqlite3`, dev/tests)
  and `dynamodb` (`@aws-sdk/lib-dynamodb`, prod). Single-table design, PK = `USER#id`.
- **Objects:** S3 (`@aws-sdk/client-s3`) + CloudFront for HTTPS image URLs.
- **Renderer:** Playwright + Chromium in the same container (`mcr.microsoft.com/playwright`
  base image). One long-lived browser, one page per job, queue depth 1 — this is a demo,
  not a farm.
- **Images:** `sharp` for compare-sheet composition and WEBP encode.
- **AI (AWS Builder):** Amazon Bedrock (Nova or Claude on Bedrock) for **garment
  auto-tagging** — when a user uploads a garment photo via the companion UI, Bedrock
  fills `name / color / occasion[] / category` so the item is searchable by voice. This is
  the *only* LLM call in the system, it runs at upload time, never inside a tool call.
- **Auth:** hand-rolled minimal OAuth 2.1 AS (see Auth) — no Cognito. Cognito's support
  for RFC 8707 `resource` and Amazon's PRM expectations is unverified and would burn days.
- **Hosting:** AWS App Runner from an ECR image (HTTPS + autoscaling out of the box).
  Dev: `npm run dev` + `cloudflared tunnel --url http://localhost:3000`.
- **Deploy tooling:** `alexa-ai` CLI (`configure` → `new mcp` → `deploy` → `submit`).

## Repo structure

```
wardrobe-mcp/
  CLAUDE.md
  LICENSE                       # MIT — required visible in GitHub About
  README.md                     # architecture diagram, demo GIF, run instructions
  package.json
  Dockerfile                    # playwright base image + node app
  addon/
    addon.json                  # Alexa+ add-on manifest (alexa-ai new mcp)
    assets/                     # icons (6 sizes, light+dark), 600x900 carousel
  src/
    server.ts                   # entry point: Hono app, mounts /mcp + /oauth + /wardrobe
    mcp/
      registerTools.ts          # all tool registrations, one file — the contract
      tools/                    # one file per tool, pure fn (deps injected) + zod schema
        listWardrobe.ts
        searchCatalog.ts
        suggestOutfits.ts
        previewLook.ts
        saveLook.ts
        listLooks.ts
        compareLooks.ts
        recordReaction.ts
        addToWardrobe.ts
      resources.ts              # wardrobe://catalog, wardrobe://looks/{id}
      prompts.ts                # "style_me" prompt template
      responses.ts              # helpers: text+structuredContent+image content blocks
    auth/
      oauthServer.ts            # /oauth/authorize, /oauth/token, PKCE, resource param
      prm.ts                    # /.well-known/oauth-authorization-server document
      bearer.ts                 # middleware: 401 (no WWW-Authenticate) or user ctx
      clients.ts                # pre-registered client ids (Alexa+, local inspector)
      linkPage.ts               # /link — demo login (pick demo user / email code)
    catalog/
      catalog.json              # COPIED from try-on/src/garments/catalog.json (meta only)
      searchCatalog.ts          # PORTED from try-on/src/webmcp/searchCatalog.ts, unchanged
      sync.mjs                  # script: pull latest catalog.json from try-on
    store/
      Store.ts                  # interface
      sqlite.ts
      dynamodb.ts
      types.ts                  # User, WardrobeItem, Photo, Look, Reaction, RenderJob
    render/
      queue.ts                  # in-process queue + dedupe by cache key
      worker.ts                 # Playwright: open try-on ?present, executeTool, snapshot
      compose.ts                # sharp: side-by-side compare sheet
      storage.ts                # S3 put + CloudFront URL (dev: local ./renders + static)
    tagging/
      bedrockTagger.ts          # image → {name,color,occasion[],category}; feature-flagged
    web/
      wardrobe.html             # companion UI: upload photo, upload garment, view looks
  test/
    tools/*.test.ts             # each tool against sqlite store, no network
    auth/*.test.ts              # PKCE, resource param, 401 shape, token expiry
    e2e/mcp-client.test.ts      # real MCP client over Streamable HTTP against local server
  scripts/
    smoke.mjs                   # MCP client: initialize → tools/list → the sangeet flow
    seed.mjs                    # demo user + wardrobe + pre-rendered looks
  docs/
    demo-script.md              # the 3-minute video, shot by shot
    friction-log.md             # REQUIRED FORMAT, append as you go (10 % bonus)
    product-feedback.md         # per tool/API/SDK: used for, worked, needs work, onboarding, again?
    aws.md                      # AWS Builder: which services, how, why
    submission.md               # Devpost form answers, drafted early
```

## Tool surface (the contract — freeze at end of Phase 2)

Naming follows the WebMCP tools in try-on so the story "same contract, new transport" is
literally true. All tools return **both** a spoken-friendly `text` block (one or two
sentences Alexa+ can read aloud verbatim) **and** `structuredContent`. Image-returning
tools add an `image` content block (base64 WEBP ≤ 200 KB) **and** an HTTPS URL in
`structuredContent` — screen devices use the URL, voice-only devices get the text.

| Tool | Input (zod) | Returns | Notes |
|---|---|---|---|
| `list_wardrobe` | `{ category?, occasion?, color? }` | items the user owns/saved | `readOnlyHint`. Empty wardrobe → text explains how to add (companion UI or `add_to_wardrobe`). |
| `search_catalog` | `{ query?, occasion?, color?, category?, maxPrice? }` | catalog hits ranked (ported `searchCatalog`) | `readOnlyHint`, `idempotentHint`. Prices in ₹; also echo `priceUsd` (fixed demo rate) since Alexa+ is US-first. |
| `suggest_outfits` | `{ occasion, budget?, color?, prefer?: "owned" \| "catalog" \| "any" }` | up to 3 ranked candidates, each `{ garmentId, name, reason, price, owned, previewUrl? }` | **Deterministic ranking** (occasion match > owned > budget fit > color) — no LLM. Alexa+ does the conversational reasoning. Includes `previewUrl` when a render is cached so Alexa+ can show without a second call. |
| `preview_look` | `{ garmentId, photoId? }` | image + `{ lookPreviewUrl, status }` | Cache read. Miss → `{ status: "rendering", retryAfterSeconds }` + text "Give me a few seconds and ask again." Default photo = user's primary photo; demo user is seeded with one. |
| `save_look` | `{ garmentId, label? }` | `{ lookId, label, previewUrl }` | Persists; returns full look list ids for follow-ups. |
| `list_looks` | `{}` | saved looks with labels + urls | `readOnlyHint`. |
| `compare_looks` | `{ lookIds: string[] (2–3) }` | image (side-by-side) + `{ compareUrl, looks[] }` | Composed with `sharp` from cached renders; missing ids reported, not errored (same behavior as try-on). |
| `record_reaction` | `{ lookId, reaction: "love" \| "like" \| "try_another" \| "reject", note? }` | `{ guidance }` | Same guidance strings as try-on's `await_reaction`; drives the next turn. |
| `add_to_wardrobe` | `{ garmentId }` | updated wardrobe | Triggers background pre-render for all user photos. |

Resources: `wardrobe://catalog` (read-only JSON), `wardrobe://looks/{lookId}`.
Prompt: `style_me` — "Style {user} for {occasion} under {budget}" seeded with the loop:
suggest → preview → reaction → save → compare.

Tool descriptions are **written for a voice assistant**: say what to say next
("After showing a preview, ask how it looks — only the user can judge fit."). Copy the
tone of try-on's `useStylistTools.ts` descriptions; they were validated in a real agent
loop during the WebMCP Challenge.

Tool names: lowercase snake_case, ≤ 64 chars, per 2025-11-25 tool-name guidance.

## Data model

```ts
User        { id, displayName, primaryPhotoId?, createdAt }
Photo       { id, userId, s3Key, width, height, isPrimary }
WardrobeItem{ id, userId, garmentId, source: "catalog" | "upload", addedAt,
              meta: { name, category, color, occasion[], price?, sleeves, length } }
Look        { id ("look-N" per user), userId, garmentId, photoId, label?, renderKey, createdAt }
Reaction    { id, userId, lookId, kind, note?, at }
RenderJob   { key, userId, photoId, garmentId, status: queued|running|done|failed, url?, error? }
```

Uploaded garments (source `upload`) also carry the try-on anchor JSON, produced by the
companion UI which embeds try-on's existing upload flow. If that's too much, v1 wardrobe
= catalog items only and `upload` is Phase 6 stretch. **Do not let uploads block the demo.**

## Auth (do this exactly — Alexa+ will reject anything else)

- `GET /.well-known/oauth-authorization-server` → JSON with `issuer`, `authorization_endpoint`,
  `token_endpoint`, `scopes_supported: ["wardrobe:read","wardrobe:write"]`,
  `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code","refresh_token"]`,
  `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none","client_secret_post"]`.
  Also serve the same document at `/.well-known/oauth-protected-resource` (standard PRM
  path) with `resource` + `authorization_servers` — Amazon's doc names the AS path, the
  MCP spec names the PRM path; serving both costs nothing.
- `POST /mcp` without a valid Bearer → **`401` with a JSON body and NO `WWW-Authenticate`
  header** (Amazon's discovery expectation). Log it; this is the first thing that breaks.
- `/oauth/authorize`: validate `client_id` (pre-registered), `redirect_uri` (exact match),
  `code_challenge` + `code_challenge_method=S256`, `resource` (must equal the canonical
  `https://<host>/mcp`), `scope`, `state`. Show `/link` (demo: pick a demo user, or email +
  6-digit code). Issue a 60-second single-use code bound to the challenge + resource.
- `/oauth/token`: `authorization_code` with `code_verifier` (S256 check), `resource`
  re-validated; issue opaque access token (15 min) + refresh token (30 d), stored hashed.
  `refresh_token` grant supported.
- Bearer middleware attaches `{ userId, scopes }`; write tools require `wardrobe:write`.
- **Not** implemented (Amazon says unsupported): DCR, OIDC, CIMD, step-up.
- Second pre-registered client: `mcp-inspector-local` with `http://localhost` redirect for
  local testing with MCP Inspector.

## Build phases

Timeline: Sep 4 → Oct 23. Seven weeks; the plan below uses five, leaving two for the
add-on review loop, the video, and the things Amazon's tooling will break.

### Phase 0 — Day 1 (Sep 4–5): de-risk before writing code — ✅ RESOLVED (blocked → Phase 5)
- Checked the Alexa+ add-ons console (`/alexa/console/ask/addons#/`) with Praveen's Amazon
  developer account: **"coming soon."** Docs: "Category SDK and MCP toolkit are available
  for select partners only." No India-specific block found — it's a general partner
  allowlist, account and region aside.
- Verified against the Devpost rules (fetched 2026-09-04): the simulated Alexa+ web-app
  path is official — same Alexa+ track, same prizes, same 4 judging criteria, exempt from
  the runtime-technology-hook requirement, but the repo must include the simulation's
  source and the demo must clearly show it working. India has no listed eligibility
  restriction (only Cuba/Iran/North Korea/Russia/Crimea are excluded).
- `npm create` the repo, MIT LICENSE, GitHub About → License set. Open-source mini
  challenge clock starts now; note the date in `docs/submission.md`.
- Add root `LICENSE` to try-on as well (its packages have one, root does not).
- Start `docs/friction-log.md` with the `alexa-ai configure` experience — first entry.
- **Done when:** the alexa-ai CLI is authenticated (or the fallback is decided), repo is
  public with license, friction log has ≥1 entry. **→ Fallback decided: build Phase 5, skip
  Phase 4's add-on packaging (`addon.json`, icons, `alexa-ai deploy`) entirely.**

### Phase 1 — Skeleton MCP over Streamable HTTP (Sep 6–10)
- Hono + SDK `StreamableHTTPServerTransport` on `/mcp`, stateless.
- Port `searchCatalog.ts` + copy `catalog.json` (strip anchors; keep `id/category/meta`).
  `scripts/sync-catalog.mjs` re-pulls from try-on so the two never drift.
- Tools: `search_catalog`, `list_wardrobe`, `add_to_wardrobe`, `suggest_outfits` (no
  previews yet). SQLite store. Seed script with demo user "Praveen".
- `scripts/smoke.mjs` — real MCP client: `initialize` → assert negotiated protocol version
  ≥ `2025-11-25` → `tools/list` → run the sangeet search. Also run MCP Inspector by hand.
- Unit tests per tool. `p95 tool latency < 50 ms` locally — log it, we'll need the number.
- **Done when:** MCP Inspector lists 4 tools and `suggest_outfits({occasion:"sangeet", budget:8000})`
  returns 3 sensible items in < 50 ms.

### Phase 2 — Renderer bridge + image tools (Sep 11–17)
- `render/worker.ts`: Playwright opens `https://pravoobi.github.io/try-on/?present`,
  injects the user photo (reuse the test-photo loader path or a file-input upload),
  `executeTool('apply_tryon', {garmentId})`, waits for the pipeline, snapshots the canvas
  (try-on's `snapshotCanvas.ts` already does this via `save_look` → use its data URL).
- Check WebGPU availability in headless Chromium; if absent, confirm CPU/Wasm fallback
  renders correctly (slower is fine — it's offline). Flag `--use-angle=swiftshader` etc.
  only if needed. **Record the finding in the friction log** (it's try-on/LiteRT feedback
  too — legit product feedback).
- Cache + queue + `preview_look`, `save_look`, `list_looks`, `compare_looks` (sharp),
  `record_reaction`. Local storage backend writes to `./renders` and serves them statically.
- Pre-render on `add_to_wardrobe` and on seed. Demo user boots with all looks cached.
- **Freeze tool names/schemas here.** Snapshot `tools/list` output into
  `test/fixtures/tools-list.json` and assert it never changes without a deliberate update.
- **Done when:** the full sangeet flow runs in `scripts/smoke.mjs` end-to-end from a cold
  seed, with every image-returning tool answering from cache in < 100 ms.

### Phase 3 — OAuth 2.1 + AWS (Sep 18–24)
- Auth exactly as specified above; tests for every rejection path (bad verifier, wrong
  resource, reused code, expired token, missing Bearer → 401 shape).
- DynamoDB store impl (parity tests run the same suite against both stores). S3 +
  CloudFront storage impl. Bedrock tagger behind `TAGGING_PROVIDER=bedrock|none`.
- Dockerfile on the Playwright base image; ECR; App Runner service with custom domain +
  HTTPS. Env-driven config, no secrets in repo. `docs/aws.md` written as you go.
- Measure round trip from a US region against the deployed URL (`curl -w` from a
  us-east-1 CloudShell) — must be < 500 ms for every tool. App Runner region:
  **us-east-1**, since Alexa+ traffic is US.
- **Done when:** MCP Inspector completes OAuth against the *deployed* server and runs the
  flow; p95 < 500 ms measured from us-east-1 and recorded.

### Phase 4 — Alexa+ add-on — **SKIPPED, see Phase 0 resolution above**
Not pursuing: `alexa-ai new mcp`, `addon.json`, icons, `alexa-ai deploy`, account-link in
the real web simulator. The console is partner-gated ("coming soon"); this whole phase is
moot until/unless that changes. Left here only as a record of what it would have been.

### Phase 5 — Simulated Alexa+ web app (Sep 25 – Oct 3) — **now the plan, not a fallback**
- Keep the real server. Build `web/simulator.html`: a chat UI that speaks Streamable HTTP
  to the server through a real MCP client (`@modelcontextprotocol/sdk` in the browser) with
  a small LLM loop (Bedrock via a thin proxy route — also strengthens AWS Builder) and a
  voice-styled transcript. Rules explicitly allow "a simulated Alexa+ experience in a web
  app." The video must be explicit that it's simulated. Do not pretend.
- **Built 2026-09-07:** `web/app.ts` (bundled by `web/build.mjs`/esbuild into
  `web/dist/app.js`, served at `/simulator/dist/app.js` — no CDN, the real SDK ships in the
  bundle) does a real OAuth 2.1 PKCE login against this server's own `/oauth/*`, then the
  real `Client` + `StreamableHTTPClientTransport` connects over Streamable HTTP with the
  resulting Bearer token. **Verified in an actual browser**: Connect → `/oauth/authorize`
  redirect → demo-user consent → code exchange → `connected — 9 tools`. The reasoning loop
  (`src/web/simulateApi.ts`, `POST /api/simulate/turn`, Bedrock `ConverseCommand` with
  `toolConfig` built from the live `tools/list` schemas) is wired and unit-tested with an
  injected fake client (`test/web/simulateApi.test.ts`).
- **Blocked, not a bug:** the real Bedrock call fails account-wide (`ValidationException:
  Operation not allowed` — friction log #9), so the sangeet flow can't be demoed
  end-to-end yet. Everything up to "which tool to call" is proven; only the LLM decision
  step is waiting on AWS Support to clear the account.
- **Done when:** the sangeet flow runs end-to-end in `web/simulator.html` against the
  deployed server, with a screen recording of it.

### Phase 6 — Stretch, in priority order (Oct 4–12)
1. **MCP Apps UI** (`@modelcontextprotocol/ext-apps`) — an interactive compare view
   rendered in Alexa+'s webview: tap a look to preview, swipe to compare. This directly
   targets the "Design" judging criterion and is what Amazon's docs push for visual
   experiences. Only after the voice flow is solid.
2. Companion upload flow (user photo + garment) with Bedrock auto-tagging → makes the
   wardrobe real rather than seeded.
3. `plan_week({ events: [{day, occasion}] })` — one outfit per event, no repeats.

### Phase 7 — Ship (Oct 13–23)
- README: diagram, GIF, one-command local run (`docker compose up` with sqlite + local
  renders), Alexa+ add-on setup, AWS deploy notes.
- Demo video < 3 min: 0:00–0:20 hook (the voice flow, live), 0:20–1:40 full sangeet loop
  on screen, 1:40–2:20 the renderer bridge in one diagram, 2:20–2:50 AWS + open source +
  what's new vs try-on, 2:50 close. Record at 1080p, English VO, no music.
- Devpost form: track = Alexa+; mini challenges = AWS Builder + Open Source; product
  feedback (per tool: Alexa+ MCP toolkit, alexa-ai CLI, App Runner, Bedrock, DynamoDB, MCP
  SDK, Playwright); friction log; what changed vs. pre-existing try-on; feature requests
  with severity (critical / important / nice-to-have).
- **Submit by Oct 23, 6 PM IST.** Same timezone trap as the WebMCP Challenge.

## Known gotchas (do not rediscover these)

- **500 ms is round trip from Alexa+, not server time.** Host in us-east-1, keep the
  container warm (App Runner min instances = 1), never touch the browser or Bedrock in a
  tool call. Return cached URLs; enqueue on miss.
- **`401` must NOT carry `WWW-Authenticate`.** This contradicts the MCP spec's default
  guidance and most SDK middleware adds it. Strip it explicitly and test for absence.
- **`resource` parameter is mandatory** on both `/authorize` and `/token`, must equal the
  canonical MCP URL exactly (scheme, host, path, no trailing slash). Decide the canonical
  form once, put it in config, assert it in tests.
- **Alexa+ only re-reads tools on deploy.** Editing a description locally changes nothing
  in the simulator until `alexa-ai deploy`.
- **Streamable HTTP stateless mode** — no `Mcp-Session-Id` affinity, so App Runner can
  scale. If the SDK version insists on sessions, set `sessionIdGenerator: undefined`.
- **Image content blocks are big.** Cap inline base64 at ~200 KB WEBP (640 px wide);
  always include the HTTPS URL. Some clients ignore inline images; the URL is the
  contract.
- **Headless WebGPU is unreliable.** Expect Wasm/XNNPack fallback; it is slower but
  correct. Keep the browser alive between jobs (model load is the expensive part).
- **Catalog drift.** `catalog.json` is copied, not imported, from try-on (different repo,
  different build). Run `sync-catalog` before the demo and pin `tryonAppVersion` in the
  render cache key so a try-on deploy invalidates stale renders.
- **US-only distribution.** `distributionCountries: ["US"]` in addon.json; the add-on will
  not be visible to an Indian consumer account. Test in the simulator; say so in the video.
- **No music, no third-party logos in the video.** Devpost judges can disqualify for it.

## Conventions

- TypeScript strict; no `any` in `src/mcp/tools/` or `src/auth/`.
- Tools are pure functions `(input, ctx: { store, render, user }) => ToolResult`, registered
  in one place. Testable without HTTP.
- Every tool response has `text` (speakable, ≤ 2 sentences) + `structuredContent`.
- All config via env (`MCP_CANONICAL_URL`, `STORE=sqlite|dynamodb`, `STORAGE=local|s3`,
  `TAGGING_PROVIDER`, `TRYON_APP_URL`, `AWS_REGION`). `.env.example` committed.
- `docs/friction-log.md` and `docs/product-feedback.md` are updated in the **same commit**
  as the workaround they describe. This is the 10 % bonus; it doesn't happen at the end.
- Commit each phase's "Done when" as a tagged checkpoint (`phase-1`, `phase-2`, …).
- Conventional commits; PRs not required (solo), but keep `main` demoable at all times.

## Explicit non-goals (v1)

- No purchasing / checkout — `search_catalog` returns a product URL; Alexa+ can read it out.
- No saree support (inherits try-on's limitation; say so if asked).
- No multi-tenant brand catalogs, no admin UI, no analytics.
- No Fire TV / Ring / Bee cross-track work — one track, done well, plus two cheap mini
  challenges.
- No LLM in the request path. Alexa+ is the LLM.

## Reference links

- Devpost rules: https://amazonappdev2026.devpost.com/
- Alexa+ MCP quickstart: https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart.html
- Alexa+ MCP overview: https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html
- MCP spec 2025-11-25 changes (Tasks, CIMD, extensions, tool naming): https://workos.com/blog/mcp-2025-11-25-spec-update
- Streamable HTTP transport (current spec): https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- try-on WebMCP tools (the contract being ported): https://github.com/pravoobi/try-on/blob/main/src/webmcp/useStylistTools.ts
