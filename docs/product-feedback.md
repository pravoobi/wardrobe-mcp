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

## Playwright (headless Chromium, WebGPU/Wasm fallback)

- _pending — Phase 2._
