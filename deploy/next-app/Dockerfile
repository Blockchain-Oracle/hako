# syntax=docker/dockerfile:1
# One image recipe for both Next.js apps (apps/web, apps/docs), built from the repo root:
#
#   docker build -f deploy/next-app/Dockerfile --build-arg APP=web .
#
# prune → only the app and the workspace packages it imports (turbo prune --docker), so the install layer is keyed
# on those manifests and the pruned lockfile alone; build → next build (standalone); runner → the traced server,
# static assets and public/, as the non-root `node` user. NEXT_PUBLIC_* values are inlined at build time, so they
# arrive as build arguments (the GHCR workflow passes repository variables).
ARG NODE_IMAGE=node:24-slim

FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION=11.24.0
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

FROM base AS prune
ARG APP
ARG TURBO_VERSION=2.11.3
COPY . .
RUN test -n "$APP" && pnpm dlx turbo@${TURBO_VERSION} prune "$APP" --docker

FROM base AS build
ARG APP
COPY --from=prune /app/out/json/ .
RUN --mount=type=cache,id=hako-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=prune /app/out/full/ .
# turbo prune keeps workspace members only: the shared compiler settings live at the root
COPY --from=prune /app/tsconfig.base.json ./
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_DOCS_URL
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_DOCS_URL=${NEXT_PUBLIC_DOCS_URL}
RUN --mount=type=cache,id=hako-next-cache,target=/app/apps/${APP}/.next/cache \
    pnpm turbo run build --filter="$APP"

FROM ${NODE_IMAGE} AS runner
ARG APP
# curl is what Coolify's container health check runs; node:*-slim ships without it.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    APP_DIR=apps/${APP}
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/${APP}/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/${APP}/.next/static ./apps/${APP}/.next/static
COPY --from=build --chown=node:node /app/apps/${APP}/public ./apps/${APP}/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
CMD ["sh", "-c", "exec node \"$APP_DIR/server.js\""]
