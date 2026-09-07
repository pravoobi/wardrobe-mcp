/** Bundles the Phase 5 simulator's browser client (real @modelcontextprotocol/sdk
 * client + PKCE OAuth + the Bedrock-loop UI) into one self-contained ESM file.
 * No CDN dependency — the SDK ships in this bundle, so the demo works offline. */
import { build } from "esbuild";

await build({
  entryPoints: ["web/app.ts"],
  outfile: "web/dist/app.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
});

console.log("web/dist/app.js built.");
