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
  in the docs that `outputSchema` is optional but recommended.
- **Onboarding** — Good. The `registerTool`/`registerResource`/`registerPrompt` trio is discoverable.
- **Would use again?** — Yes.

## MCP Inspector

- _pending — Phase 1 manual run._

## `alexa-ai` CLI

- _pending — Phase 0._

## AWS App Runner

- _pending — Phase 3._

## Amazon Bedrock (garment auto-tagging)

- _pending — Phase 3._

## Amazon DynamoDB

- _pending — Phase 3._

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
