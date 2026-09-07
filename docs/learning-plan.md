# Learning plan — understanding wardrobe-mcp from the ground up

A guide for going from "what is any of this" to "I understand what this codebase does
and why," written against **this specific project**, not generic tutorials. Every module
says what it's for here, points at the actual file that uses it, and gives 2-4 resources
to go deeper. Skim the "why it's here" paragraphs even if you skip everything else —
they're the fastest way to see how the pieces fit together.

## How to use this

- Do **Part 0** first — running the thing before reading about it makes everything after
  it concrete instead of abstract.
- Then go roughly in order; later modules assume earlier ones. Modules marked **core**
  are worth understanding properly; **supporting** modules you can skim now and come back
  to when you hit them in the code.
- After each module, open the file(s) it points at and just read them. You don't need to
  understand every line — pattern-matching "oh, that's the PKCE thing from the OAuth
  module" is the goal.
- 20 modules looks like a lot. It isn't a syllabus you must finish — see
  ["if you have limited time"](#suggested-order-if-you-have-limited-time) near the end for
  the 3-hour path.
- This is a hackathon project, so the code is the ground truth. If this file and the code
  disagree, trust the code and fix this file.

---

## Part 0 — Get it running first (30 minutes, hands-on)

Don't read code yet. Just make it work and click around.

```bash
npm install            # download dependencies listed in package.json
cp .env.example .env   # local settings (safe defaults, nothing secret)
npm run seed           # create the demo user + pre-render every look
npm run dev            # start the server on http://localhost:3000
```

Then, in a browser:

1. Open **http://localhost:3000/simulator** — the simulated Alexa+ chat UI.
2. Click **Connect** → you'll be sent to a real login/consent page → "Continue as
   Praveen" → you land back, connected. *You just completed a real OAuth 2.1 flow.*
3. Click the "I have a sangeet on Saturday…" phrase, then "Show me the first one on me,"
   "Save that," "Now show me another option," "Save that," "Compare them."

In a second terminal, poke the same server directly:

```bash
curl http://localhost:3000/healthz                                   # is it alive?
curl -i -X POST http://localhost:3000/mcp -d '{}'                    # 401 — no token
npm test                                                             # the whole test suite
npm run smoke                                                        # end-to-end flow check
```

Everything after this is an explanation of something you just watched happen. If you only
have one hour total, do this part plus Modules 1, 5 and 6.

---

## Module 1 — What this project actually is *(core)*

An **MCP server** (a backend that an AI assistant can call tools on) that knows a
customer's wardrobe, and can show what a garment looks like on them using an existing
virtual try-on web app. Alexa+ — or, right now, a simulated stand-in for it — talks to
this server over the internet, the server checks who's asking (OAuth), looks something up
or serves a pre-rendered image, and replies. That's the whole shape; everything below is
one of the pieces that makes it work safely, quickly, and remotely.

**A bit of context on the "simulated" part:** Amazon's Alexa+ lets developers publish
"add-ons" backed by an MCP server — that was the original target. That console turned out
to be invite-only ("coming soon" for everyone else), so the project pivoted to a simulated
Alexa+ client that drives the *same real server* the same way. Devpost's rules explicitly
allow this. The story is in `docs/friction-log.md` entries #8–#10 — worth reading not for
the Alexa+ specifics but as a worked example of *how to handle an external blocker
honestly*: verify it, document it, find the sanctioned alternative, keep building.

**Where in this repo:** `README.md` top section, `CLAUDE.md` ("What this project is").

**Resources:**
- [Alexa developer site](https://developer.amazon.com/en-US/alexa) (context on the platform this targets)

---

## Module 2 — Node.js, npm, and how this repo is wired *(core)*

**Why it's here:** the whole server runs on Node.js, and every command you ran in Part 0
came from `package.json`. Understanding this file is understanding how to operate the
project.

- **Node.js** runs JavaScript outside a browser — that's what makes a JS "backend"
  possible at all.
- **npm** installs libraries and runs scripts. `npm install` reads `package.json` and
  downloads everything into `node_modules/` (never committed to git — it's regenerated).
- **`dependencies` vs `devDependencies`** — dependencies ship to production (Hono, Zod,
  the AWS SDK); devDependencies are build/test-only (TypeScript, Vitest, esbuild,
  Playwright). The Dockerfile installs only `dependencies` for the final image, which is
  why it stays smaller.
- **`package.json` scripts** are just named shell commands: `npm run dev`, `npm test`,
  `npm run seed`. Read them once and you know every operation this project supports.
- **`package-lock.json`** pins exact versions so everyone gets identical installs. Commit
  it; don't edit it by hand.

**Where in this repo:** `package.json` — read the whole `scripts` block, it's ~12 lines
and it's the project's control panel.

**Resources:**
- [Introduction to Node.js](https://nodejs.org/en/learn/getting-started/introduction-to-nodejs)
- [npm docs](https://docs.npmjs.com/)
- [MDN: Server-side website programming](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Server-side) (if "what even is a backend" is still fuzzy)

---

## Module 3 — HTTP, APIs, and JSON-RPC *(core)*

**Why it's here:** MCP is built on ordinary HTTP requests carrying a specific JSON message
format (JSON-RPC). If HTTP and JSON are already comfortable, skim and move on.

- An HTTP request has a method (GET/POST/…), a URL, headers, and optionally a body. A
  response has a status code (200 = ok, 401 = you're not authenticated, 404 = no such
  thing, 500 = server broke), headers, and a body.
- JSON-RPC is a convention for JSON bodies: `{"method": "...", "params": {...}, "id": 1}`
  in, `{"result": {...}, "id": 1}` back. MCP uses this shape for every tool call.

**Where in this repo:** `test/auth/bearer.test.ts` sends a raw JSON-RPC body by hand —
the fastest way to see the shape with no library hiding it.

**Resources:**
- [MDN: An overview of HTTP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Overview)
- [JSON-RPC 2.0 spec](https://www.jsonrpc.org/specification) (short — 10 min read)

---

## Module 4 — TypeScript essentials *(core)*

**Why it's here:** the whole server is TypeScript. You don't need expertise, but you'll be
reading types constantly.

- **Types** describe the shape of data (`{ userId: string; scopes: string[] }`).
  **Interfaces** name a shape so it can be reused.
- **`async`/`await`** — almost everything here is asynchronous (network, disk). `await`
  means "pause here until that finishes."
- **ESM modules** (`import`/`export`) — this project uses `"type": "module"` with
  `NodeNext` resolution, which is why relative imports end in `.js` even though the source
  is `.ts`: TypeScript compiles `.ts` → `.js`, and the import path has to match what will
  exist *at runtime*, not what you're looking at now. This confuses everyone once.
- **Strict mode** is on, so the compiler refuses `any` sloppiness in `src/mcp/tools/` and
  `src/auth/`. That's deliberate — those are the parts where a wrong type means a security
  or protocol bug.

**Where in this repo:** `src/store/types.ts` — almost pure type definitions, no logic, so
you see the data model without distraction.

**Resources:**
- [TypeScript Handbook — the basics](https://www.typescriptlang.org/docs/handbook/2/basic-types.html)
- [TypeScript for JS programmers](https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes.html)
- [TS Handbook — Modules](https://www.typescriptlang.org/docs/handbook/modules/introduction.html) (for the `.js`-extension thing)

---

## Module 5 — Model Context Protocol (MCP) *(core — the whole point of this project)*

**Why it's here:** this is the actual subject. MCP is a standard way for an AI assistant
(a "client" — Alexa+, Claude, MCP Inspector) to discover and call **tools** on a server,
read **resources**, and use **prompt** templates, without needing custom code per server.

- A **tool** is a named function with a typed input schema and a description written *for
  the AI to read* — the description tells the assistant when and how to use it. In this
  project the descriptions are written for a voice assistant, e.g. "After showing a
  preview, ask how it looks — only the customer can judge fit."
- A **resource** is a URI-addressable piece of data the client can fetch.
- **Transports** are how the messages travel. This project uses **Streamable HTTP** (over
  the network, what a remote assistant needs). The other common one is **stdio**, where
  the server runs as a local subprocess — that's what the `filesystem-server-default`
  example in MCP Inspector uses.
- **Stateless mode** matters here: the server holds no per-connection session, so any
  instance can answer any request — which is what lets it scale behind App Runner.

**Where in this repo:**
- `src/mcp/registerTools.ts` — every tool in one place. Read the `description` strings
  first; they double as plain-English documentation.
- `src/mcp/tools/suggestOutfits.ts` — one tool start to finish: Zod input schema, handler,
  and a response carrying both spoken `text` and structured JSON.
- `src/server.ts` — where `StreamableHTTPServerTransport` is wired to the `/mcp` route.

**Resources:**
- [modelcontextprotocol.io](https://modelcontextprotocol.io) — official spec site, start here
- [MCP spec — Tools](https://modelcontextprotocol.io/docs/concepts/tools) — the exact
  request/response shapes this server implements
- Best of all: run MCP Inspector against it — `npx @modelcontextprotocol/inspector --web`,
  add a Streamable HTTP server pointed at `http://localhost:3000/mcp`. Seeing your tool
  schemas rendered as forms makes the abstraction click.

---

## Module 6 — OAuth 2.1 and PKCE *(core)*

**Why it's here:** the server must know *who* is calling before handing over someone's
wardrobe. OAuth is the standard way a client gets permission (a token) to act on a user's
behalf without ever seeing their password.

- **Authorization code flow, plainly:** the client sends the user to a login page hosted
  by the server (`/oauth/authorize`); the user logs in and approves; the server redirects
  back with a short-lived **code**; the client trades that code at `/oauth/token` for an
  **access token**; every later request carries `Authorization: Bearer <token>`.
- **PKCE** (say "pixy") protects clients that can't keep a secret, like browser apps. The
  client invents a random `code_verifier`, sends only its hash (`code_challenge`) up
  front, and proves it knew the original when redeeming the code — so a stolen code alone
  is useless.
- **Bearer token** means "whoever holds this is authorized" — like a door key. Hence:
  HTTPS only, short expiry (15 minutes here), and refresh tokens to get new ones.
- **Scopes** (`wardrobe:read`, `wardrobe:write`) limit what a token can do.

**Where in this repo:**
- `src/auth/oauthServer.ts` — the whole flow, hand-rolled. Read `/oauth/authorize`, then
  `/oauth/token`.
- `web/app.ts` — `startLogin`, `challengeFromVerifier`, `exchangeCode`: the *client* side
  of the same dance, in the browser. Reading both sides back-to-back is what makes it
  click.
- `src/auth/bearer.ts` — how each `/mcp` request's token gets checked.
- `test/auth/oauth.test.ts` — every way the flow can be abused, and the rejection for each.
  A great way to learn a protocol is reading its failure cases.

**Resources:**
- [oauth.net — PKCE](https://oauth.net/2/pkce/) (short, visual, exactly this flow)
- [Auth0: Authorization Code Flow with PKCE](https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow-with-proof-key-for-code-exchange-pkce)
- [RFC 8707 — Resource Indicators](https://www.rfc-editor.org/rfc/rfc8707) (the spec behind the `resource` parameter this server requires; optional)

---

## Module 7 — CORS *(supporting — but a real bug lived here)*

**Why it's here:** browsers block JavaScript on one site from reading responses from
another site unless that site opts in. This bit us for real: MCP Inspector's web UI
(`127.0.0.1:6274`) couldn't reach this server (a different origin) until CORS was added.

- **Origin** = scheme + host + port. `http://localhost:3000` and `http://127.0.0.1:6274`
  are different origins even though both are "localhost-ish."
- A **preflight** is an automatic `OPTIONS` request the browser sends first, asking
  permission before the real request.
- The server answers with `Access-Control-Allow-Origin` and friends.
- The symptom is nasty: the browser reports a generic `TypeError: Failed to fetch` with no
  status code, because it deliberately won't tell JavaScript what the blocked response
  said. Learning to recognise that message *as probably CORS* saves hours.

**Where in this repo:** the `cors(...)` middleware near the top of `src/server.ts` (its
comment explains what broke without it), `test/auth/cors.test.ts`, and friction log #10
for the full debugging story.

**Resources:**
- [MDN: Cross-Origin Resource Sharing (CORS)](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)

---

## Module 8 — The web stack: Hono + Zod *(supporting)*

**Why they're here:** Hono routes HTTP requests to handler functions (like Express, but
smaller and portable across runtimes). Zod validates that incoming data matches an
expected shape — and here it does double duty: the *same* Zod schema is both the runtime
validator and the tool's published input schema, so there's one source of truth per tool.

- **Middleware** is code that runs before/around handlers — this project uses it for CORS,
  static files, and Bearer auth.

**Where in this repo:**
- `src/server.ts` — `new Hono()`, `app.get(...)`, `app.use(...)`, `app.on([...], "/mcp", bearerAuth, handleMcp)`.
  Note how `bearerAuth` sits between the route and its handler; that's middleware.
- `src/mcp/tools/previewLook.ts` — the exported `previewLookSchema` is a compact example of
  `z.string()`, `.optional()`, `.describe()`.

**Resources:**
- [Hono — docs](https://hono.dev/docs/)
- [Zod — docs](https://zod.dev)

---

## Module 9 — Configuration and environment variables *(supporting)*

**Why it's here:** the same code has to run on your laptop (SQLite, local files, fake
tokens allowed) and in production (DynamoDB, S3, no fake tokens) without changing a line.
That's done with **environment variables** — settings passed in from outside the program.

- `src/config.ts` reads every env var once, applies defaults, and exports a single frozen
  `config` object. The rule in this codebase: import `config`, never `process.env`
  directly — so there's exactly one place to look up what's configurable.
- `.env.example` is committed as documentation of every knob; `.env` (your real values) is
  gitignored. **Never commit a real `.env`.**
- Some settings are safety-critical: `ALLOW_DEV_TOKENS` turns off automatically when
  `NODE_ENV=production`, so the `dev_praveen` shortcut can't leak into a live server.
- `MCP_CANONICAL_URL` must exactly match the URL clients use, because OAuth validates the
  `resource` parameter against it. Mismatch = confusing "invalid_target" errors. (We hit
  this when switching between localhost and a tunnel URL.)

**Where in this repo:** `src/config.ts`, `.env.example`, and the `environment:` blocks in
`docker-compose.yml` (the same knobs, set a different way).

**Resources:**
- [The Twelve-Factor App — Config](https://12factor.net/config) (short, and it's the philosophy this follows)

---

## Module 10 — Data storage: SQLite and DynamoDB *(supporting)*

**Why they're here:** the server must remember users, wardrobes, saved looks, and OAuth
tokens. SQLite is an entire database in one file — perfect for local dev, zero setup.
DynamoDB is AWS's managed NoSQL database — scales, nothing to run, but works very
differently from SQL (no JOINs; you design keys around the exact lookups you'll perform).

- **Single-table design** (used here for DynamoDB): instead of one table per entity,
  everything lives in one table with composite keys like `USER#praveen` + `LOOK#look-1`,
  so related items can be fetched in a single query.
- **The `Store` interface pattern** is the important lesson: both backends implement the
  same TypeScript interface, so the rest of the app doesn't know or care which is in use —
  and the *same* test suite runs against both to prove they behave identically.

**Where in this repo:** `src/store/Store.ts` (the shared interface), then
`src/store/sqlite.ts` and `src/store/dynamodb.ts` side by side. `test/store/contract.ts`
is the shared test suite; `docs/aws.md` diagrams the actual DynamoDB key layout.

**Resources:**
- [SQLite — About](https://www.sqlite.org/about.html)
- [DynamoDB — core components](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html)
- [DynamoDB — NoSQL design best practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-general-nosql-design.html)

---

## Module 11 — Queues, caching, and the 500 ms budget *(core — this shapes the architecture)*

**Why it's here:** Alexa+ requires a tool call to answer in under 500 ms. Rendering a
garment onto a photo takes *seconds*. Those two facts are irreconcilable — unless
rendering never happens during a request. That constraint is the reason for most of this
project's design.

The pattern:

1. **Pre-compute.** When a user is seeded or adds a garment, renders are kicked off in the
   background for every photo × garment combination.
2. **Cache by content.** Each render is stored under a **cache key** — a hash of
   `photoId + garmentId + try-on app version`. Same inputs → same key → reuse. A new
   try-on release changes the version, which changes every key, which invalidates stale
   renders automatically. That's a very reusable trick.
3. **Never block.** `preview_look` is a *cache read*. On a miss it enqueues the work and
   immediately returns `{ status: "rendering", retryAfterSeconds: 5 }` plus a spoken
   "give me a few seconds and ask again" — a fast, honest answer instead of a slow one.
4. **Dedupe.** Two requests for the same key don't start two renders.

**Where in this repo:** `src/render/queue.ts` (read the comment block at the top first),
and `src/mcp/tools/previewLook.ts` to see the `status: "rendering"` branch in practice.
`CLAUDE.md`'s "Known gotchas" explains the latency reasoning in the project's own words.

**Resources:**
- [MDN: HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching) (different layer, same core idea: a key, a hit, a miss, invalidation)

---

## Module 12 — The renderer bridge: WebMCP + Playwright *(core — the clever bit)*

**Why it's here:** the try-on rendering only runs in a browser (it needs WebGPU/Wasm).
Rather than reimplementing that pipeline in Node, this project launches a real, invisible
("headless") Chromium, opens the existing try-on web app inside it, and calls that page's
*own* browser-side tools.

- **WebMCP** is the pattern where a *web page* exposes MCP-style tools (via
  `document.modelContext`) to whatever is driving the browser, instead of a server
  exposing them over HTTP. The try-on app already had these; this project reuses them
  as-is. Same tool contract, two different transports — that's the project's thesis.
- **Playwright** drives a real browser programmatically: navigate, run JS inside the page,
  screenshot.
- **`sharp`** does the plain image work afterwards (composing two looks into one
  side-by-side compare sheet), which is far cheaper than driving a browser again.

**Where in this repo:** `src/render/worker.ts` (opens try-on, calls `apply_tryon`, grabs
the image), `src/render/compose.ts` (the sharp compare sheet), and the "renderer bridge"
section of `CLAUDE.md` for the *why* in a few sentences.

**Resources:**
- [Playwright — Getting started](https://playwright.dev/docs/intro)
- [sharp — docs](https://sharp.pixelplumbing.com/)
- [MDN: WebGPU API](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API) (why this can't just run in Node)

---

## Module 13 — The build pipeline: tsc and esbuild *(supporting)*

**Why it's here:** two different kinds of "build" happen in this repo, for two different
targets.

- **`tsc`** (the TypeScript compiler) turns `src/**/*.ts` into plain JavaScript in `dist/`
  for Node to run in production. `npm run typecheck` runs it in check-only mode — no
  output, just "are there type errors."
- **`esbuild`** *bundles* the browser code: `web/app.ts` plus every library it imports
  (including the MCP SDK) get flattened into one `web/dist/app.js` the browser can load.
  Browsers can't resolve `node_modules` imports the way Node can, which is why bundling
  exists at all. Bundling locally also means the demo needs **no CDN** and works offline.

**Where in this repo:** `web/build.mjs` (~15 lines — the entire browser build),
`tsconfig.json` vs `tsconfig.build.json` (checking vs emitting), and the `scripts` block
in `package.json` that ties them together.

**Resources:**
- [esbuild — Getting started](https://esbuild.github.io/)

---

## Module 14 — Docker and containers *(supporting)*

**Why it's here:** to run this server anywhere identically, it's packaged into a
**container** — the app plus everything it needs, isolated from the host.

- A **Dockerfile** describes how to build that bundle step by step.
- **Multi-stage builds** (used here) compile in a throwaway stage that has all the dev
  tooling, then copy only the finished output into a small final image.
- **docker-compose** runs containers together with one command — `docker compose up` here
  needs no Node install at all.
- **Volumes** map a host folder into the container so data survives restarts (`./data`,
  `./renders`).
- **Users matter:** the image runs as a non-root user for safety in production, which is
  exactly why `docker-compose.yml` has to override it locally — a real, documented
  trade-off between security and developer convenience.

**Where in this repo:** `Dockerfile` (read top to bottom; the stage comments explain each),
`docker-compose.yml`.

**Resources:**
- [Docker — Get started](https://docs.docker.com/get-started/)
- [Docker — Multi-stage builds](https://docs.docker.com/build/building/multi-stage/)

---

## Module 15 — The AWS services used here *(supporting — go deep only on what you touch)*

**Why they're here:** "hosting in AWS" isn't one thing; it's several services combined.

| Service | Job here | One-line idea |
|---|---|---|
| **App Runner** | Runs the container, gives it a public HTTPS URL, autoscales | "Point me at an image, I'll run it and hand you a URL" |
| **ECR** | Stores the container image | Docker Hub, but private and AWS-native |
| **DynamoDB** | Production database | See Module 10 |
| **S3** | Stores rendered look images | Object storage, reachable over HTTPS |
| **CloudFront** | CDN in front of S3 | Caches files at edge locations for speed |
| **IAM** | Who can do what | Users, roles, policies — e.g. "this App Runner *role* may read this one table and nothing else" |
| **Bedrock** | Managed access to AI models | Call an LLM over an API; no model hosting of your own |

Two ideas worth internalising beyond the names:

- **Roles vs users.** A *user* is a person/CLI identity; a *role* is something a service
  assumes to get temporary permissions. App Runner assumes a role to reach DynamoDB — no
  keys are stored in the app at all. That's the pattern you want.
- **Managed services trade control for operations.** No servers to patch, but you get the
  provider's constraints too — including things like new-account verification gates, which
  blocked this project's deploy (documented in `docs/aws.md` and friction log #9).

**Where in this repo:** `docs/aws.md` has the exact commands used for each service, plus
the blocked-account story — worth reading for the debugging method even though the
specific blocker is ours.

**Resources:**
- [What is AWS App Runner](https://docs.aws.amazon.com/apprunner/latest/dg/what-is-apprunner.html)
- [How IAM works](https://docs.aws.amazon.com/IAM/latest/UserGuide/intro-structure.html)
- [What is Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/what-is-bedrock.html)

---

## Module 16 — Calling an LLM with tools: Bedrock Converse + the fallback pattern *(core)*

**Why it's here:** the simulator's chat needs *something* deciding which wardrobe tool to
call from what the user typed. That's Bedrock's **Converse API**: you send a conversation
plus a list of available tools (name + description + input schema — the same shape MCP
tools already have), and the model replies either with text or with a request to call one
tool with specific arguments. This is **tool use** / **function calling**; the same idea
exists across Anthropic, OpenAI and others with different JSON shapes.

The loop, concretely: user text → model picks a tool → **the browser executes that tool
against the real `/mcp` endpoint** → result goes back to the model → model produces the
spoken reply. Note the division of labour: the model only ever *chooses*; it never touches
the wardrobe data directly. That's a deliberate safety and latency property, and it's why
`CLAUDE.md` insists "no LLM in the request path."

**The fallback pattern** is worth stealing: because Bedrock is currently blocked on this
AWS account, there's a plain keyword matcher that returns *the exact same response shape*
Bedrock would. Nothing downstream can tell the difference, so the demo still runs — and
the UI visibly labels which one answered rather than pretending. Build the dumb-but-
reliable version behind the same interface as the smart-but-fragile one.

**Where in this repo:** `src/web/simulateApi.ts` (the Converse call and the try/catch that
falls back), `src/web/ruleReasoner.ts` (the fallback — short, and every branch is
commented), `web/app.ts`'s `sendTurn` (the loop that drives it all).

**Resources:**
- [Bedrock — Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html)
- [Bedrock — Tool use (function calling)](https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use.html)

---

## Module 17 — Security: secrets, least privilege, and mistakes we actually made *(core)*

**Why it's here:** this project handles other people's data and real cloud credentials.
These are the specific lessons this codebase paid for.

- **Never commit secrets.** `.env` is gitignored; `.env.example` documents the *names* of
  settings with safe placeholder values. Same reason `docs/aws.md` documents commands but
  never keys.
- **Never use AWS root access keys.** We did, briefly, by accident — the first
  `aws sts get-caller-identity` came back as `:root`. Root keys can't be restricted by any
  policy and can do *anything* to the account, including billing. The fix: delete them,
  create a named IAM user, use that. If a credentials CSV was downloaded during setup,
  delete it from your Downloads folder once configured.
- **Least privilege** means granting only the permissions actually needed. We chose
  `AdministratorAccess` deliberately for a time-boxed hackathon and wrote down a properly
  scoped policy as the alternative — knowing the trade-off you're making is the skill;
  blanket admin by default is the anti-pattern.
- **Hash tokens at rest.** OAuth tokens are stored as SHA-256 hashes, never plaintext, so
  a leaked database doesn't hand over live sessions. Same reasoning as password hashing.
- **Short expiry + rotation.** Access tokens last 15 minutes; refresh tokens rotate on use.
- **Understand *why* a permissive setting is safe.** CORS here is `origin: "*"` — safe
  *only because* auth is a Bearer token rather than cookies, so a hostile page can't ride
  along on a logged-in browser session. Same setting with cookie auth would be a serious
  hole. Copying settings without this reasoning is how vulnerabilities spread.

**Where in this repo:** `src/auth/crypto.ts` (hashing), `src/auth/bearer.ts`,
`.gitignore`, `.env.example`, and `docs/friction-log.md`.

**Resources:**
- [AWS IAM — security best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)

---

## Module 18 — Testing with Vitest *(supporting)*

**Why it's here:** every tool and auth path has a test, run by Vitest (fast, Jest-like).

- `describe`/`it` group and name tests; `expect(x).toBe(y)` asserts.
- **Unit tests** call a function directly (`test/tools/planWeek.test.ts`).
- **Integration/e2e tests** start the real server and hit it over real HTTP
  (`test/e2e/mcp-client.test.ts`) — slower, but much closer to reality.
- **Contract tests** run one suite against two implementations to prove they match
  (`test/store/contract.ts` against both SQLite and DynamoDB).
- **Regression tests** exist because something broke once — `test/auth/cors.test.ts` is
  literally "make sure that bug never comes back." Writing one after each real bug is a
  habit worth forming.
- **Mocking:** `test/web/simulateApi.test.ts` injects a fake Bedrock client so tests never
  call AWS — fast, free, deterministic. But note the limitation this project discovered:
  mocked tests can't catch a real integration breaking (the Bedrock outage was invisible
  to them). Mocks test *your* logic, not the world.

**Where in this repo:** anything under `test/`. Start with `test/tools/planWeek.test.ts`.

**Resources:**
- [Vitest — Getting started](https://vitest.dev/guide/)

---

## Module 19 — A debugging toolkit *(core — the most transferable skill here)*

**Why it's here:** most of the hard problems in this project were diagnosed, not coded.
The method: **isolate which layer is failing** — client → network → server → data — by
testing each in isolation.

- **`curl` for raw truth.** `curl -i` shows status + headers with no browser or library in
  between. This is how the CORS bug was proven (`curl -X OPTIONS` returned 404 = no
  preflight handler) and how latency was measured
  (`curl -w "%{time_total}"` → 154 ms through the tunnel).
- **Server logs.** `npm run dev` prints startup config and every crash. Half of debugging
  is just reading them.
- **Browser DevTools.** Console for JS errors, Network tab for what the page actually
  sent/received. Some failures only exist in a browser (CORS) and are invisible to curl.
- **MCP Inspector** as a protocol-level client — it caught a bug our whole test suite
  couldn't, because it was the first *cross-origin browser* client to try.
- **`npm run smoke`** — one command that exercises the whole flow end to end; a fast "is
  anything broken" check before you go hunting.
- **Trust the error message's shape, not its wording.** `TypeError: Failed to fetch` means
  the browser blocked it (usually CORS); `ValidationException: Operation not allowed` from
  AWS turned out to mean "account not verified" — the words lied, the pattern (multiple
  unrelated services failing at once) told the truth.

**Where in this repo:** `docs/friction-log.md` — every entry is a worked debugging story
with the wrong turns left in.

**Resources:**
- [curl — docs](https://curl.se/docs/)
- [Chrome DevTools docs](https://developer.chrome.com/docs/devtools)

---

## Module 20 — Git, and why this repo's history matters *(supporting)*

**Why it's here:** beyond "saving work," git history here is *evidence* — the hackathon's
open-source challenge requires proving the project was created during the contest window,
and the first commit's date is that proof.

- **Commit** = a snapshot plus a message explaining *why*. Good messages explain reasoning,
  not just the diff — look at this repo's log for the pattern.
- **Staging** (`git add <file>`) chooses what goes into the next commit. Being able to
  commit *one* file while leaving other work untouched matters (we did exactly that when
  adding a LICENSE to the try-on repo mid-feature).
- **`.gitignore`** keeps generated and secret things out: `node_modules/`, `dist/`,
  `data/`, `.env`.
- **Licensing** — a repo with no LICENSE is "all rights reserved" by default. MIT here,
  and it must be visible in GitHub's About section for the challenge.

**Where in this repo:** `git log --oneline`, `.gitignore`, `LICENSE`,
`docs/submission.md`.

**Resources:**
- [Git — official docs](https://git-scm.com/doc)

---

## Suggested order if you have limited time

**~3 hours, in this order:**

1. **Part 0** — run it (30 min). Non-negotiable; everything else is easier after.
2. **Module 5, MCP** (45 min) — including running MCP Inspector against it yourself.
3. **Module 6, OAuth/PKCE** (45 min) — read the server and browser sides back-to-back.
4. **Module 11, queues + the 500 ms budget** (20 min) — the constraint that explains the
   architecture.
5. **Module 12, the renderer bridge** (20 min) — the one genuinely novel idea here.
6. **Module 19, debugging** (20 min) — the most transferable skill in the list.

Everything else: read when you hit it in the code. This file will still be here.

## Glossary

- **API** — a defined way for one program to talk to another.
- **Bearer token** — a string granting access to whoever holds it; no further proof.
- **Cache key** — a value derived from inputs, used to store and find a computed result.
- **CDN** — servers spread worldwide that cache content close to users.
- **Container** — a packaged, isolated bundle of an app and its dependencies.
- **CORS** — the browser rule blocking cross-origin requests unless the server opts in.
- **Endpoint** — a specific URL a server responds to (e.g. `POST /mcp`).
- **Environment variable** — a setting passed into a program from outside it.
- **Headless** — a browser running with no visible window, driven by code.
- **Idempotent** — safe to repeat; doing it twice has the same effect as once.
- **JSON-RPC** — a JSON format for calling a named method with arguments.
- **Least privilege** — granting only the permissions actually required.
- **LLM** — large language model (Claude, Nova) — the "AI" behind an assistant.
- **Middleware** — code running before/around a request handler (auth, CORS, logging).
- **Mock** — a stand-in for a real dependency during tests.
- **PKCE** — Proof Key for Code Exchange; an OAuth safeguard for public clients.
- **Preflight** — the automatic `OPTIONS` request a browser sends before a cross-origin call.
- **Role (IAM)** — an identity a *service* assumes for temporary permissions.
- **Schema** — a description of the shape data must have.
- **Seed** — populating a fresh database with known starter data (`npm run seed`).
- **Stateless** — the server keeps no per-connection memory between requests.
- **Token** — in auth, a credential string. (In LLM contexts it means a chunk of text —
  different meaning, same word; context tells you which.)
- **Transport** — the mechanism messages travel over (Streamable HTTP, stdio, …).
- **Tunnel** — a service exposing a local port at a public HTTPS URL (`cloudflared` here).
