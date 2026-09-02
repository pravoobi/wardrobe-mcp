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

export const config = {
  /** Canonical MCP URL — the OAuth `resource` value. No trailing slash. */
  canonicalUrl: canonical,
  issuer: new URL(canonical).origin,
  port: Number(env("PORT", "3000")),
  host: env("HOST", "0.0.0.0"),
  store: env("STORE", "sqlite") as "sqlite" | "dynamodb",
  sqlitePath: env("SQLITE_PATH", "./data/wardrobe.sqlite"),
  storage: env("STORAGE", "local") as "local" | "s3",
  localRenderDir: env("LOCAL_RENDER_DIR", "./renders"),
  publicRenderBaseUrl: env("PUBLIC_RENDER_BASE_URL", "http://localhost:3000/renders").replace(
    /\/$/,
    "",
  ),
  taggingProvider: env("TAGGING_PROVIDER", "none") as "none" | "bedrock",
  tryonAppUrl: env("TRYON_APP_URL", "https://pravoobi.github.io/try-on/"),
  tryonAppVersion: env("TRYON_APP_VERSION", "dev"),
  awsRegion: env("AWS_REGION", "us-east-1"),
} as const;

export const PROTOCOL_MIN = "2025-11-25";
