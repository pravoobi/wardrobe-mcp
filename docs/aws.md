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
