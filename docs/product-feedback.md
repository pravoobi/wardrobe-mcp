# Product feedback

Per tool / API / SDK used. Filled in as we go, submitted with the Devpost entry.
For each: **used for** · **what worked** · **what needs work** · **onboarding** · **would use again?**

---

## `@modelcontextprotocol/sdk` (TypeScript, v1.30.0)

- **Used for** — MCP server on `/mcp` (Streamable HTTP, stateless), and the client in tests/smoke.
- **What worked** — `McpServer.registerTool` with a Zod raw shape is terse; protocol
  negotiation returned `2025-11-25` with no config. Stateless mode via
  `sessionIdGenerator: undefined` is exactly the App Runner story.
- **What needs work** — Transport is coupled to Node `http` types (see friction log #3).
  `structuredContent` only surfaces on the client when the result carries it — worth a note
  in the docs that `outputSchema` is optional but recommended. The built-in resource-server
  auth helpers all add `WWW-Authenticate` to a `401`, which Alexa+ rejects (friction log
  #7) — we had to bypass them.
- **Onboarding** — Good. The `registerTool`/`registerResource`/`registerPrompt` trio is discoverable.
- **Would use again?** — Yes.

## MCP Inspector

- **Used for** — Phase 1's "run it by hand" verification (v2.5.0, `--web`), against the
  live cloudflared tunnel — real remote HTTPS, real `mcp-inspector-local` OAuth client,
  not the `dev_*` shortcut.
- **What worked** — its own OAuth-discovery requests (`/.well-known/oauth-*`) found and
  read both documents correctly; the redesigned v2.5.0 UI (multi-server list, per-request
  network log with expandable request/response detail) is a big step up from the older
  single-server sidebar and made the actual bug (below) traceable at all.
- **What needs work — found a real server bug through this, not an Inspector bug**: our
  `POST /mcp` failed instantly from Inspector's web UI with an opaque `TypeError: Failed
  to fetch` and no further detail. Traced it myself (page-context `fetch()` + manual
  `curl -X OPTIONS` with an `Origin` header): the server had zero CORS configuration —
  no preflight handler, no `Access-Control-Allow-Origin` anywhere. Every other
  verification method we'd used (curl, our own same-origin simulator, the Node e2e
  test's SDK client) is either server-side or same-origin, so none of them could have
  caught a cross-origin-browser-client bug — Inspector's web UI is the first thing that
  actually exercised that path. Fixed with `hono/cors` (friction log #10); worth noting
  this is exactly the gap a widely-used debugging tool exists to catch, and did.
- Separately, Inspector also probed `/.well-known/oauth-protected-resource/mcp` (a
  path-suffixed PRM variant per RFC 9728) which 404'd — we only serve the bare path.
  Didn't chase whether that's load-bearing for anything; noted for later.
- **Onboarding** — Adding a Streamable HTTP server (name, transport dropdown, URL) is
  three fields, no friction. Diagnosing the actual failure required manually reproducing
  the request outside Inspector (page-context `fetch`, then `curl`) — the UI shows
  "Failed"/"Error" with a timestamp and duration but the underlying browser network error
  message it surfaces (`TypeError: Failed to fetch`) carries no actionable detail, which
  is a browser/fetch-API limitation more than an Inspector one.
- **Would use again?** — Yes — it's the reason this project's CORS gap got caught before
  the deadline instead of after.

## `alexa-ai` CLI / Alexa+ add-ons console

- **Used for** — was going to be Phase 4 (create + deploy the Alexa+ add-on).
- **What worked** — nothing yet; never got past the console.
- **What needs work** — `/alexa/console/ask/addons#/` shows "coming soon," and the docs
  separately say the MCP Toolkit is "available for select partners only." The public
  quickstart reads as if this is self-serve GA (`alexa-ai configure` → `new mcp` →
  `deploy`); there's no mention anywhere in the quickstart that it's an allowlisted
  partner program. Pivoted to Devpost's officially-sanctioned simulated-experience path.
- **Onboarding** — Blocked at step 0.
- **Would use again?** — Can't evaluate — never got access.

## AWS App Runner

- **Used for** — hosting the container from an ECR image (`apprunner.yaml` + `Dockerfile`).
  **Live at https://ba93fetekm.us-east-1.awsapprunner.com** (0.25 vCPU / 0.5 GB, default
  autoscaling so `MinSize: 1` keeps it warm).
- **What worked** — image → HTTPS service with autoscaling and a managed cert really is a
  few minutes once the account can use it; `min instances = 1` is the one setting that
  matters for the 500 ms budget, and it delivered: measured from a us-east-1 CloudShell,
  `suggest_outfits` 90 ms (37–50 ms on repeat), `preview_look` 127–152 ms, `compare_looks`
  123 ms. Redeploys via `start-deployment` are ~5 minutes and uneventful.
- **What needs work** — (1) `create-service` on a freshly created account (ECR, DynamoDB,
  S3, IAM roles all worked fine minutes earlier) failed with
  `SubscriptionRequiredException: The AWS Access Key Id needs a subscription for the
  service` — no link, no indication of what "subscription" means or how to get one. It was
  a new-account verification hold (same root cause as CloudFront and Bedrock below), and we
  found that connection only by noticing the error shapes matched, not from anything AWS
  surfaced. It took five weeks and a support exception to clear. (2) A service deployed
  from an image tag doesn't tell you *which build* is running, which let a stale image sit
  in production unnoticed — we ended up adding our own `/version` endpoint fed by a
  `GIT_SHA` build arg to find out. A built-in "image digest currently serving" readout in
  `describe-service` output would have saved that whole debugging session.
- **Would use again?** — Yes. Once the account hold cleared, App Runner did exactly what it
  promises and the latency numbers speak for themselves; it's the first-run experience for
  a brand-new account that needs the work, not the service.

## Amazon CloudFront

- **Used for** — HTTPS edge delivery of rendered-look images in front of the S3 bucket.
  **Live**: distribution `E3SKL73S4R9ECD` → `dyswjdrhfb962.cloudfront.net`, serving every
  `preview_look` / `compare_looks` image the demo shows.
- **What worked** — once the account cleared, `create-distribution` → `Deployed` took about
  10 minutes and needed no code change at all: `CLOUDFRONT_BASE_URL` is only ever used as a
  URL prefix, so the interim S3-direct endpoint and the real distribution are a one-env-var
  swap. Caching immutable, content-addressed objects at the edge is exactly the easy case.
- **What needs work** — `create-distribution` on this freshly created account failed with
  `AccessDenied: Your account must be verified before you can add new CloudFront resources.
  ... contact AWS Support.` At least this one names the real cause (unlike App Runner's
  `SubscriptionRequiredException`), but there's no self-service path and no ETA — just
  "open a support case and wait," which took five weeks. For a time-boxed hackathon, an
  unpredictable verification SLA on a core "ship it live" service is a real risk. A second,
  subtler gap: `list-distributions` succeeds under this hold while `create-distribution` is
  refused, so a clean read call reads as "access is fine" when it isn't — we briefly
  believed the block had lifted because of exactly that.
- **Would use again?** — Yes, without hesitation, now that it's running.

## Amazon Bedrock (garment auto-tagging + the Phase 5 simulator's reasoning loop)

- **Used for** — the one-time LLM call for garment photo → `{name,color,category,
  occasion[]}` (`ConverseCommand`, `amazon.nova-lite-v1:0`); later, the same pattern for
  Phase 5's tool-selection loop for the simulated Alexa+ web app.
- **What worked** — the Converse API's `{ image: { format, source: { bytes } } }` content
  block is clean; `temperature: 0` + a JSON-only system prompt is reliable enough that a
  `zod` parse on the reply is all the guarding needed. Model access (`amazon.nova-lite-v1:0`,
  `us-east-1`) was already granted when first checked, and a plain `Converse` call worked.
- **What needs work** — Two days later, with zero code or IAM changes, the *identical*
  request started failing: `ValidationException: Operation not allowed` — reproduced on
  both `Converse` and the raw `InvokeModel`, and on both Nova Lite and Claude Haiku,
  ruling out anything model-specific. This landed the same day App Runner and CloudFront
  started refusing with account-verification errors, which is the more likely explanation
  than three coincidental unrelated failures — but Bedrock's error message gives no hint
  it's the same root cause; `ValidationException: Operation not allowed` is generic and
  unsearchable, versus CloudFront's much more actionable "must be verified" message. If
  a new-account verification hold can silently widen mid-session to cover a service that
  was working an hour before, that should be visible somewhere (a console banner, a
  clearer error), not discovered by noticing three different services fail the same week.
- **Resolution + what's live now** — the support exception cleared Bedrock along with App
  Runner and CloudFront (2026-10-14). The tell that it had actually cleared was the error
  *changing*: `ValidationException: Operation not allowed` became
  `ThrottlingException: Too many tokens per day`, i.e. a quota message, which only fires
  once the call is genuinely permitted. Worth noting for anyone else debugging this — the
  shape of the refusal is the signal, since nothing else surfaces the state. Support also
  confirmed the exception covers standard-tier models (Nova Lite included) but not
  higher-tier ones, which need more account history.
- **A note on the fallback, since it's visible in the demo** — because Bedrock was down for
  most of the build, `src/web/ruleReasoner.ts` (a small deterministic intent matcher
  returning the exact `{message, stopReason}` shape Converse does) stands in automatically
  on any Bedrock error, and the response is tagged `reasoner: "bedrock" | "rule-based"` so
  the UI labels it honestly rather than pretending. It reverts to real Bedrock the moment a
  call succeeds, with no config to flip back.
- **Would use again?** — Yes for the API itself; the account-trust/verification story
  needs to be one visible, predictable thing, not three separate mystery errors.

## Amazon DynamoDB (`@aws-sdk/lib-dynamodb`)

- **Used for** — the prod `Store`: single table, `PK`+`SK`, GSI1 for OAuth token rotation,
  `ttl` for auth state.
- **What worked** — `DynamoDBDocumentClient` with `marshallOptions.removeUndefinedValues`
  makes the impl read like plain objects. DynamoDB Local in Docker runs the exact same
  `Store` contract suite as SQLite — real parity coverage.
- **What needs work** — `UpdateExpression` rejects the whole request if
  `ExpressionAttributeNames` contains a key the expression doesn't reference (so conditional
  `SET` clauses need conditionally-built names too) — the error text is clear but it's a
  papercut every time.
- **Would use again?** — Yes.

## Amazon S3 (+ IAM)

- **Used for** — every rendered look and compare sheet (immutable, content-addressed WEBP),
  bucket `wardrobe-looks-064308050230`, read through CloudFront.
- **What worked** — write-once/read-many content-addressed objects with
  `CacheControl: public, max-age=31536000, immutable` is the easy, boring, correct case.
  No surprises.
- **What needs work** — a `GetObject` for a key that simply **doesn't exist** returns `403
  AccessDenied` (naming `s3:ListBucket`) rather than `404 NoSuchKey`, when the caller has
  object-level `GetObject` but not bucket-level `ListBucket`. That's documented AWS
  behaviour, but it's genuinely surprising if you reach for S3 as a key-value store, and it
  cost us a production bug: our cache-read path caught `NoSuchKey` and nothing else, so
  every *first* `compare_looks` for a given pair — the demo's own headline step — failed
  with a raw `AccessDenied` instead of quietly composing the sheet. An error that
  distinguished "missing, and you can't list" from "exists, and you can't read" would have
  made this a one-minute fix rather than a live debugging session. (Friction log #11.)
- **Would use again?** — Yes. The fix was one IAM statement; the lesson was about the error
  message, not the service.

## Amazon ECR

- **Used for** — the container registry App Runner pulls from.
- **What worked** — `get-login-password | docker login` then push is two commands and works
  exactly as documented. Scan-on-push by default is a nice touch.
- **What needs work** — small thing with real consequences: if the `docker login` token has
  expired, `docker push` fails partway through with an opaque
  `unexpected status from HEAD request ... 403 Forbidden` on a blob, rather than anything
  saying "your registry auth expired, log in again." We lost a few minutes to that before
  recognising it.
- **Would use again?** — Yes.

## Playwright (headless Chromium)

- **Used for** — the renderer bridge: opening the deployed try-on app and driving its WebMCP
  tools, then snapshotting the result canvas.
- **What worked** — `chromium.launch` + `page.evaluate` is exactly the right primitive;
  `setInputFiles` with an in-memory buffer covers the photo-upload path without touching disk.
  `npx playwright install chromium` was a single clean step.
- **What needs work** — No WebGPU in headless Chromium even with `--enable-unsafe-webgpu`
  (see friction log #4), so GPU-bound page workloads fall back to CPU. `waitForFunction`'s
  signature is `(fn, arg, options)` — passing `{ timeout }` as the 2nd arg silently uses the
  default 30 s; easy to miss.
- **Onboarding** — Good.
- **Would use again?** — Yes.

## WebMCP (`document.modelContext`) — consuming a page's tools

- **Used for** — calling the try-on app's `apply_tryon` / `save_look` from the render worker.
- **What worked** — Once the call shape is known (`.tools.get(name).execute(args)`), it
  returns a standard MCP `CallToolResult` — the same contract as our remote server, which is
  the whole "one contract, two transports" thesis.
- **What needs work** — The agent-side call is undocumented; `document.modelContext` is the
  provider server object and its `executeTool` is for internal use (see friction log #5).
- **Would use again?** — Yes — this is the pattern the project is built on.
