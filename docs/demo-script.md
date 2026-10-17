# Demo video — shot by shot (< 3 min)

Lead with the customer, not the architecture. 1080p, English VO, no music, no third-party
logos. Screen-recorded from the **live deployed simulator**, not localhost:

**https://ba93fetekm.us-east-1.awsapprunner.com/simulator**

(source: `web/simulator.html`; Phase 4's real Alexa+ add-on is unavailable — the MCP
Toolkit console is partner-gated, "coming soon"; see friction log #8). Devpost's
simulated-experience path requires the demo to **clearly show it's simulated** — the
on-screen banner in the simulator UI already says so, and the VO says it once, plainly,
in the first 20 seconds. Don't apologize for it or dwell on it either — say it once and
move on to what actually works: a real MCP server, real OAuth 2.1, real renders.

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
| 2:00–2:30 | One diagram: the renderer bridge — `/simulator/renderer-bridge.html` (e.g. `https://ba93fetekm.us-east-1.awsapprunner.com/simulator/renderer-bridge.html`). | "Here's the part that makes the preview possible at all. The try-on pipeline is on-device ML, browser-only — so instead of reimplementing it, the server drives the *deployed app's own* rendering, headless, and pulls the exact frame back out. That's a real browser doing real inference, not a mock. And because every render is pre-computed, the tool call itself is just a cache read — measured under 150 milliseconds from AWS's own us-east-1, well inside Alexa+'s 500 millisecond budget." |
| 2:30–2:50 | AWS + open source. Cut back to the simulator or a quick shot of the AWS console / `docs/aws.md` — no new screen required, this can play over whatever's already up. | "Behind this is real AWS — App Runner hosts it, S3 and CloudFront serve the images, DynamoDB stores the wardrobe, Bedrock tags garments and reasons when it's available. The try-on app rendering it predates this hackathon; everything else — the MCP server, OAuth login, the renderer bridge, the AWS deployment, this whole repo — is new, MIT-licensed, built during the window." |
| 2:50–3:00 | Close. Hold on the Echo Show with a render still up (the compare sheet reads well here). End card / lower third: the live URL, plus the thesis line as **on-screen text only** — "Alexa+ is the stylist's voice; this is the stylist's memory and eyes." | "So you never have to imagine it. You just look — and then you decide. It's live right now; the link's on screen." |

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
