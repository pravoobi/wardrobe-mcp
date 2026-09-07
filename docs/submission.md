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

- **Repo URL:** https://github.com/pravoobi/wardrobe-mcp
- **Contribution URL:** https://github.com/pravoobi/wardrobe-mcp/commit/b271b0535d9d52223eb4ea779be77bdd2428c6d6
  (first commit, "feat: Phase 1 — MCP server over Streamable HTTP")
- **GitHub username:** pravoobi
- **License:** MIT (`LICENSE` at repo root; set in GitHub → About → License)
- **Created during the window:** first commit 2026-09-02, well inside the hackathon window.
- **What / how / why it matters:**
  - _What_ — an MCP server that gives Alexa+ a customer's wardrobe plus virtual try-on previews.
  - _How_ — Streamable HTTP MCP (spec 2025-11-25), OAuth 2.1 with PKCE, a renderer bridge
    that reuses the try-on app's own WebMCP tools through headless Chromium. ECR/DynamoDB/S3/
    IAM are live in `us-east-1`; App Runner itself and Bedrock are waiting on an AWS account
    verification pass (friction log #9) — the server runs today over a `cloudflared` tunnel
    as a real remote HTTPS URL in the meantime, and a small deterministic fallback
    (`src/web/ruleReasoner.ts`) stands in for Bedrock's reasoning step, tagged and visibly
    labeled whenever it's the one answering, never silent.
  - _Why it matters_ — it's a reusable pattern: WebMCP tool contracts written for a web app
    port cleanly to a remote MCP server. Same catalog, same tool semantics, new transport.

## Pre-existing project disclosure

`pravoobi/try-on` (the virtual try-on web app + its WebMCP tools) predates the hackathon.
Built **during the window:** this entire repo — the MCP server, the OAuth 2.1 AS, the
renderer bridge, the AWS deployment, and the simulated Alexa+ web client.

## AWS Builder — integrations

App Runner (hosting) · S3 + CloudFront (rendered look images over HTTPS — CloudFront
pending the same account verification, S3 serves directly over HTTPS in the meantime,
one env-var swap either way) · DynamoDB (wardrobe store in prod, single-table, parity
tested against SQLite) · Bedrock, two integration points: garment auto-tagging at upload
time, and the Phase 5 simulator's tool-selection reasoning. Details in [`aws.md`](aws.md).

## Demo video

< 3 min, public, English VO, no music/logos. Script in [`demo-script.md`](demo-script.md).
Lead with the sangeet flow, not the architecture.

## Feature requests (with severity)

_Collected from [`friction-log.md`](friction-log.md) — critical / important / nice-to-have._
