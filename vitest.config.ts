import { defineConfig } from "vitest/config";

export default defineConfig({
  ssr: {
    external: ["node:sqlite"],
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    hookTimeout: 20000,
    server: {
      deps: {
        external: ["node:sqlite", /node:sqlite/],
      },
    },
    env: {
      STORE: "sqlite",
      SQLITE_PATH: ":memory:",
      MCP_CANONICAL_URL: "http://localhost:3000/mcp",
      PUBLIC_RENDER_BASE_URL: "http://localhost:3000/renders",
    },
  },
});
