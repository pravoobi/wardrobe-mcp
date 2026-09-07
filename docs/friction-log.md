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
- **Expected vs actual** — Expected WebGPU with the unsafe flag. Actual: `navigator.gpu` is
  absent and the page logs `Failed to create default WebGPU device: No GPU adapter found`.
  LiteRT registers the CPU accelerator and the pipeline still runs — correct output — but
  the segmentation/warp is slow enough that a cold render takes tens of seconds on a CI-class
  host, and the test-photo buttons stay `disabled` for over two minutes while models load.
- **Severity** — important (shapes the whole rendering architecture).
- **Workaround** — Two render modes. `RENDER_MODE=local` (default) composes a look card
  with `sharp` from the flat garment PNG + the customer photo — fast, deterministic, offline,
  honest (it pairs garment with person, it does not warp). `RENDER_MODE=browser` is the real
  bridge, opt-in, for a GPU-capable host or an `xvfb` display. Rendering is pre-computed and
  cached either way, so it never touches a tool-call path.
- **Suggestion** — (try-on / LiteRT.js) a documented "offline render" entry point that
  forces the CPU backend and resolves a promise when the composite is on the canvas would
  make headless automation reliable; today we poll canvas-pixel stability. Also: keep the
  test-photo buttons enabled and queue the click, rather than gating them on model load.

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
- **Workaround** — None yet; this is the same new-account verification hold as
  CloudFront/App Runner (friction log — see App Runner/CloudFront ops notes), now
  apparently widened to cover Bedrock too. Filed one AWS Support case covering all
  three; until it clears, `TAGGING_PROVIDER=none` and the Phase 5 reasoning loop both
  have to be demoed against expectations set accordingly, or with a temporary
  rule-based stand-in.
- **Suggestion** — If Bedrock access is genuinely tied to the same account-verification
  gate as CloudFront/App Runner, the `ValidationException` message should say so
  (`"Account pending verification"`) instead of the generic, unsearchable "Operation not
  allowed" — and ideally a single account-level banner/console page would show every
  service currently gated by an open verification case, instead of each one failing
  independently and looking like unrelated bugs.
