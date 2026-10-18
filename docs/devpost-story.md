# Devpost "About the project"

## Inspiration

`try-on` (my submission to an earlier WebMCP challenge) already solved the hard part:
rendering a garment onto a customer's own photo, in the browser, with real on-device ML.
What it couldn't do was talk. A voice assistant can describe an outfit all day, but
"describe" was never the point for clothes. You either see it on you or you're guessing.

Alexa+'s add-on track was the other half of that sentence: a voice assistant with a
screen, looking for self-hosted MCP servers to extend it. The idea was simple once I saw
it. Don't rebuild the try-on pipeline for a new transport. Drive the one that already
exists, from a real MCP server, and let Alexa+ be the voice while the server supplies the
memory and the eyes. The sangeet scenario in the demo script ("I have a sangeet Saturday,
budget eight thousand, show me the magenta one on me") is a real way people actually
decide what to wear, not an invented use case.

## What it does

Wardrobe MCP is a self-hosted MCP server, over Streamable HTTP with OAuth 2.1 and PKCE,
that gives Alexa+ eleven tools: searching a catalog, suggesting outfits for an occasion
and budget, previewing a garment rendered on the customer's own photo, saving and comparing
looks, recording how the customer reacted, planning a week of events at once, and placing a
simulated order. The suggestion ranking is deterministic (occasion fit, then what's already
owned, then budget, then color) so Alexa+ does the conversation and the server does fast,
boring, structured lookups.

The part that makes this more than a wrapper is `preview_look` and `compare_looks`: they
return an image of the actual garment on the actual customer, produced by a real render,
not a stock photo or a composite. Every image-returning tool answers from a pre-computed
cache in well under Alexa+'s 500 ms budget, because the rendering itself never happens
inside a tool call.

Since the Alexa+ MCP Toolkit console turned out to be partner-gated ("coming soon," no
timeline), the repo also ships `web/simulator.html`, a small web client that does a real
OAuth 2.1 PKCE login against this same server and drives the same real `/mcp` endpoint
over Streamable HTTP, with Amazon Bedrock (or a deterministic fallback when Bedrock isn't
available) doing the turn-by-turn reasoning about which tool to call. It's clearly labeled
as simulated. Nothing it talks to is.

## How we built it

Node 22, TypeScript strict, Hono for HTTP, `@modelcontextprotocol/sdk`'s Streamable HTTP
transport in stateless mode. Tool schemas are zod, one file per tool, each a pure function
of `(input, context)` so they're testable without going through HTTP at all. The store is
one interface with two implementations, SQLite for dev and DynamoDB for production, run
against the same contract test suite so neither one can drift from the other.

The renderer bridge is the piece I spent the most time on: a Playwright-controlled headless
Chromium opens the deployed `try-on` app at its own URL and calls its own WebMCP tool,
`document.modelContext.tools.get("apply_tryon").execute({garmentId})`, then pulls the
rendered canvas back out as a snapshot. Same tool contract, two transports: WebMCP in the
browser, MCP over Streamable HTTP to Alexa+. Renders are triggered in the background, when
a photo or garment is added, keyed by a salted hash of photo, garment, and app version, and
stored in S3 behind CloudFront. A live tool call is never anything but a cache read.

Auth is a hand-rolled OAuth 2.1 authorization server in the same process rather than
Cognito, because Alexa+'s exact requirements (a `resource` parameter per RFC 8707, PKCE
with S256 only, a 401 that must not carry `WWW-Authenticate`, no dynamic client
registration) were specific enough that wiring a managed identity provider to match them
looked riskier than just writing it, and this way every rejection path has its own test.

AWS is App Runner for the container, ECR for the image, S3 and CloudFront for images,
DynamoDB for the wardrobe, and Bedrock for garment auto-tagging and the simulator's
reasoning step, all in `us-east-1`. A GitHub Actions workflow runs typecheck, the full
test suite including a DynamoDB Local parity run, the smoke script, and a Docker build on
every push.

## Challenges we ran into

The biggest one wasn't code. Five weeks into the build, a new-account verification hold
quietly blocked App Runner, then CloudFront, then Bedrock, one service at a time, each
with its own generic error and no single place that said "this account is gated." Bedrock's
was the worst: `ValidationException: Operation not allowed`, nothing that mentioned
verification at all. It only cleared after I filed an AWS Support exception request
explaining the use case directly.

Headless rendering had its own silent failure mode. Playwright's default `headless: true`
launches `chromium_headless_shell`, which has no GPU stack: `navigator.gpu` exists so
feature detection passes, but `requestAdapter()` returns `null` forever. No error, no
failed network request, nothing to catch, the page just sits there with its buttons
disabled. `channel: "chromium"` fixes it outright; I'd also tried `--use-angle=swiftshader`
first on a guess, which made it worse, not better. That one cost most of a day before I
found the actual cause.

A second render bug took longer to track down than it should have: every render after the
first one on a freshly-loaded photo came out as the same wrong garment, silently, with
`apply_tryon` still reporting success. The photo-load click was resolving before the app's
own pipeline had actually finished initializing for that photo, so the first real render
fired against a half-set-up state and every one after it kept compositing against that same
stale frame. A short settle wait after the photo loads fixed it for good.

And then there was the plan itself changing mid-build: I'd already written the full OAuth
2.1 server against Alexa+'s add-on requirements before finding out the MCP Toolkit console
was invite-only with no visible queue. Rather than let five weeks of real, working auth code
go unused, I kept it and built the simulated web client on top of the same server, which
the hackathon's own rules explicitly allow as a full track entry.

## Accomplishments that we're proud of

It's actually deployed, not just demoed from a laptop: live on App Runner in `us-east-1`,
with a real OAuth 2.1 PKCE round trip run against the deployed URL and measured from an
actual AWS CloudShell session, not a proxy for one. `suggest_outfits` answers in 90 ms (37
to 50 ms on repeat), `preview_look` in 127 to 152 ms on a cache hit, `compare_looks` in
123 ms, all comfortably inside the 500 ms budget with real network distance in the numbers.

The renderer bridge works exactly as designed: a genuine on-device ML render, driven
headlessly through the app's own real tool call, not a mock image standing in for one.
And the full voice-shaped loop holds together end to end, suggest, preview, save, compare,
react, and now place a clearly-simulated order, including through the offline reasoning
fallback when Bedrock isn't available, which I'd rather ship honestly than hide.

I'm also glad I ran a real security pass before calling this done and fixed what it found:
exception details that could've leaked internal state, a render cache key that was
guessable from public inputs, a crash in the login page from unvalidated input, no rate
limiting anywhere. All fixed, all with tests, all logged in the friction log the same way
as everything else.

## What we learned

A spec-compliant OAuth 2.1 server is a lot of exacting detail that's easy to get mostly
right and still fail a real client. Alexa+ wanting a 401 without `WWW-Authenticate`, which
goes against both the MCP spec's own guidance and what most auth middleware does by
default, is the kind of requirement you only find by actually integrating, not by reading
the spec twice.

Headless browser automation for anything GPU-backed needs the real browser, not the
stripped-down default, and that whole class of bug fails by doing nothing rather than by
erroring, which makes it much slower to diagnose than a crash would be.

Platform access, not code, was the actual critical path for a chunk of this project. A
partner-gated console and a silent account verification hold cost more real time than any
bug did. Checking for that kind of blocker on day one, before writing code against
assumptions the platform might not support yet, turned out to matter as much as the
architecture decisions did.

And keeping the LLM out of the tool-call path entirely, deterministic ranking, pre-computed
renders, cache reads only, is what actually made a 500 ms voice budget achievable. The
model's job is the conversation; the server's job is to never be the slow part.

## What's next for Wardrobe MCP

Ship the real Alexa+ add-on the moment the MCP Toolkit console opens up generally. The
server and the OAuth layer are already built to its spec; nothing about them was simulated.

Build the companion upload flow this project deliberately deprioritized: a customer's own
photo and their own garments, auto-tagged by Bedrock, so the wardrobe is real rather than
seeded from a fixed demo catalog.

Add saree support, which the underlying `try-on` pipeline doesn't yet handle, and look at
multi-brand catalogs so this isn't tied to one curated set of items.

And once `place_order` has a reason to be real, replace the simulated checkout with an
actual one, behind real payment handling, instead of the clearly-labeled mock it is today.
