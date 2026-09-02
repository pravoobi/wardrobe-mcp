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
