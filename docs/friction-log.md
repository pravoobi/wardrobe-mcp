# Friction log

Every snag hit while building on Amazon / AWS / MCP tooling, in the format the hackathon
rules ask for. Updated **in the same commit** as the workaround it describes. Worth up to
10 % of the judging score — it does not happen at the end.

Format per entry:

- **Task** — what I was trying to do
- **Steps** — what I did
- **Expected vs actual** — what should have happened, what did
- **Severity** — critical / important / nice-to-have
- **Workaround** — how I got unblocked
- **Suggestion** — what would have prevented it

---

## 1. `node:sqlite` is invisible to Vite/Vitest's transform

- **Task** — Unit-test the SQLite `Store` implementation with Vitest.
- **Steps** — `import { DatabaseSync } from "node:sqlite"` in `src/store/sqlite.ts`; ran `vitest run`.
- **Expected vs actual** — Node treats `node:`-prefixed specifiers as builtins and never
  bundles them. Actual: Vite's transform stripped the prefix and tried to resolve a package
  literally named `sqlite` — `Error: Failed to load url sqlite`.
- **Severity** — important (blocks the whole test suite).
- **Workaround** — Load it through `createRequire(import.meta.url)("node:sqlite")` so the
  string is opaque to the bundler, with a type-only `import type` for the class type.
- **Suggestion** — Vite/Rollup should keep `node:`-prefixed builtins external unconditionally,
  independent of the configured Node target's known-builtin list.

## 2. `tsc` does not copy non-TS assets to `outDir`

- **Task** — `npm run build` then `node dist/server.js`.
- **Steps** — `src/catalog/catalog.ts` loaded `./catalog.json`; ran `tsc` then started `dist/`.
- **Expected vs actual** — Expected the JSON next to the emitted JS. Actual:
  `Cannot find module './catalog.json'` — TypeScript compiles `.ts` only and leaves data
  files behind, even with `resolveJsonModule`.
- **Severity** — nice-to-have (well-known, but still a first-run trap).
- **Workaround** — Read the file at runtime with `fs.readFileSync` relative to
  `import.meta.url`, and a `cpSync` step in the `build` script for the compiled output.
- **Suggestion** — A `tsc` option to copy `include`d non-code files to `outDir` (like
  `assets` globs in other build tools) would remove a whole class of "works in dev, breaks
  in prod" bugs.

## 3. MCP SDK `StreamableHTTPServerTransport` needs raw Node `req`/`res`, not a `Request`

- **Task** — Mount the MCP server on a Hono app (Hono is `fetch`-based).
- **Steps** — Tried to hand `transport.handleRequest` a `c.req.raw` (a WHATWG `Request`).
- **Expected vs actual** — Expected the transport to accept a `fetch`-style `Request` given
  how much of the ecosystem is `fetch`-native now. Actual: it wants `IncomingMessage` /
  `ServerResponse`.
- **Severity** — nice-to-have.
- **Workaround** — `@hono/node-server` exposes the underlying `c.env.incoming` /
  `c.env.outgoing`; pass those and return `RESPONSE_ALREADY_SENT`. Parse the body with
  `c.req.json()` and pass it as the third arg so the transport doesn't re-read the stream.
- **Suggestion** — A `fetch`-native transport (or an adapter in the SDK) would let the
  server run unmodified on Workers, Lambda, Hono, and Deno.

## 4. Headless Chromium has no WebGPU — the try-on LiteRT pipeline falls back to Wasm/CPU

- **Task** — Drive the deployed try-on app's WebMCP tools from a Playwright worker to
  produce the rendered look for `preview_look` (the renderer bridge).
- **Steps** — `chromium.launch({ headless: true, args: ["--enable-unsafe-webgpu",
  "--enable-features=Vulkan"] })`, opened `https://pravoobi.github.io/try-on/?present`,
  called `document.modelContext.tools.get("apply_tryon").execute(...)`.
- **Expected vs actual** — Expected WebGPU with the unsafe flag. Actual: `requestAdapter()`
  returns `null`, the page logs `Failed to create default WebGPU device: No GPU adapter
  found`, and the test-photo buttons stay `disabled`. Originally diagnosed as "CPU fallback
  works, just slowly (tens of seconds, buttons disabled for over two minutes)."
- **Severity** — important (shapes the whole rendering architecture).
- **Workaround** — Two render modes. `RENDER_MODE=local` (default) composes a look card
  with `sharp` from the flat garment PNG + the customer photo — fast, deterministic, offline,
  honest (it pairs garment with person, it does not warp). `RENDER_MODE=browser` is the real
  bridge. Rendering is pre-computed and cached either way, so it never touches a tool-call path.

### 4a. …and the diagnosis above was wrong. The real cause: `chromium_headless_shell` (2026-09-07)

- **Task** — Re-verify `RENDER_MODE=browser` after someone noticed `docs/demo.gif` shows the
  garment *beside* the model rather than *on* her (correct — that's `local` mode by design).
- **Steps** — Ran `tsx scripts/render-one.ts dress-magenta-wrap-01 photo-01 --browser`.
  Timed out. Raised the click timeout 120s → 240s. Timed out again. Polled the button every
  15s for a further 6 minutes: never enabled. Then instrumented properly — every request's
  full lifecycle, `crossOriginIsolated`, `SharedArrayBuffer`, `requestAdapter()`, and the
  worker's console.
- **Expected vs actual** — Expected "slow but eventually finishes," per entry #4. Actual: it
  never finishes, and it isn't slowness at all. The smoking gun was the **network log: 15
  requests, none pending, none failed, none slow — the model files were never fetched.** The
  app wasn't grinding through CPU inference; it was parked before it ever started, waiting on
  a WebGPU device that would never arrive. No error, no failed request, no timeout of its own.
- **Root cause** — Playwright's `headless: true` launches `chromium_headless_shell`, a
  stripped build with **no GPU stack at all**. `navigator.gpu` is present (so a feature-detect
  passes) but `requestAdapter()` resolves `null`. Switching to the full Chrome-for-Testing
  binary via **`channel: "chromium"`** gets a real adapter. That one option is the entire fix:
  **stuck >6 min → buttons enabled in 3 s, full render in 13.1 s.** Verified by isolation —
  the launch flags make no difference either way (works with the original
  `--enable-unsafe-webgpu --enable-features=Vulkan,WebAssemblyJSPI`, and with no args at all).
- **Severity** — critical (the project's headline differentiator was silently non-functional,
  behind a plausible-sounding "it's just slow" explanation that stopped anyone from digging).
- **Workaround/fix** — `channel: "chromium"` in `createBrowserWorker()`, with a comment
  explaining why it's load-bearing so nobody "cleans it up" later.
- **⚠️ Correction to earlier advice** — `--use-angle=swiftshader` (suggested in CLAUDE.md's
  gotchas as the remedy) **makes it worse**: forcing ANGLE→SwiftShader prevented adapter
  creation even on the full binary. Tested; that guidance has been corrected.
- **Suggestion** — (Playwright) `headless: true` silently selecting a browser with no
  graphics stack is a sharp edge for any WebGPU/WebGL workload. Either warn when a page calls
  `requestAdapter()` on the shell, or document the "use `channel: 'chromium'` for GPU work"
  rule somewhere it'll be found *before* someone loses a day. (try-on / LiteRT.js) a page
  that gates its UI on GPU init should surface a visible timeout/error state rather than
  leaving controls `disabled` indefinitely — the silent wait is what made this so hard to
  attribute.

### 4b. Reused-page renders all converge on the same (wrong) garment — missing a settle wait after photo load (2026-09-08)

- **Task** — Batch-render all 8 catalog garments onto the demo photo (`scripts/seed.ts`,
  `RENDER_MODE=browser`), reusing one long-lived Playwright page across calls instead of a
  fresh page per render (model load is the expensive part; reopening it per garment is
  wasteful).
- **Steps** — Loaded the photo once, then called `apply_tryon` for garment A, waited, read
  the canvas, called `apply_tryon` for garment B on the same page, waited, read again.
  `apply_tryon` returned `{ok:true, applied:{id:<correct-id>}}` every time — no error
  anywhere. Spent a long time chasing wrong leads before finding the real cause: ruled out
  true concurrency (serialized renders with a promise chain — bug persisted), browser/
  context/page reuse in every combination (fresh browser, fresh context, reused
  browser — all failed identically), a garmentId mismatch (confirmed catalog IDs match
  exactly, and the tool echoes the right ID back), redundant re-clicking of the photo
  button, and several canvas-stability-polling schemes (all flaky and no more reliable than
  a flat wait).
- **Expected vs actual** — Expected each render to show its own requested garment. Actual:
  every render **after the first** on a reused page showed the same (first) garment's
  image, byte-identical (MD5-verified) regardless of which garmentId was requested for it.
- **Root cause** — The photo-button click resolves as soon as the click event fires, not
  once the app's photo-load handler has actually finished initializing the try-on pipeline
  for that photo. The very first `apply_tryon` call was firing while that handler was still
  settling, and whatever partial state resulted from that race stuck permanently — every
  subsequent `apply_tryon` on that page kept compositing against the same stale state, no
  matter the garment. A standalone script that happened to add a short wait after the photo
  click (for unrelated reasons) never exhibited the bug; a faithful copy of its render logic
  inside `worker.ts`'s actual module, missing only that wait, reproduced the bug every time
  — isolating it to that one missing wait, not anything about module-vs-script execution.
- **Severity** — critical — the batch-seed path (and any live `add_to_wardrobe`
  pre-render) would have silently cached the wrong image for 7 of 8 garments, with no
  error anywhere in the pipeline to catch it.
- **Fix** — Add `await page.waitForTimeout(1_500)` immediately after the photo-load click,
  before the first `apply_tryon` on that page (`src/render/worker.ts`). Verified reliable
  across 3 repeated runs of a 3-garment sequential batch: distinct, correct MD5 per garment
  every time.
- **Suggestion** — (try-on) the photo-load handler could resolve a promise, or set a
  `data-photo-ready` attribute, once it's actually done initializing — right now there is
  no DOM-observable signal to wait on, which is what forced a fixed sleep instead of a
  wait-for-condition. (Playwright/general) when driving a page as an agent would, "the
  click resolved" and "the app finished reacting to the click" are easy to conflate, and
  the failure mode here (plausible-looking success, wrong cached output, zero errors) is
  the worst kind to debug — worth calling out explicitly in agentic-browser-automation
  guidance.

## 5. WebMCP: `document.modelContext` is the provider server, not a client — no obvious "call a tool"

- **Task** — From Playwright (acting as the agent), invoke a tool the page registered.
- **Steps** — Tried `document.modelContext.executeTool("apply_tryon", args)` and
  `executeTool({ name, arguments })`; both threw `TypeError: RegisteredTool must be an object`
  / `RegisteredTool.description is required`. `getTools()` returns a Map, not an array.
- **Expected vs actual** — Expected a client-style `callTool(name, args)`. Actual:
  `document.modelContext` is a `BrowserMcpServer` (the registration side). The working call
  is `document.modelContext.tools.get(name).execute(args)` — returns a standard MCP
  `CallToolResult`.
- **Severity** — important (undocumented; cost an afternoon of probing).
- **Workaround** — Use `.tools.get(name).execute(args)`. Documented in
  `src/render/worker.ts`.
- **Suggestion** — The WebMCP explainer should show the agent-side call explicitly, and a
  symmetrical `document.modelContext.callTool(name, args)` helper would remove the guesswork.

## 6. `NODE_ENV=production` in the Playwright base image silently breaks `npm run build`

- **Task** — Multi-stage `Dockerfile` from `mcr.microsoft.com/playwright:v1.62.1-noble`.
- **Steps** — Build stage: `COPY package*.json`, `RUN npm ci`, `RUN npm run build`.
- **Expected vs actual** — Expected `npm ci` to install everything for the build stage.
  Actual: the Playwright image sets `ENV NODE_ENV=production`, so `npm ci` omitted
  `devDependencies` and the build died with `sh: 1: tsc: not found` — no warning that
  packages were skipped.
- **Severity** — nice-to-have (once you know, `--include=dev` fixes it).
- **Workaround** — `RUN npm ci --include=dev` in the build stage; keep `--omit=dev` in the
  deps stage.
- **Suggestion** — `npm ci` should print a one-line notice when `NODE_ENV=production` causes
  it to skip devDependencies — this is a very common Docker footgun.

## 7. Alexa+ `401`-without-`WWW-Authenticate` fights every default

- **Task** — Return `401` from `/mcp` with a JSON body and **no** `WWW-Authenticate`, per
  Amazon's discovery expectation.
- **Steps** — Wrote the Bearer check by hand in Hono rather than using SDK/middleware auth.
- **Expected vs actual** — The MCP spec (and `mcp-sdk` server auth middleware, and every
  OAuth resource-server example) *requires* `WWW-Authenticate` on a `401` pointing at the
  PRM. Amazon's Alexa+ quickstart says the opposite: omit it. Following the spec fails
  Amazon's discovery.
- **Severity** — important (silent — the add-on just never links).
- **Workaround** — Hand-rolled middleware that returns bare `{ error, error_description }`
  JSON; a test asserts the header's *absence* so it can't regress.
- **Suggestion** — If Amazon needs a non-standard `401`, the quickstart should call this out
  in a red box with a snippet — and ideally Amazon's client should just follow the spec and
  read `WWW-Authenticate` / the well-known PRM path like everyone else.

## 8. Alexa+ add-ons console is "coming soon" — MCP Toolkit is partner-gated, not just US-gated

- **Task** — Phase 0 de-risk: confirm the Amazon developer account can actually create and
  deploy an Alexa+ add-on before building Phase 4 around it.
- **Steps** — Signed into the Amazon developer console at `/alexa/console/ask/addons#/`;
  cross-checked the quickstart and overview docs.
- **Expected vs actual** — Expected either full access, or an explicit country block (the
  docs only say "available in the United States," which reads as a distribution/region
  restriction). Actual: the console section itself shows **"coming soon,"** and the docs
  separately state "Category SDK and MCP toolkit are available for select partners only" —
  a partner allowlist, not a self-serve GA feature, independent of account region.
- **Severity** — critical (blocks the entire planned Phase 4 for any non-partner
  developer, US-based or not — this is not an India-specific problem).
- **Workaround** — Devpost's official rules allow submitting a **simulated Alexa+
  experience in a web app** instead, on the same track, same prizes, same judging
  criteria (confirmed by reading the rules directly). Pivoted the plan: ship the real
  MCP server + OAuth 2.1 (already exceeds what the simulated path requires) behind a
  `web/simulator.html` chat UI instead of the real add-on packaging.
- **Suggestion** — The quickstart/overview docs should say "partner-gated, request access
  here" up front instead of only "available in the United States" — a hackathon
  participant reads that as a region check they can pass, not an allowlist they can't get
  onto in time, and burns Phase-0 time discovering the real blocker.

## 9. New-account verification silently spreads across services mid-session — CloudFront, App Runner, then Bedrock

- **Task** — Deploy to App Runner (Phase 3 ops), then build the Phase 5 simulator's
  Bedrock-backed reasoning loop.
- **Steps** — `cloudfront create-distribution` → `AccessDenied: Your account must be
  verified`. `apprunner create-service` (same day) → `SubscriptionRequiredException`.
  Both read as isolated, service-specific gates, so we proceeded with everything else
  (ECR, DynamoDB, S3, IAM roles — all fine) and planned to route around them. Bedrock
  `ConverseCommand`/`InvokeModel` calls **worked** at this point (`bedrockTagger.ts`'s
  exact request pattern, tested via `aws bedrock-runtime invoke-model`, returned a real
  completion) — no reason to suspect Bedrock.
- **Expected vs actual** — Two days later, mid-session, the *same* Bedrock call
  (identical request body, same model, same region) started failing with
  `ValidationException: Operation not allowed` — for both `InvokeModel` and `Converse`,
  and for two different models (Nova Lite and Claude Haiku), ruling out a model- or
  API-specific cause. Nothing in our code or IAM policy changed between the two tests.
- **Severity** — critical — this makes `bedrockTagger.ts` (shipped, tested-with-mocks
  Phase 3 code) silently non-functional against the real account, not just the new
  simulator work, and it wasn't caught by unit tests because they mock the Bedrock
  client entirely.
- **Workaround** — This is the same new-account verification hold as CloudFront/App
  Runner (see App Runner/CloudFront ops notes), now apparently widened to cover Bedrock
  too. Filed one AWS Support case covering all three. For the Phase 5 reasoning loop
  specifically, built `src/web/ruleReasoner.ts` — a deterministic keyword matcher that
  returns the exact same `{message, stopReason}` shape Bedrock's Converse API does, so
  the browser loop can't tell the difference structurally. `simulateApi.ts` tries
  Bedrock first and falls back to it automatically on any error, tagging the response
  (`reasoner: "bedrock" | "rule-based"`) so the UI can show an honest, visible label
  rather than silently pretending — reverts to real Bedrock the instant the account
  clears, no config to flip. This unblocked full end-to-end verification of the sangeet
  flow (2026-09-07) despite Bedrock still being down. `TAGGING_PROVIDER=none` has no
  equivalent fallback yet — garment auto-tagging just doesn't run until Bedrock is back.
- **Suggestion** — If Bedrock access is genuinely tied to the same account-verification
  gate as CloudFront/App Runner, the `ValidationException` message should say so
  (`"Account pending verification"`) instead of the generic, unsearchable "Operation not
  allowed" — and ideally a single account-level banner/console page would show every
  service currently gated by an open verification case, instead of each one failing
  independently and looking like unrelated bugs.
- **Resolution (2026-10-14, 5 weeks after filing)** — AWS Support's own words: the
  account was "very new" and "does not meet the usage and billing history criteria
  required to access these resources," access is normally granted "organically" over
  time, but an exception request to their Service Team was possible. After confirming
  the region (us-east-1) and giving a detailed use-case writeup, the exception was
  granted for App Runner, CloudFront, and Bedrock standard-tier models (Nova Lite
  included; higher-tier models like certain Claude models on Bedrock still need more
  account history and weren't requested). Verified live, not just claimed: `apprunner
  list-services` now succeeds, `bedrock-runtime converse` now gets as far as a
  `ThrottlingException` (a quota limit, meaning the call is actually allowed) instead of
  `ValidationException: Operation not allowed`, and `cloudfront create-distribution` was
  re-run for real and created a live distribution (see `docs/aws.md`). A card was added
  to the account 3 weeks before this cleared, which on its own did nothing — the
  exception request is what actually moved it, not the billing info.
- **Updated suggestion** — The blocker wasn't a bug to work around, it was an
  undocumented new-account gate with no self-serve path and no visible queue position.
  The fix was a plain-language support ticket asking for an exception, naming the exact
  services/region/use-case — if a hackathon (or any time-boxed project) hits this,
  file that ticket on day one, not after discovering the block organically; it took over
  a month end-to-end.

## 10. No CORS support — MCP Inspector's web UI can't connect at all

- **Task** — Phase 1's "also run MCP Inspector by hand" verification, finally done
  (2026-09-07, against the live cloudflared tunnel — real remote HTTPS, real OAuth
  client `mcp-inspector-local`, not `dev_*` shortcuts).
- **Steps** — Added the server to Inspector as a Streamable HTTP connection and toggled
  it on. Every server-side/`curl` test up to this point had passed (401 shape, discovery
  docs, full PKCE loop, `tools/call`), so no reason to expect trouble.
- **Expected vs actual** — Expected either a clean connect or a clear "needs auth"
  prompt. Actual: Inspector's own OAuth-discovery GETs (`/.well-known/oauth-*`)
  succeeded, but its actual `POST /mcp` transport call failed instantly with an opaque
  browser-level `TypeError: Failed to fetch` — no status code, no body, nothing
  server-side to debug from. Traced it myself with a page-context `fetch()` call plus a
  manual `curl -X OPTIONS /mcp -H "Origin: ..."`: the server had **zero CORS
  configuration** — `OPTIONS /mcp` 404'd (no preflight handler at all) and even the real
  `POST` response carried no `Access-Control-Allow-Origin`. Every prior verification
  (curl, our own same-origin `web/simulator.html`, the Node e2e test's SDK client) is
  either server-side or same-origin, so none of them could have caught this — it only
  bites a browser-based client on a *different* origin than the server, which is exactly
  MCP Inspector's web UI, and exactly what a third-party web integration of this "self-
  hosted MCP server" would be too.
- **Severity** — important — silently blocks a standard, widely-used MCP debugging tool,
  and would silently block any other cross-origin browser client the same way, with zero
  actionable error surfaced to the person debugging it.
- **Workaround/fix** — Added `hono/cors` as blanket middleware (`origin: "*"` — safe
  here since auth is a Bearer token, not cookies, so there's no CSRF surface a wildcard
  origin opens up). Verified with `curl -X OPTIONS` (204, proper `Access-Control-*`
  headers) and confirmed the actual `POST /mcp` 401 now carries
  `Access-Control-Allow-Origin: *` while still correctly carrying **no**
  `WWW-Authenticate` (friction log #7's requirement — the two are independent, both hold
  at once). `test/auth/bearer.test.ts` still passes unchanged.
- **Open question, not fully chased down** — Inspector still showed "Failed" after the
  CORS fix; my direct page-context `fetch()` to the same URL got a clean `401` with a
  readable body, so the transport-level bug is fixed. Whatever's left is more likely an
  Inspector-side "configure an OAuth client before connecting" step I didn't complete
  (global "Client settings," not the per-server config) than a server bug — didn't have
  time to run that down. Worth a fresh look before final submission if MCP Inspector
  compatibility is claimed anywhere in the write-up.
- **Suggestion** — The MCP Streamable HTTP spec (or the TypeScript SDK's server
  transport) should either set permissive CORS by default for the `/mcp` endpoint or, at
  minimum, the spec/quickstart docs should call out that CORS is the implementer's
  responsibility — it's easy to build and fully verify a server with curl/server-side
  clients and never notice browser-based clients can't reach it at all.

## 11. `compare_looks` broke on any real cache miss — S3's 403-instead-of-404 without `s3:ListBucket`

- **Task** — Verify the deployed App Runner service with a real OAuth round trip and the
  actual sangeet tool sequence (2026-10-14), per guideline 38 ("verify the deployed site,
  not just local") — the first time any tool call had been exercised against the real
  prod DynamoDB/S3, not SQLite/local storage.
- **Steps** — `suggest_outfits` → `preview_look` (cache hit, pre-seeded) → `save_look` x2
  → `compare_looks` on a pair of looks that had never been compared before (so the
  compare-sheet S3 key genuinely didn't exist yet).
- **Expected vs actual** — Expected either a composed sheet or `{status: "composing"}`.
  Actual: a hard tool error — `User: arn:aws:sts::...:assumed-role/wardrobe-mcp-apprunner-
  instance/... is not authorized to perform: s3:ListBucket on resource:
  "arn:aws:s3:::wardrobe-looks-064308050230" because no identity-based policy allows the
  s3:ListBucket action`.
- **Root cause** — Classic S3 IAM behavior, not obvious from the error text alone: without
  bucket-level `s3:ListBucket`, a `GetObject` on a key that genuinely doesn't exist
  returns `403 AccessDenied` (mentioning `ListBucket`) instead of the expected
  `404 NoSuchKey` — S3's way of not confirming/denying object existence to a caller who
  can't list the bucket. `S3Storage.get()` (`src/render/s3Storage.ts`) only ever handled
  `err.name === "NoSuchKey"`; this 403 fell through and bubbled up as a real error. The
  instance role's policy only ever granted `s3:{Put,Get}Object` on `.../*` — `ListBucket`
  (a different action, on the bucket ARN with no trailing `/*`) was never included,
  because every prior test either hit cache (`preview_look`, pre-seeded) or used local
  storage (`RENDER_MODE=local` dev/tests never touch S3 at all).
- **Severity** — critical — this is the compare step of the demo's own headline flow
  ("show me the magenta one... now the navy one... compare them"), and it was silently
  broken in prod for any pair of looks that hadn't already been compared once by
  someone else first. Zero unit-test coverage could have caught it either: the test
  suite's S3 testing is parity-tested against DynamoDB Local, not against IAM-permission
  edge cases, since local fakes don't model S3's existence-check behavior.
- **Fix** — Added an `S3BucketList` statement (`s3:ListBucket` on the bucket ARN, not
  `.../*`) to the `wardrobe-mcp-instance-permissions` inline policy on
  `wardrobe-mcp-apprunner-instance`. IAM changes need no redeploy; the very next
  `compare_looks` call for that same pair succeeded immediately. Applied by the project
  owner directly (IAM/security-setting changes aren't something an agent should apply on
  its own, regardless of instruction).
- **Suggestion** — (AWS) the S3 `403`-for-a-missing-key-without-ListBucket behavior is
  well-documented AWS trivia, but surprising to anyone who reaches for S3 as "just a
  key-value store" — a clearer error (naming the actual missing grant pattern, or at
  least distinguishing it from a real `AccessDenied` on an object that *does* exist)
  would have saved real time here. (Project) `S3Storage.get()` should probably treat any
  `403`/`AccessDenied` on a `GetObject` the same as `NoSuchKey` for cache-read purposes —
  a permissions problem serious enough to need fixing shouldn't silently masquerade as
  "no cached render yet" either, so this needs a decision, not a blind catch-all.

## 12. Render cache keys (and therefore render URLs) were computable offline, with no credentials

- **Task** — Security review of the deployed app.
- **Steps** — The cache key is `sha256(photoId + garmentId + tryonAppVersion +
  mode).slice(0,32)`; the S3 bucket policy grants `s3:GetObject` to `Principal: "*"`
  (needed so CloudFront can serve images without a signing layer). All four key inputs
  are low-entropy and either public (`tryonAppVersion`, `mode`) or easily guessed
  (`photoId`/`garmentId` — `seed.ts` always uses `"photo-1"`, and every garment id is
  public catalog data). Computed the key for every catalog garment offline, with no
  access to the service at all, and confirmed by downloading: every one matched a real
  object in the live bucket.
- **Expected vs actual** — The 32-hex-char key reads as "unguessable," but it isn't one —
  it's a hash of mostly-public values, which is pseudonymization, not access control.
  Anyone who knows (or guesses) a user's photo id and a garment id can fetch that
  person's rendered try-on image with zero credentials.
- **Severity** — critical for anything beyond a hackathon demo catalog — this is a photo
  of a real person's body, served to anyone who can compute a hash.
- **Fix** — Added `Photo.renderSalt`: a random value generated once per photo (by the
  `Store`, never caller-supplied) and mixed into the cache key. `addPhoto` preserves the
  existing salt across a re-seed/re-upload of the same photo id (SQLite: excluded from
  the `ON CONFLICT` update; DynamoDB: read-before-write to reuse it) so repeat seeding
  doesn't orphan already-cached renders. A migration backfills a real random salt for
  any pre-existing SQLite row that predates this column.
- **Operational note** — This changes the cache-key format, so **prod needs re-seeding**
  after this deploys: the old (unsalted) cache keys are simply a different key space now,
  not corrupted, but `preview_look`/`compare_looks` will see them as cache misses until
  `scripts/seed.ts` is re-run against the deployed DynamoDB/S3 (same procedure as
  `docs/aws.md`'s original prod-seed entry).
- **Suggestion** — (general) a content-addressed cache key built from inputs an attacker
  can enumerate is a common trap — it feels like a capability URL but isn't one. The
  salt (or a signed URL / OAC + private bucket) is required, not optional, the moment
  the photo behind it is a real person's.

## 13. `garmentId` was never validated against the catalog before hitting the filesystem

- **Task** — Same security review.
- **Steps** — `preview_look` and `save_look` passed `input.garmentId` straight through
  to the render pipeline with no check against the catalog. Verified live (local store):
  a `garmentId` of `"../../../../../../tmp/pwned-<timestamp>"` was accepted, enqueued a
  real render job, and reached `assets.ts`'s `cached()` helper, which joined it directly
  into a filesystem path before fetching.
- **Expected vs actual** — Expected a clean "not in the catalog" refusal. Actual: the
  tool call succeeded (`{status:"rendering"}`), and a permanent `RENDER#` row (DynamoDB)
  / `render_jobs` row (SQLite) got created for every distinct garbage value — these rows
  have no TTL and nothing ever cleans them up, so this is also an unbounded storage-growth
  and wasted-compute vector, not just a traversal primitive.
- **Severity** — high. Today it only reaches a 404 (no file happened to exist at the
  resolved path), but the primitive is real, and `assets.ts` is one refactor away from a
  read that matters.
- **Fix** — `preview_look`/`save_look` now call `getGarment(garmentId)` and refuse with a
  normal tool error before enqueueing anything, matching what `add_to_wardrobe` already
  did. Also hardened `assets.ts` itself (defense in depth, since validation living only
  in the tool layer is one missed call site away from being bypassed again): every path
  segment derived from a caller-supplied id now goes through `basename()` before being
  joined onto a directory.
- **Suggestion** — validate at the tool boundary for every id that flows into a file
  path or cache key, not just the ones that happen to need it for UX reasons (a friendly
  "garment not found" message) — the security property and the UX property look similar
  but aren't the same check, and this bug shipped because only the UX one existed
  (`add_to_wardrobe` has a nice error message; `preview_look`/`save_look` didn't, and
  that was the only thing missing).

## 14. Unexpected internal exceptions reached the MCP client verbatim

- **Task** — Same security review, following directly from friction log #11's
  `compare_looks` incident.
- **Steps** — `registerTools.ts`'s per-tool `try/catch` returned `err.message` for
  *anything* thrown, not just deliberate validation refusals. Friction log #11's S3
  `AccessDenied` (naming the App Runner instance role's full ARN and the AWS account id)
  reached the MCP client through exactly this path.
- **Expected vs actual** — Expected internal exceptions to be opaque to the caller.
  Actual: any unhandled exception from a store or render call — AWS SDK errors
  especially — was shown to the client with full detail.
- **Severity** — medium. Not itself a way in, but a reconnaissance gift to anyone
  probing the server, and it already leaked real infrastructure identifiers once.
- **Fix** — Added `ToolError` (`src/mcp/context.ts`), the one exception type a tool is
  expected to throw for a safe-to-speak refusal (`requireRead`/`requireWrite` already did
  this; nothing else in the codebase threw a message meant for the client — confirmed by
  grepping every `throw new Error` site). `registerTools.ts`'s catch-all now shows
  `ToolError` messages verbatim and masks everything else behind a generic message,
  logging the real exception server-side with the tool name. Regression test
  (`test/mcp/errorMasking.test.ts`) asserts both halves: a raw exception containing an
  account id/ARN never reaches the client, and a deliberate `ToolError` (missing scope)
  still does, verbatim.

## 15. Ops hardening pass surfaced a real crash: malformed `POST /link` threw unhandled

- **Task** — Same security review: no rate limiting anywhere, `/healthz` never touched
  the store so App Runner couldn't tell "process up" from "process up, DynamoDB
  unreachable," no way to tell which commit a deployed instance was running (directly
  related to how friction log #11's stale-image bug stayed hidden), no graceful shutdown.
- **Steps (the fixes)** — Added `src/auth/rateLimit.ts`, a small fixed-window in-process
  limiter keyed by client IP (`X-Forwarded-For`, falling back to the raw socket address),
  applied to `/link`, `/oauth/token`, `/api/simulate/turn` (20/min — the Bedrock proxy
  from friction log #9/#14, unmetered until now) and `/mcp` (120/min). `/healthz?deep=1`
  now does a real `store.getUser()` round trip. Added `GET /version` reporting
  `package.json`'s version plus `GIT_SHA` (a new Docker build arg, `--build-arg
  GIT_SHA=$(git rev-parse --short HEAD)` — see `docs/aws.md`). Added `SIGTERM`/`SIGINT`
  handlers that close the HTTP server cleanly instead of letting App Runner sever
  in-flight requests on every deploy.
- **What the new tests caught** — Writing a basic "hit `/link` a few times, confirm it
  eventually 429s, confirm an unrelated IP doesn't" test tripped a **real, pre-existing
  crash**: `POST /link` with an unrecognized `userId` re-renders the consent page via
  `renderLinkPage(p, ...)`, which does `new URL(p.resource).host` — and the resource
  format wasn't validated until *after* that unrecognized-user check. An incomplete form
  post (missing or malformed `resource`) threw an unhandled `TypeError` and the request
  came back as a bare, unhelpful `500 Internal Server Error` instead of a clean `400`.
  Hono's default error handler happened to not leak the stack trace to the client here
  (unlike friction log #14's bug, which did), but the crash itself was real and would
  have confused a legitimate OAuth client sending slightly malformed data far more than
  any deliberate attack.
- **Severity** — medium (no information disclosure this time, but a real unhandled
  exception on a public, unauthenticated endpoint, found by writing one ops test, not by
  deliberately looking for it).
- **Fix** — Reordered `/link`'s validation: `resource` and `scope` are now checked
  *before* the unrecognized-user branch, so `renderLinkPage` is never called with
  unvalidated input. `test/server/ops.test.ts` has both the rate-limit tests and a
  dedicated regression test for the crash (malformed `resource` → clean `400`, not `500`).
- **Suggestion** — this is the second time in two friction-log entries that writing a
  test for one thing (rate limiting) found a real bug in something else entirely
  (request validation ordering) — a point in favor of actually writing the "boring" ops
  tests rather than treating them as a checkbox; they kept finding real bugs no amount of
  staring at the code did.
