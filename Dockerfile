# Playwright base image: Chromium + all its system deps preinstalled, Node 22.
# Tag must track the `playwright` devDependency so the browser matches the driver.
FROM mcr.microsoft.com/playwright:v1.62.1-noble AS base
ENV NODE_ENV=production
WORKDIR /app

# ---- deps (prod only) ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- build (needs dev deps + TS) ----
FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY web ./web
COPY scripts ./scripts
RUN npm run build
# `build` (not `runtime`) is also the target `docker-compose.yml`'s one-off `seed`
# service uses — it has tsx + devDependencies + scripts/, so `npx tsx scripts/seed.ts`
# runs here without shipping any of that into the production image.

# ---- runtime ----
FROM base AS runtime
# App Runner sends traffic to $PORT; default 3000 for local `docker run`.
ENV PORT=3000
# Pass --build-arg GIT_SHA=$(git rev-parse --short HEAD) so /version reports
# which commit is actually running — this is what would have made the
# stale-image-missing-plan_week bug (friction log #11) obvious immediately
# instead of needing a live tools/list diff to discover.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/web ./web
COPY package.json ./
# Chromium is already in the base image; point Playwright at it.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
EXPOSE 3000
# Drop to the non-root user the Playwright image ships.
USER pwuser
CMD ["node", "dist/server.js"]
