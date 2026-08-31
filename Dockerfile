# ---- build stage: install everything, build server + cli, export web ----
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app

# Dependency manifests first for layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/cli/package.json apps/cli/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @temujira/server build && pnpm --filter @temujira/cli build
ENV EXPO_NO_TELEMETRY=1 CI=1
RUN cd apps/web && npx expo export --platform web

# ---- runtime deps stage: production node_modules only ----
FROM node:22-slim AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/server/package.json apps/server/
COPY apps/cli/package.json apps/cli/
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
RUN pnpm install --prod --frozen-lockfile --filter @temujira/server --filter @temujira/cli
# Native module smoke check: fail the BUILD, not the first request at runtime.
RUN node -e "require('better-sqlite3'); console.log('better-sqlite3 ok')"

# ---- runtime ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000 \
    WEB_DIST=/app/web

COPY --from=deps /app/node_modules /app/node_modules
COPY --from=build /app/apps/server/dist /app/server
COPY --from=build /app/apps/cli/dist /app/cli
COPY --from=build /app/apps/web/dist /app/web

# The tmj CLI, usable via `docker compose exec app tmj ...`
RUN printf '#!/bin/sh\nexec node /app/cli/index.js "$@"\n' > /usr/local/bin/tmj && chmod +x /usr/local/bin/tmj

VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "/app/server/index.js"]
