# syntax=docker/dockerfile:1
# hako-gateway: the public x402 front door. Built from the repo root:
#
#   docker build -f services/gateway/Dockerfile .
#
# prune → only the gateway and the workspace packages it imports (turbo prune --docker), so the install layer is keyed
# on those manifests and the pruned lockfile alone; build → esbuild bundles the server and its dependencies into one
# ESM file; runner → node + that file, as the non-root `node` user.
ARG NODE_IMAGE=node:24-slim

FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION=11.24.0
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

FROM base AS prune
ARG TURBO_VERSION=2.11.3
COPY . .
RUN pnpm dlx turbo@${TURBO_VERSION} prune @hako/gateway --docker

FROM base AS build
COPY --from=prune /app/out/json/ .
RUN --mount=type=cache,id=hako-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=prune /app/out/full/ .
# turbo prune keeps workspace members only: the shared compiler settings live at the root
COPY --from=prune /app/tsconfig.base.json ./
RUN pnpm turbo run build --filter=@hako/gateway

FROM ${NODE_IMAGE} AS runner
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /app/services/gateway/dist/server.mjs ./server.mjs
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD curl -fsS http://localhost:8080/v1/health || exit 1
CMD ["node", "server.mjs"]
