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

- _pending — Phase 1 manual run._

## `alexa-ai` CLI

- _pending — Phase 0._

## AWS App Runner

- **Used for** — hosting the container from an ECR image (`apprunner.yaml` + `Dockerfile`).
- **What worked** — image → HTTPS service with autoscaling and a managed cert is genuinely
  a few clicks; `min instances = 1` is the one setting that matters for the 500 ms budget.
- **What needs work** — no way to run a one-off "migrate" task (we ship `npm run aws:table`
  as a separate step); build-from-source is Node-version-pinned and lagged what we needed,
  so image-based is the only sane path.
- **Would use again?** — Yes for a demo; a bigger service would want ECS/Fargate for the
  task-runner and networking control.

## Amazon Bedrock (garment auto-tagging)

- **Used for** — the one LLM call in the system: garment photo → `{name,color,category,
  occasion[]}` at upload time (`ConverseCommand`, `amazon.nova-lite-v1:0`).
- **What worked** — the Converse API's `{ image: { format, source: { bytes } } }` content
  block is clean; `temperature: 0` + a JSON-only system prompt is reliable enough that a
  `zod` parse on the reply is all the guarding needed.
- **What needs work** — model access is opt-in per-region per-model in the console before
  the API works at all (opaque `AccessDeniedException` until you do); no native
  "respond as JSON schema" mode, so we string-slice `{ … }` out of the reply.
- **Would use again?** — Yes.

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
