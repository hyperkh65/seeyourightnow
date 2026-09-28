# syntax=docker/dockerfile:1.7
# API + background worker image. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t sourcing-os-api .
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/
# Optional build secret `extra_ca`: CA bundle for TLS-inspecting corporate proxies.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi \
 && pnpm install --frozen-lockfile --filter @sos/api... --filter @sos/core
COPY packages/core packages/core
COPY apps/api apps/api
RUN pnpm --filter @sos/core build && pnpm --filter @sos/api build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi \
 && pnpm --filter @sos/api deploy --prod --legacy /out \
 && cp -r apps/api/dist apps/api/drizzle apps/api/docker-entrypoint.sh /out/ \
 && rm -rf /out/node_modules/@sos/core/src

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production PORT=4000 HOST=0.0.0.0
WORKDIR /app
# Runs as the unprivileged `node` user that ships with the official image (no extra packages needed).
COPY --from=build --chown=node:node /out /app
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Use `init: true` (compose) / `--init` (docker run) for signal handling.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
