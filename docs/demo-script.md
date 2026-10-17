# Demo video — shot by shot (< 3 min)

Lead with the customer, not the architecture. 1080p, English VO, no music, no third-party
logos. Screen-recorded from the **live deployed simulator**, not localhost:

**https://ba93fetekm.us-east-1.awsapprunner.com/simulator**

(source: `web/simulator.html`; Phase 4's real Alexa+ add-on is unavailable — the MCP
Toolkit console is partner-gated, "coming soon"; see friction log #8). Devpost's
simulated-experience path requires the demo to **clearly show it's simulated** — the
**SIMULATED ALEXA+** badge in the simulator header is always visible (the longer
explanation is behind the `?` popover next to it), and the VO says it once, plainly, in
the first 20 seconds. Don't apologize for it or dwell on it either — say it once and
move on to what actually works: a real MCP server, real OAuth 2.1, real renders.

Shot list follows the sangeet flow exactly as verified end-to-end in the simulator
(2026-09-07). The dialogue with the app is the literal transcript — nothing invented; the
**VO text** column is written narration spoken over it.

Columns: **Shot** = what to do on screen. **On-screen text** = text burned in during edit
(lower thirds, labels, end card) — the app's own UI text is in the Shot column, not here.
**VO text** = the words spoken, verbatim.

| Time | Shot | On-screen text | VO text |
|---|---|---|---|
| 0:00–0:20 | Cold open on the live simulator. Click **Connect** → real OAuth redirect → "Continue as Praveen" → back, header reads `connected — 10 tools`. | Lower third, first ~5 s: `wardrobe-mcp — a self-hosted MCP server for Alexa+`. Keep the UI's own **SIMULATED ALEXA+** badge legible for the whole shot — that badge is the Devpost disclosure, don't crop it. | "When a voice assistant suggests an outfit, you have to imagine it. This one doesn't make you — it shows you, wearing it, before you decide. [beat] This is a simulated Alexa+ experience — the real add-ons console is invite-only right now — but everything behind it is real: a self-hosted MCP server, OAuth 2.1 with PKCE, over Streamable HTTP." |
| 0:20–0:35 | Click the first quick phrase. A `suggest_outfits` tool-call bubble appears, then Alexa+'s reply with 3 options — Magenta Wrap Maxi Dress, Cream Embroidered Kurti, Emerald Floral Midi Dress. | None — let the transcript bubbles carry it. | "I have a sangeet on Saturday. What should I wear? Budget eight thousand." [let the reply land] "Three options, ranked, each with a reason — and that ranking is deterministic server-side, not the model guessing." |
| 0:35–1:00 | "Show me the first one on me." → `preview_look` → the render fills the Echo Show screen. Hold on it; this is the money shot, give it room. | Optional small label over the screen: `real render · the customer's own photo`. | "Show me the first one on me. [beat] And that's not a stock photo or a mock-up — that's the dress actually rendered onto her own photo, by the same on-device model a person gets in the browser." |
| 1:00–1:15 | "Save that." → `save_look` → "Saved as look-1." | None. | "Save that. [beat] It's kept — the look itself, and in a moment, how she felt about it." |
| 1:15–1:40 | "Now show me another option." → second render appears (Cream Embroidered Kurti) → "Save that." → saved as look-2. | None. | "Now show me another option. [beat] Save that. [beat] Two saved looks now, both real renders, both held in state across turns — this isn't one-shot question and answer." |
| 1:40–2:00 | "Compare them." → `compare_looks` → the side-by-side sheet fills the screen. Then "Go with the magenta." → `record_reaction(love)` → Alexa+ confirms and offers the purchase link. | None. | "Compare them. [beat] Side by side, composed server-side from the two renders it already had. Go with the magenta — and it records that reaction, which is what shapes what it says next time." |
| 2:00–2:30 | Cut to the renderer-bridge diagram: `/simulator/renderer-bridge.html` (e.g. `https://ba93fetekm.us-east-1.awsapprunner.com/simulator/renderer-bridge.html`). Static page — no clicking; let it sit, or push in slowly. | All text is in the page itself (two phases: background pre-compute, then request time). Add nothing. | "Here's the part that makes the preview possible at all. The try-on pipeline is on-device ML, browser-only — so instead of reimplementing it, the server drives the *deployed app's own* rendering, headless, and pulls the exact frame back out. That's a real browser doing real inference, not a mock. And because every render is pre-computed, the tool call itself is just a cache read — measured under 150 milliseconds from AWS's own us-east-1, well inside Alexa+'s 500 millisecond budget." |
| 2:30–2:50 | AWS + open source. No new screen required — cut back to the simulator, or a quick pass over the AWS console / `docs/aws.md`. This can play over whatever's already up. | Overlay the stack as a plain list while it's named: `App Runner · S3 + CloudFront · DynamoDB · Bedrock · ECR — all us-east-1`. | "Behind this is real AWS — App Runner hosts it, S3 and CloudFront serve the images, DynamoDB stores the wardrobe, Bedrock tags garments and reasons when it's available. The try-on app rendering it predates this hackathon; everything else — the MCP server, OAuth login, the renderer bridge, the AWS deployment, this whole repo — is new, MIT-licensed, built during the window." |
| 2:50–3:00 | Close. Hold on the Echo Show with a render still up — the compare sheet reads best here. | End card / lower third: the live URL `ba93fetekm.us-east-1.awsapprunner.com/simulator`, the repo `github.com/pravoobi/wardrobe-mcp`, and the thesis line as **text only, never spoken** — "Alexa+ is the stylist's voice; this is the stylist's memory and eyes." | "So you never have to imagine it. You just look — and then you decide. It's live right now; the link's on screen." |

## Notes for whoever records this

- **Open the live URL above**, not `localhost:3000/simulator` — recording from the actual
  deployed service is the point (anyone watching can go try it themselves afterward).
- The 2:00–2:30 diagram (`web/renderer-bridge.html`) is a static page, no interaction
  needed — just navigate to it and let the VO play over it. It fits a single 1080p frame
  with no scrolling. It's a standalone asset (not linked from the simulator UI itself),
  served automatically under `/simulator/*` alongside `simulator.html`.
- The live demo user (`praveen`) has accumulated saved looks from testing beyond this
  session (more than the `look-1`/`look-2` the shot list assumes), so `save_look`'s spoken
  confirmation will currently say "You have N saved looks" with N > 1 before the first
  save in this flow. Not broken — `compare_looks` in the shot list always names its two
  `lookIds` explicitly, so old looks never leak into the comparison — just not pristine.
  To reset it: re-run the prod seed procedure in `docs/aws.md` (`STORE=dynamodb
  STORAGE=s3 RENDER_MODE=local … npx tsx scripts/seed.ts` with the real AWS env vars —
  **not** the plain `npm run seed`/`docker compose run --rm seed` commands, which only
  seed local SQLite and have no effect on the live service), then manually clear the
  accumulated `LOOK#` rows for `praveen` in DynamoDB if a clean `look-1` on camera matters
  more than the few minutes that takes.
- If real Bedrock reasoning is back online by recording time, the transcript won't show
  the "offline rule-based reasoner" notice at all — that's fine, don't force it to
  appear. If it's still down, the notice is honest and fine to leave in; don't edit it
  out or hide it, that would cross into "pretending."
- Say the sample phrases exactly as written above — they're what the rule-based fallback
  (and the real Bedrock path) are tuned to understand cleanly, so the flow won't stall on
  a rephrasing mid-recording.
- In the 0:20–2:00 rows, the **quoted** parts of the VO text are the customer utterances —
  speak them as if talking to the device, then click the matching quick phrase (or type
  it) so the screen follows your voice. The unquoted parts are narration; keep them short
  and let the render land in silence. `[beat]` means stop talking — these beats are where
  the image appears, and talking over it is the one way to waste the best shot.
- The "under 150 milliseconds" line at 2:00–2:30 is real, not a round-number guess — see
  `docs/aws.md`'s Latency section (measured 2026-10-14 from an actual AWS CloudShell
  session in us-east-1, against the deployed App Runner URL, not a dev machine):
  `suggest_outfits` 90 ms (37–50 ms on repeat), `preview_look` cache hit 127–152 ms,
  `compare_looks` cache hit 123 ms. If these are re-measured before recording and come
  back meaningfully different, update both this line and `docs/aws.md` together — don't
  let the two drift.
- **The open and the close are one sentence, split in half.** 0:00 sets up *"you have to
  imagine it"*; 2:50 pays it off with *"you never have to imagine it."* If you reword one,
  reword the other — breaking the pair costs the video its ending. The old thesis line
  ("the stylist's voice… memory and eyes") is kept as on-screen text rather than VO: it
  reads fine silently, but spoken at 2:50 it restates the concept abstractly at the exact
  moment the viewer has just *watched* it work, and "eyes" is slightly off anyway — the
  system doesn't see the customer, it shows them.
- **Land the close before 3:00, not at it.** Judges aren't required to watch past the
  three-minute mark, so the final word should land around 2:55. The VO as written is ~22
  words, about 9 seconds — it fits with room to spare.
- **The 2:30–2:50 beat isn't filler** — it's satisfying two specific, separate Devpost
  requirements, not telling the product story: (1) the AWS Builder mini challenge
  requires actually naming the AWS services used on screen, and (2) Devpost's
  pre-existing-project rule requires explicitly stating what's new during the window vs.
  what predates it (`try-on` predates the hackathon; everything in this repo doesn't).
  No new footage is required for it — it can play over the simulator sitting idle, a
  held shot of `docs/aws.md`, or a quick AWS console tab, whatever's simplest to cut to.
