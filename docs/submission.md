# Devpost submission — draft

## Tracks / challenges

- **Track:** Alexa+ — **simulated Alexa+ experience** (the add-ons/MCP Toolkit console is
  partner-gated, "coming soon" — see friction log #8). Devpost rules confirm this path
  counts as a full Alexa+ Track entry: same prizes, same judging criteria, exempt from the
  runtime-technology-hook requirement, but the repo includes the simulation's source
  (`web/simulator.html`) and the demo shows it running. The underlying MCP server + OAuth
  2.1 AS are real and unaffected by this — only the Alexa+-branded packaging is skipped.
- **Mini challenges:** AWS Builder + Open Source

## Open Source mini challenge — form fields

The rules accept either route — *"a new, additional open-source project (include an
open-source license)"* **or** *"a contribution (a branch, a fork, or a pull request) to a
public repository"*. We qualify on both; `wardrobe-mcp` itself is the primary answer —
real tests, a real new integration pattern, actively maintained during the window — with
the `try-on` PR kept as an unambiguous fallback (a LICENSE file alone is a thin showing
against this mini challenge's own "meaningful feature / bug fix / new integration
pattern" bar for *creative*, versus "README update, typo fix, minor formatting" for
*obvious*).

- **Repo URL:** https://github.com/pravoobi/wardrobe-mcp
- **Contribution URL (primary):**
  https://github.com/pravoobi/wardrobe-mcp/commit/b271b0535d9d52223eb4ea779be77bdd2428c6d6
  (first commit, "feat: Phase 1 — MCP server over Streamable HTTP")
- **Fallback, if the judges read "additional" as excluding the primary submission:**
  https://github.com/pravoobi/try-on/pull/1 — a pull request to the public
  `pravoobi/try-on` repository adding the root MIT `LICENSE` (that repo's workspace
  packages each already carried one; the repo root didn't, so GitHub showed the
  repository itself as unlicensed). Opened during the window; PRs don't need to be
  merged per the rules.
- **GitHub username:** pravoobi
- **License:** MIT (`LICENSE` at repo root of **both** repos; set in GitHub → About → License)
- **Created during the window:** first commit 2026-09-02, well inside the hackathon window.
- **What / how / why it matters:**
  - _What_ — a stylist that doesn't just talk: ask Alexa+ what to wear, and it can show
    you wearing it, on your own photo, before you decide. Everything it does — suggesting,
    showing, remembering what you saved and how you reacted — is in service of that one
    thing a voice assistant normally can't do: let you actually look at the outfit.
  - _How_ — the hard part is the renderer bridge: the try-on pipeline is browser-only
    (on-device ML, WebGPU/Wasm), so rather than reimplement it, the server drives the
    *deployed app's own* WebMCP tools through headless Chromium and pulls the rendered
    frame back out — one tool contract, two transports, the exact render a human would
    get clicking the button themselves. Everything else is a real, spec-compliant Alexa+
    add-on around that: Streamable HTTP MCP (2025-11-25), OAuth 2.1 with PKCE, state that
    persists across turns (saved looks, reactions) rather than one-shot Q&A. Deployed and
    live at **https://ba93fetekm.us-east-1.awsapprunner.com** (App Runner, `us-east-1`),
    with DynamoDB, S3 + CloudFront, ECR and IAM all in use. The new-account verification
    hold that blocked App Runner/CloudFront/Bedrock for five weeks (friction log #9) was
    cleared 2026-10-14 via an AWS Support exception request. Bedrock's reasoning step
    currently hits a daily-token quota, so `src/web/ruleReasoner.ts` — a small
    deterministic fallback — stands in automatically, tagged and visibly labeled in the
    transcript whenever it's the one answering, never silent.
  - _Why it matters_ — the render bridge pattern generalizes: any existing WebMCP web app
    gains a remote-MCP, voice-first surface without porting its rendering logic at all.
  - _The fallback PR specifically_ — small change, but it's the difference between "open
    source" and "source you can see."

## Pre-existing project disclosure

`pravoobi/try-on` (the virtual try-on web app + its WebMCP tools) predates the hackathon.
Built **during the window:** this entire repo — the MCP server, the OAuth 2.1 AS, the
renderer bridge, the AWS deployment, and the simulated Alexa+ web client.

## AWS Builder — integrations

All live in `us-east-1`. **App Runner** (hosts the container from ECR; the service URL
above) · **S3 + CloudFront** (rendered look images over HTTPS — distribution
`dyswjdrhfb962.cloudfront.net`) · **DynamoDB** (wardrobe store in prod, single-table,
parity-tested against SQLite via DynamoDB Local in CI) · **ECR** (image registry) ·
**Bedrock**, two integration points: garment auto-tagging at upload time, and the Phase 5
simulator's tool-selection reasoning. Details in [`aws.md`](aws.md).

**Measured, from a real us-east-1 CloudShell** (not a dev laptop — the India→us-east-1
round trip is ~900 ms of pure network distance and tells you nothing):
`suggest_outfits` 90 ms (37–50 ms on repeat), `preview_look` 127–152 ms, `compare_looks`
123 ms — all well inside Alexa+'s 500 ms budget.

## Demo video

< 3 min, public, English VO, no music/logos. Script in [`demo-script.md`](demo-script.md).
Lead with the sangeet flow, not the architecture.

## Feature requests (with severity)

_Collected from [`friction-log.md`](friction-log.md), which has the full repro for each.
Severities are from the entries themselves. Listed per product, since the Devpost form
asks per tool/API/SDK. (Friction log #12–15 are our **own** bugs found in a self-review,
not requests — they're documented there but deliberately not listed here.)_

**Alexa+ / Amazon**
- _critical_ — The MCP Toolkit / add-ons console is partner-gated ("coming soon"), but the
  docs only say "available in the United States," which reads as a region check a
  participant can pass rather than an allowlist they can't get onto. Say "partner-gated,
  request access here" up front. (#8)
- _important_ — Alexa+ requires a `401` **without** `WWW-Authenticate`, which contradicts
  the MCP spec and every OAuth resource-server default, including the SDK's own auth
  middleware. It needs a red-box callout with a snippet in the quickstart — or, better,
  Amazon's client should just read the standard `WWW-Authenticate` / well-known PRM path. (#7)

**AWS**
- _critical_ — New-account verification holds spread silently across services (CloudFront,
  then App Runner, then Bedrock — Bedrock mid-project, after it had been working). Bedrock's
  refusal is a generic, unsearchable `ValidationException: Operation not allowed` rather than
  anything naming verification. One account-level page should show every service currently
  gated by an open verification case. Took five weeks and a support exception to clear. (#9)
- _important_ — An S3 `GetObject` on a **missing** key returns `403` (naming `s3:ListBucket`)
  instead of `404` when the caller lacks bucket-level `ListBucket`. Well-documented AWS
  trivia, but it silently broke `compare_looks` in production for every genuinely-uncached
  pair; a clearer error would distinguish it from a real `AccessDenied`. (#11)

**MCP spec / TypeScript SDK**
- _important_ — Nothing in the spec or SDK sets or mentions CORS for `/mcp`, so a server can
  be fully verified with curl and server-side clients while every browser-based client —
  including MCP Inspector's own web UI — fails with an opaque `TypeError: Failed to fetch`
  and no server-side trace. Either default to permissive CORS on `/mcp` or call it out. (#10)
- _nice-to-have_ — `StreamableHTTPServerTransport` needs raw Node `req`/`res`, so it can't be
  mounted on any `fetch`-native framework (Hono, Workers, Deno, Lambda) without an adapter
  shim. A `fetch`-native transport would make the server portable unmodified. (#3)

**WebMCP**
- _important_ — `document.modelContext` is the *provider* server, so there's no obvious
  agent-side "call a tool". The working call is
  `document.modelContext.tools.get(name).execute(args)`; the explainer should show it, and a
  symmetrical `callTool(name, args)` helper would remove the guesswork entirely. (#5)

**Playwright**
- _important_ — `headless: true` silently selects `chromium_headless_shell`, which has **no
  GPU stack**: `navigator.gpu` exists so feature detection passes, but `requestAdapter()`
  returns `null` forever — no error, no failed request, nothing fetched. Any WebGPU/WebGL
  workload needs `channel: "chromium"`. Either warn when the shell calls `requestAdapter()`,
  or document the rule somewhere it's found *before* a day is lost. (#4a)

**Node / build tooling**
- _important_ — Vite/Vitest's transform strips the `node:` prefix and then tries to resolve a
  package literally named `sqlite`, so `node:sqlite` can't be imported normally. `node:`
  builtins should stay external unconditionally. (#1)
- _nice-to-have_ — `npm ci` silently omits devDependencies when the base image sets
  `NODE_ENV=production` (the official Playwright image does), so the build dies with
  `tsc: not found` and no notice that packages were skipped. One warning line would fix it. (#6)
- _nice-to-have_ — `tsc` doesn't copy non-TS assets to `outDir`, so `catalog.json` vanishes in
  the built output: works in dev, breaks in prod. (#2)
