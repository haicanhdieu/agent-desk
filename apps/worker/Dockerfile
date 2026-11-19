# Agent Desk worker image. Build from the repository root:
#   docker build -f apps/worker/Dockerfile .
# The app runs from TypeScript source through tsx, like its own `start` script, so the image holds the source of
# the worker and its workspace packages plus their production dependencies. There is no compiled dist/.
# The base image is pinned by digest (node:22-slim, multi-arch index).
FROM node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS build

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# pnpm comes from the "packageManager" field of package.json.
RUN corepack enable
WORKDIR /app

# Manifests first, so the install layer is reused until a dependency changes. pnpm reads the lockfile for every
# workspace member, so all manifests are copied.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY images/runner/package.json images/runner/
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --prod --filter @agentdesk/worker...

# @swc/core 1.16 copies a package-provided native addon into a cache directory before loading it, and refuses
# the world-writable /tmp that a Kubernetes emptyDir gives (no sticky bit). The loader first tries a file next to
# binding.js, so place the arm64 addon there and no cache is needed.
RUN cp /app/node_modules/.pnpm/@swc+core-linux-arm64-gnu@*/node_modules/@swc/core-linux-arm64-gnu/swc.linux-arm64-gnu.node \
       /app/node_modules/.pnpm/@swc+core@*/node_modules/@swc/core/

COPY tsconfig.base.json ./
COPY packages packages
COPY apps/worker apps/worker

FROM node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS runtime

# uid 10001 matches the securityContext used when the image runs on Kubernetes.
RUN groupadd -g 10001 agentdesk \
 && useradd -u 10001 -g 10001 -M -d /tmp -s /usr/sbin/nologin agentdesk
COPY --from=build /app /app

# Read-only root file system: tsx and Node write their caches under HOME, so mount a writable /tmp.
ENV HOME=/tmp
USER 10001:10001
WORKDIR /app/apps/worker
CMD ["node", "--import", "tsx", "src/main.ts"]
