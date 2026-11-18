# Agent Desk web image: the Vite build served by unprivileged nginx on port 8080. Build from the repository root:
#   docker build -f apps/web/Dockerfile .
# Base images are pinned by digest (node:22-slim and nginx-unprivileged stable-alpine, both multi-arch indexes).
FROM node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS build

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# pnpm comes from the "packageManager" field of package.json.
RUN corepack enable
WORKDIR /app

# Manifests first, so the install layer is reused until a dependency changes. pnpm reads the lockfile for every
# workspace member, so all manifests are copied. The build needs dev dependencies (Vite), so there is no --prod.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY images/runner/package.json images/runner/
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter @agentdesk/web...

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN pnpm --filter @agentdesk/web exec vite build

FROM nginxinc/nginx-unprivileged:stable-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03 AS runtime

# Unknown paths fall back to index.html (single-page app); hashed assets are cached for a year, index.html never.
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

# The config and the site stay root-owned and read-only. nginx keeps its pid file and temp paths under /tmp and logs to
# stdout, so the container can run with a read-only root file system and a writable /tmp.
# uid 10001 matches the securityContext used when the image runs on Kubernetes.
USER 10001:10001
EXPOSE 8080
