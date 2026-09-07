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

## Latency

`preview_look` / `compare_looks` / `suggest_outfits` measured with `curl -w` from a
us-east-1 CloudShell against the deployed URL must be < 500 ms for every tool. Numbers
recorded here once the service is up.

| tool | local (this machine) | us-east-1 → App Runner |
|---|---|---|
| `suggest_outfits` | ~25 ms | _pending_ |
| `preview_look` (cache hit) | ~25 ms | _pending_ |
| `compare_looks` (cache hit) | ~20 ms | _pending_ |

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

**Interim remote HTTPS URL (non-AWS):** `cloudflared tunnel --url http://localhost:3000`
gives a real public HTTPS URL independent of App Runner — verified 2026-09-07: real OAuth
2.1 PKCE flow + `tools/call` round trip in ~150 ms through it. See the README's "Expose
it for Alexa+" note for the exact env vars (`MCP_CANONICAL_URL` must match the tunnel
hostname, `ALLOW_DEV_TOKENS=false`). Not a substitute for the App Runner deploy — no
`min instances = 1` warm-start guarantee, the free quick-tunnel URL is random and not
production-stable — but it satisfies "reachable at a remote HTTPS URL" for testing and,
if the verification case isn't resolved by the deadline, as a demo fallback.
