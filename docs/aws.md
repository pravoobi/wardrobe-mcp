# AWS Builder — integrations

Region: **us-east-1** (Alexa+ traffic is US; keeps the < 500 ms round trip achievable).
All config is env-driven (`STORE`, `STORAGE`, `TAGGING_PROVIDER`, `AWS_REGION`, …); no
secrets in the repo. Local dev uses SQLite + `./renders` so none of this is needed to run
or demo the server.

| Service | Used for | Why | Code |
|---|---|---|---|
| **App Runner** | Hosts the container from an ECR image. | HTTPS + autoscaling out of the box; `min instances = 1` keeps it warm — no cold start inside a tool call. | `apprunner.yaml`, `Dockerfile` |
| **DynamoDB** | The `Store` in prod — one table, `PK`+`SK` single-table design. | Single-digit-ms reads; the 500 ms budget has no room for anything slower. TTL auto-expires OAuth codes/tokens. | `src/store/dynamodb.ts` |
| **S3** | Rendered look images + compare sheets (immutable WEBP). | Durable, write-once/read-many; content-addressed keys cache forever. | `src/render/s3Storage.ts` |
| **CloudFront** | Serves those images over HTTPS. | Alexa+ requires HTTPS image URLs; edge cache keeps `preview_look` responses tiny. | `CLOUDFRONT_BASE_URL` |
| **Bedrock** | Garment auto-tagging — image → `{name,color,category,occasion[]}` when a customer uploads a garment in the companion UI. | The **only** LLM call in the system; runs at upload time, never in a tool call. Makes an uploaded garment searchable by voice. | `src/tagging/bedrockTagger.ts` (Converse API, `amazon.nova-lite-v1:0`) |
| **ECR** | Container registry for the App Runner image. | — | see below |

## DynamoDB table

Single table, keys:

```
USER#<id>        PROFILE / PHOTO#<id> / WARDROBE#<garmentId> / LOOK#look-N / REACTION#<at>#<id> / LOOKSEQ
RENDER#<key>     JOB
AUTHCODE#<hash>  CODE            (ttl)
TOKEN#<hash>     TOKEN           (ttl)   GSI1PK = REFRESH#<refreshHash>
```

`GSI1` groups an OAuth refresh token with the access tokens it minted, so rotation/logout
is one query + batch delete. `ttl` (epoch seconds) auto-expires auth state.

Create it: `STORE=dynamodb DYNAMODB_TABLE=wardrobe AWS_REGION=us-east-1 npm run aws:table`
(idempotent — safe to re-run). Parity test suite: `npm run test:dynamo` (needs Docker; runs
the same `Store` contract as SQLite against DynamoDB Local).

## Deploy

```bash
# 1. build + push the image
aws ecr create-repository --repository-name wardrobe-mcp --region us-east-1
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <acct>.dkr.ecr.us-east-1.amazonaws.com
docker build -t wardrobe-mcp .
docker tag wardrobe-mcp <acct>.dkr.ecr.us-east-1.amazonaws.com/wardrobe-mcp:latest
docker push <acct>.dkr.ecr.us-east-1.amazonaws.com/wardrobe-mcp:latest

# 2. one-time: DynamoDB table, S3 bucket, CloudFront distro, IAM role for App Runner
#    (dynamodb:*Item + Query on the table + its GSI, s3:{Put,Get}Object on the bucket,
#     bedrock:InvokeModel on the model)
npm run aws:table

# 3. App Runner service from the image (min instances = 1), custom domain + HTTPS,
#    env from apprunner.yaml + the per-env values listed there.
```

## ✅ Deployed 2026-10-14

Live at **`https://ba93fetekm.us-east-1.awsapprunner.com`**
(`ServiceArn: arn:aws:apprunner:us-east-1:064308050230:service/wardrobe-mcp/56b6caa91949467caf2ac1d7b1733e57`,
`Cpu: 256 (0.25 vCPU)`, `Memory: 512 (0.5 GB)`, default autoscaling config — `MinSize: 1`,
so it stays warm). Deployed from the existing ECR image (`latest`, pushed 2026-09-07) —
not rebuilt, because everything that changed since then (`src/render/worker.ts`,
`queue.ts`, `config.ts`) is exclusively `RENDER_MODE=browser` plumbing, and production
never sets that env var (defaults to `local`); the server/auth/store code this service
actually runs is byte-for-byte what was last verified.

Bootstrap note: `MCP_CANONICAL_URL` can't be known before the service exists (App Runner
assigns the `*.awsapprunner.com` hostname at creation time), so this was a two-step
`create-service` → `update-service` — created with a placeholder, then one `update-service`
call fixed it to the real URL once known. Both operations completed (`RUNNING`), confirmed
with real requests against the live URL: `POST /mcp` with no Bearer returns `401` with
**no** `WWW-Authenticate` header (confirmed in raw response headers), and
`/.well-known/oauth-authorization-server` reports the correct `issuer`.

`CLOUDFRONT_BASE_URL` is set to the real distribution from the entry above
(`https://dyswjdrhfb962.cloudfront.net`), replacing the S3-direct-endpoint interim
workaround.

**✅ Prod seeded 2026-10-14.** Ran `scripts/seed.ts` locally against the real resources
(`STORE=dynamodb STORAGE=s3 RENDER_MODE=browser` pointed at table `wardrobe` / bucket
`wardrobe-looks-064308050230` / `CLOUDFRONT_BASE_URL=https://dyswjdrhfb962.cloudfront.net`,
using the same `wardrobe-mcp-cli` IAM credentials as the AWS CLI) — demo user `praveen`,
1 photo, 2 wardrobe items, all 8 catalog garments pre-rendered with real browser-mode
try-on, 76.9s total. Verified, not just logged: queried the table directly (`PROFILE`,
`PHOTO#photo-1`, 2 `WARDROBE#` items, 8 `RENDER#` jobs all `status: done`), downloaded
all 8 rendered images over the live CloudFront URL (`200`, correct sizes), and hashed
them — 8 distinct MD5s, each matching the exact same hash produced during the local
browser-mode verification in friction log #4b, confirming the renderer is still correct
against prod infrastructure, not just the local demo path. `DYNAMODB_TABLE`
`ItemCount` from `describe-table` still reads `0` — that's DynamoDB's known several-hour
metric lag, not a real signal; a direct `Query`/`Scan` is what was actually checked.

## ✅ Full authenticated round trip verified 2026-10-14

Ran a real OAuth 2.1 PKCE flow against the live service (client `mcp-inspector-local`,
same code path MCP Inspector uses) and drove the actual sangeet tool sequence with the
real `@modelcontextprotocol/sdk` client over Streamable HTTP — not a smoke test against
local SQLite, the genuine deployed URL. This caught two real bugs the earlier "is it up"
checks couldn't see:

**Bug 1 — deployed image predated `plan_week`.** `tools/list` returned 9 tools, missing
`plan_week`. Root cause: the ECR image was pushed at **12:04** on 2026-09-07, but
`plan_week` (commit `a2e75bc`) wasn't committed until **13:27** that same day — a
same-day gap my earlier "nothing changed since 2026-09-07" check missed, because it
compared by date, not by commit-vs-push time. Fixed: rebuilt the image from current
`main`, pushed to ECR, forced a redeploy with `apprunner start-deployment`. Confirmed:
`tools/list` now returns all 10.

**Bug 2 — `RENDER_MODE` mismatch made the prod seed invisible to the live service.**
The 2026-10-14 seed used `RENDER_MODE=browser`, but the deployed service itself defaults
to `RENDER_MODE=local` (`apprunner.yaml` never sets it) — the cache key includes the
mode string, so every `preview_look` against the live service was a cache **miss**
despite the table showing 8 `done` render jobs. Decided to keep production on
`RENDER_MODE=local`: the instance is 0.25 vCPU / 0.5 GB, too small to safely run headless
Chromium + a Wasm ML pipeline as a background job without real OOM risk on the only
running copy of the service. Re-seeded prod with `RENDER_MODE=local` (10.1s total,
side-by-side composites — the real garment-on-body quality stays a local/demo-only
differentiator, see `docs/demo.gif`). Confirmed: `preview_look` now returns
`status: done` on the first call.

**Bug 3 — `compare_looks` failed on any true cache miss, IAM-only, user-fixed.**
First real compare in prod threw `AccessDenied: ... not authorized to perform:
s3:ListBucket ... because no identity-based policy allows the s3:ListBucket action`.
Classic S3 behavior: without bucket-level `s3:ListBucket`, a `GetObject` on a
**non-existent** key returns `403` instead of `404 NoSuchKey`, which `S3Storage.get()`
only ever catered for by name (`err.name === "NoSuchKey"`), so the 403 bubbled up as a
real tool error. The original instance-role policy only ever granted
`s3:{Put,Get}Object` on `.../*` — `s3:ListBucket` (a bucket-level action, different
resource ARN with no trailing `/*`) was never included. This is an IAM/security-settings
change, so it was applied by the project owner directly in the AWS Console (IAM → Roles
→ `wardrobe-mcp-apprunner-instance` → inline policy `wardrobe-mcp-instance-permissions`
→ added a `S3BucketList` statement: `Action: s3:ListBucket`,
`Resource: arn:aws:s3:::wardrobe-looks-064308050230`). Confirmed fixed immediately (IAM
changes need no redeploy): `compare_looks` now returns `status: done` with a real
`compareUrl` on the very first call for a never-before-compared pair of looks.

Also confirmed as a non-bug: the simulator's Bedrock reasoning call
(`/api/simulate/turn`) hit the same daily-token `ThrottlingException` as every earlier
CLI test, and fell back to `src/web/ruleReasoner.ts` exactly as designed, tagged
`reasoner: "rule-based"` — the instance role's `bedrock:InvokeModel` grant does cover
`ConverseCommand` (AWS doesn't have a separate IAM action for it), so this is quota, not
a permissions gap.

**Still open:** the actual `< 500 ms` SLA has **not** been measured yet. The full round
trip above ran from this machine (India), where even a bare `/healthz` was ~900 ms of
pure network distance (confirmed separately) — not a valid stand-in for the required
us-east-1 vantage point. The next step is the `curl -w` pass from an actual us-east-1
CloudShell session.

**Redeployed 2026-10-14** with the `wardrobe:read` scope-enforcement fix (friction log
applies retroactively — see the webmcp-guidelines review in commit history): rebuilt,
pushed a new digest, `apprunner start-deployment`, confirmed `RUNNING` and `/healthz`
healthy again. No behavior change for the real demo flow — the `/link` consent screen
always grants both scopes by default, so this only matters for a hypothetical
narrower-scope client.

## Latency

`preview_look` / `compare_looks` / `suggest_outfits` measured with `curl -w` from a
us-east-1 CloudShell against the deployed URL must be < 500 ms for every tool. The
authenticated round trip above is now fully working end-to-end, so this is unblocked —
just not yet run from the right vantage point. Numbers recorded here once it is.

| tool | local (this machine) | us-east-1 → App Runner |
|---|---|---|
| `suggest_outfits` | ~25 ms | _pending — needs seeded prod DynamoDB user_ |
| `preview_look` (cache hit) | ~25 ms | _pending — needs seeded prod DynamoDB user_ |
| `compare_looks` (cache hit) | ~20 ms | _pending — needs seeded prod DynamoDB user_ |

Unauthenticated baseline (not a stand-in for the above, just a sanity check): `/healthz`
server-side processing time was 7 ms (`x-envoy-upstream-service-time` header); round trip
from this machine (India, not us-east-1) was ~900 ms, almost entirely network distance —
not informative for the actual < 500 ms budget, which must be measured from us-east-1.

## Account-verification blocker (2026-09-07)

Everything above except App Runner and CloudFront is live in this account (`064308050230`,
`us-east-1`): ECR image `wardrobe-mcp:latest` pushed, DynamoDB table `wardrobe` ACTIVE,
S3 bucket `wardrobe-looks-064308050230` (private, public-read bucket policy on objects
only) serving rendered looks directly over HTTPS, IAM roles
`wardrobe-mcp-apprunner-ecr-access` + `wardrobe-mcp-apprunner-instance` created, Bedrock
model access granted for `amazon.nova-lite-v1:0`.

`aws apprunner create-service` and `aws cloudfront create-distribution` both fail —
`SubscriptionRequiredException` and `AccessDenied: Your account must be verified`,
respectively. As of today, Bedrock (`Converse`/`InvokeModel`, both models tested) is
**also** failing with `ValidationException: Operation not allowed`, despite working two
days earlier — this reads as one account-wide new-account verification hold that's
widened over time, not three unrelated bugs. Full detail and repro: friction log #9.

**Interim workaround for image serving:** `CLOUDFRONT_BASE_URL` is set to the bucket's
direct HTTPS endpoint (`https://wardrobe-looks-064308050230.s3.us-east-1.amazonaws.com`)
instead of an actual CloudFront domain — `S3Storage` only ever uses this value as a URL
prefix, so this is a valid HTTPS image URL today and a one-line env-var swap once
CloudFront clears, no code change.

**Blocked, no AWS-side workaround:** App Runner hosting itself. An AWS Support case
covering all three (App Runner, CloudFront, Bedrock) has been filed; retry the exact
`apprunner create-service` / `cloudfront create-distribution` calls in this file once it
clears. (The Bedrock reasoning loop has a non-AWS workaround — see friction log #9's
"Workaround" and `src/web/ruleReasoner.ts`.)

**Retested 2026-09-14 — still blocked, no change.** All three calls re-run verbatim:
`cloudfront create-distribution` still `AccessDenied: Your account must be verified`
(identical message); `apprunner list-services` (a read-only call, lighter than
`create-service`) now *also* throws `SubscriptionRequiredException`, where before only
`create-service` had been tested; `bedrock-runtime converse` still `ValidationException:
Operation not allowed`. One partial, misleading signal: `cloudfront list-distributions`
now succeeds (`200`, `Quantity: 0`) where it previously wasn't tested — read access
isn't gated by the same hold that blocks `create-distribution`, so a clean `list` call
is **not** evidence the block has cleared. Support case still needs a human follow-up;
no AWS Support API access from the CLI (`describe-cases` → `SubscriptionRequiredException`
— that API itself needs a Business/Enterprise support plan, unrelated to the account-hold
case already filed through the console).

**Retested 2026-09-17 — still blocked.** A payment card was added to the account the
night before, on the theory that missing billing info was the hold. `apprunner
list-services` still `SubscriptionRequiredException`; `bedrock-runtime converse` still
`ValidationException: Operation not allowed` — both identical to every prior test.
`cloudfront create-distribution` not re-run this time (declined — no need to spin up a
real distribution just to reconfirm a block that hasn't moved on the other two services).
Adding a card alone did not clear it; the Support case is still the only lever.

## ✅ Resolved 2026-10-14 — account-verification hold cleared

AWS Support reviewed the account standing and granted an exception for all three
services in **us-east-1**. Confirmed live, not just claimed:

- **App Runner** — `apprunner list-services` now succeeds (`{"ServiceSummaryList": []}`,
  previously `SubscriptionRequiredException`).
- **Bedrock** — `bedrock-runtime converse` against `amazon.nova-lite-v1:0` now passes
  validation; it hit `ThrottlingException: Too many tokens per day` instead of
  `ValidationException: Operation not allowed` — a quota message, which only fires once
  the account is actually allowed to call the operation. Support's reply confirms this
  covers standard-tier models (Nova Lite included) but **not** higher-tier models
  (e.g. certain Claude models on Bedrock) — those need a higher account-standing
  threshold and aren't in scope for this project anyway (`bedrockTagger.ts` only ever
  calls Nova Lite).
- **CloudFront** — `cloudfront create-distribution` succeeded for real. Live distribution:
  **`E3SKL73S4R9ECD`**, domain **`dyswjdrhfb962.cloudfront.net`**, origin
  `wardrobe-looks-064308050230.s3.us-east-1.amazonaws.com`. Status was `InProgress`
  right after creation (CloudFront takes 5–15 min to finish deploying to all edge
  locations) — confirm `Status: Deployed` before relying on it for the demo.

**Follow-up still open:** swap `CLOUDFRONT_BASE_URL` from the S3-direct-endpoint interim
workaround to `https://dyswjdrhfb962.cloudfront.net` (env-only change, no code), then
run the App Runner deploy steps in this file for real (`create-service` was not attempted
yet — confirming `list-services` access was enough to prove the block is gone without
standing up billed compute before deliberately choosing to).

**Interim remote HTTPS URL (non-AWS):** `cloudflared tunnel --url http://localhost:3000`
gives a real public HTTPS URL independent of App Runner — verified 2026-09-07: real OAuth
2.1 PKCE flow + `tools/call` round trip in ~150 ms through it. See the README's "Expose
it for Alexa+" note for the exact env vars (`MCP_CANONICAL_URL` must match the tunnel
hostname, `ALLOW_DEV_TOKENS=false`). Not a substitute for the App Runner deploy — no
`min instances = 1` warm-start guarantee, the free quick-tunnel URL is random and not
production-stable — but it satisfies "reachable at a remote HTTPS URL" for testing and,
if the verification case isn't resolved by the deadline, as a demo fallback.
