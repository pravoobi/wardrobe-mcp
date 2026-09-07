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
- **What worked** — image → HTTPS service with autoscaling and a managed cert is genuinely
  a few clicks, in principle; `min instances = 1` is the one setting that matters for the
  500 ms budget.
- **What needs work** — `create-service` on a freshly created account (ECR, DynamoDB, S3,
  IAM roles all worked fine minutes earlier) failed with `SubscriptionRequiredException:
  The AWS Access Key Id needs a subscription for the service` — no link, no indication of
  what "subscription" means or how to get one. Turned out to be a new-account verification
  hold (same class of issue as CloudFront below); found that connection only by noticing
  the error shapes matched, not from anything AWS surfaced.
- **Would use again?** — Untested end-to-end; the console-side promise is good, the
  first-run experience for a brand-new account was not.

## Amazon CloudFront

- **Used for** — HTTPS edge delivery of rendered-look images in front of the S3 bucket.
- **What needs work** — `create-distribution` on this same freshly created account failed
  with `AccessDenied: Your account must be verified before you can add new CloudFront
  resources. ... contact AWS Support.` At least this one names the real cause (unlike App
  Runner's `SubscriptionRequiredException`), but there's no self-service path or ETA —
  just "open a support case and wait." For a time-boxed hackathon, an unpredictable
  verification SLA on a core "ship it live" service is a real risk; we worked around it by
  pointing `CLOUDFRONT_BASE_URL` straight at the S3 bucket's own HTTPS endpoint, which the
  code treats identically since it's just a URL prefix.
- **Would use again?** — Yes, once verified — the workaround is one env var away from the
  real thing, no code change needed either way.

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
