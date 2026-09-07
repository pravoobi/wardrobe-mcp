/** Central env-driven config. Import `config`, never `process.env`, from app code. */

function env(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env var: ${key}`);
  }
  return v;
}

const canonical = env("MCP_CANONICAL_URL", "http://localhost:3000/mcp").replace(/\/$/, "");
const isProd = process.env.NODE_ENV === "production";

export const config = {
  /** Canonical MCP URL — the OAuth `resource` value. No trailing slash. */
  canonicalUrl: canonical,
  issuer: new URL(canonical).origin,
  port: Number(env("PORT", "3000")),
  host: env("HOST", "0.0.0.0"),
  isProd,
  store: env("STORE", "sqlite") as "sqlite" | "dynamodb",
  sqlitePath: env("SQLITE_PATH", "./data/wardrobe.sqlite"),
  storage: env("STORAGE", "local") as "local" | "s3",
  localRenderDir: env("LOCAL_RENDER_DIR", "./renders"),
  publicRenderBaseUrl: env("PUBLIC_RENDER_BASE_URL", "http://localhost:3000/renders").replace(
    /\/$/,
    "",
  ),
  /** Renderer backend. Validated rather than blind-cast: a typo like
   * `RENDER_MODE=browserr` should fail loudly at boot, not silently render nothing. */
  renderMode: (() => {
    const v = env("RENDER_MODE", "local");
    if (v !== "local" && v !== "browser" && v !== "stub") {
      throw new Error(`Invalid RENDER_MODE "${v}" — expected local | browser | stub`);
    }
    return v;
  })(),
  /** How long the browser renderer waits for the try-on canvas to settle. */
  renderSettleMs: Number(env("RENDER_SETTLE_MS", "45000")),
  taggingProvider: env("TAGGING_PROVIDER", "none") as "none" | "bedrock",
  tryonAppUrl: env("TRYON_APP_URL", "https://pravoobi.github.io/try-on/"),
  tryonAppVersion: env("TRYON_APP_VERSION", "dev"),
  awsRegion: env("AWS_REGION", "us-east-1"),
  dynamoTable: env("DYNAMODB_TABLE", "wardrobe"),
  dynamoEndpoint: process.env.DYNAMODB_ENDPOINT || undefined,
  s3Bucket: process.env.S3_BUCKET || undefined,
  cloudfrontBaseUrl: (process.env.CLOUDFRONT_BASE_URL ?? "").replace(/\/$/, "") || undefined,
  bedrockModelId: env("BEDROCK_MODEL_ID", "amazon.nova-lite-v1:0"),

  /** `dev_<userId>` bearer tokens — a local convenience, never in production. */
  allowDevTokens: env("ALLOW_DEV_TOKENS", isProd ? "false" : "true") === "true",

  oauth: {
    authCodeTtlSeconds: 60,
    accessTokenTtlSeconds: 15 * 60,
    refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
    scopesSupported: ["wardrobe:read", "wardrobe:write"] as const,
  },
} as const;

export const PROTOCOL_MIN = "2025-11-25";
