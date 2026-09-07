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
- **Contribution URL:** _(first commit — fill in after push; this is the "created during the window" evidence)_
- **GitHub username:** pravoobi
- **License:** MIT (`LICENSE` at repo root; set in GitHub → About → License)
- **Created during the window:** first commit dated within the hackathon window (Sep 2026).
- **What / how / why it matters:**
  - _What_ — an MCP server that gives Alexa+ a customer's wardrobe plus virtual try-on previews.
  - _How_ — Streamable HTTP MCP (spec 2025-11-25), OAuth 2.1 with PKCE, a renderer bridge
    that reuses the try-on app's own WebMCP tools through headless Chromium, deployed on AWS.
  - _Why it matters_ — it's a reusable pattern: WebMCP tool contracts written for a web app
    port cleanly to a remote MCP server. Same catalog, same tool semantics, new transport.

## Pre-existing project disclosure

`pravoobi/try-on` (the virtual try-on web app + its WebMCP tools) predates the hackathon.
Built **during the window:** this entire repo — the MCP server, the OAuth 2.1 AS, the
renderer bridge, the AWS deployment, and the simulated Alexa+ web client.

## AWS Builder — integrations

App Runner (hosting) · S3 + CloudFront (rendered look images over HTTPS) · DynamoDB
(wardrobe store in prod) · Bedrock (garment auto-tagging at upload time). Details in
[`aws.md`](aws.md).

## Demo video

< 3 min, public, English VO, no music/logos. Script in [`demo-script.md`](demo-script.md).
Lead with the sangeet flow, not the architecture.

## Feature requests (with severity)

_Collected from [`friction-log.md`](friction-log.md) — critical / important / nice-to-have._
