# AWS Builder — integrations

Region: **us-east-1** (Alexa+ traffic is US; keeps the < 500 ms round trip achievable).

| Service | Used for | Why | Status |
|---|---|---|---|
| **App Runner** | Hosts the container from an ECR image. | HTTPS + autoscaling out of the box; `min instances = 1` keeps it warm so no cold start inside a tool call. | Phase 3 |
| **S3** | Stores rendered look images and compare sheets (WEBP/PNG). | Durable object store; renders are write-once, read-many. | Phase 3 |
| **CloudFront** | Serves those images over HTTPS. | Alexa+ requires HTTPS image URLs; edge cache keeps `preview_look` responses tiny. | Phase 3 |
| **DynamoDB** | Prod `Store` impl (single-table, `PK = USER#id`). | Single-digit-ms reads; the tool latency budget has no room for anything slower. | Phase 3 |
| **Bedrock** | Garment auto-tagging — image → `{name, color, occasion[], category}` when a customer uploads a garment in the companion UI. | The *only* LLM call in the system; runs at upload time, never in a tool call. Makes an uploaded garment searchable by voice. | Phase 3 |

Config is env-driven (`STORE`, `STORAGE`, `TAGGING_PROVIDER`, `AWS_REGION`, …); no secrets
in the repo. Local dev uses SQLite + `./renders` static serving so none of the above is
required to run or demo the server.

## Latency budget

`preview_look` / `compare_looks` / `suggest_outfits` measured with `curl -w` from a
us-east-1 CloudShell against the deployed URL must be < 500 ms for every tool. Numbers
recorded here in Phase 3.
