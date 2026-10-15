# Demo video — shot by shot (< 3 min)

Lead with the customer, not the architecture. 1080p, English VO, no music, no third-party
logos. Screen-recorded from `web/simulator.html` (Phase 4's real Alexa+ add-on is
unavailable — the MCP Toolkit console is partner-gated, "coming soon"; see friction log
#8). Devpost's simulated-experience path requires the demo to **clearly show it's
simulated** — the on-screen banner in the simulator UI already says so, and the VO says
it once, plainly, in the first 20 seconds. Don't apologize for it or dwell on it either —
say it once and move on to what actually works: a real MCP server, real OAuth 2.1, real
renders.

Shot list follows the sangeet flow exactly as verified end-to-end in the simulator
(2026-09-07) — no invented dialogue, this is the literal transcript.

| Time | Shot | VO / on-screen |
|---|---|---|
| 0:00–0:20 | Cold open on the simulator UI. Click **Connect** → real OAuth redirect → "Continue as Praveen" → back, connected. | "When a voice assistant suggests an outfit, you have to imagine it. This one doesn't make you — it shows you, wearing it, before you decide. [beat] This is a simulated Alexa+ experience — the real add-ons console is invite-only right now — but everything behind it is real: a self-hosted MCP server, OAuth 2.1 with PKCE, over Streamable HTTP." |
| 0:20–0:35 | Type/say the opener. | "I have a sangeet on Saturday. What should I wear? Budget eight thousand." → `suggest_outfits` tool-call bubble → Alexa+ reads 3 options (Magenta Wrap Maxi Dress, Cream Embroidered Kurti, Emerald Floral Midi Dress). |
| 0:35–1:00 | "Show me the first one on me." | `preview_look` → the rendered try-on appears on the simulated Echo Show screen. |
| 1:00–1:15 | "Save that." | `save_look` → "Saved as look-1." |
| 1:15–1:40 | "Now show me another option." → "Save that." | Second render appears (Cream Embroidered Kurti) → saved as look-2. |
| 1:40–2:00 | "Compare them." | `compare_looks` → the side-by-side sheet appears on screen. "Go with the magenta." → `record_reaction(love)` → confirms and offers the purchase link. |
| 2:00–2:30 | One diagram: the renderer bridge. | "Here's the part that makes the preview possible at all. The try-on pipeline is on-device ML, browser-only — so instead of reimplementing it, the server drives the *deployed app's own* rendering, headless, and pulls the exact frame back out. That's a real browser doing real inference, not a mock. And because every render is pre-computed, the tool call itself is just a cache read — measured under 150 milliseconds from AWS's own us-east-1, well inside Alexa+'s 500 millisecond budget." |
| 2:30–2:50 | AWS + open source. | App Runner, S3, DynamoDB, Bedrock. New MIT repo created during the window — what's new vs. the pre-existing try-on app. |
| 2:50–3:00 | Close. | The thesis line: "Alexa+ is the stylist's voice; this is the stylist's memory and eyes." |

## Notes for whoever records this

- Seed fresh before recording (`npm run seed` or `docker compose run --rm seed`) so the
  wardrobe/looks state matches the shot list exactly — don't record against a store
  that's accumulated test data from earlier runs (repeat looks will get `look-3`,
  `look-4`, … instead of `look-1`/`look-2`, and old saved looks will show up in
  `compare_looks` if you say "compare them" without specifying which two).
- If real Bedrock reasoning is back online by recording time, the transcript won't show
  the "offline rule-based reasoner" notice at all — that's fine, don't force it to
  appear. If it's still down, the notice is honest and fine to leave in; don't edit it
  out or hide it, that would cross into "pretending."
- Say the sample phrases exactly as written above — they're what the rule-based fallback
  (and the real Bedrock path) are tuned to understand cleanly, so the flow won't stall on
  a rephrasing mid-recording.
- The "under 150 milliseconds" line at 2:00–2:30 is real, not a round-number guess — see
  `docs/aws.md`'s Latency section (measured 2026-10-14 from an actual AWS CloudShell
  session in us-east-1, against the deployed App Runner URL, not a dev machine):
  `suggest_outfits` 90 ms (37–50 ms on repeat), `preview_look` cache hit 127–152 ms,
  `compare_looks` cache hit 123 ms. If these are re-measured before recording and come
  back meaningfully different, update both this line and `docs/aws.md` together — don't
  let the two drift.
