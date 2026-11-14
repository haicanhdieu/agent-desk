#!/usr/bin/env bash
# Rootless setup for the Agent Desk runner pod (uid 10001, no sudo, no apt, no Docker socket).
# Runs in the cloned repo (cwd = repo root). Node 22 and git are already in the runner image.
# Not installed here: devbox (needs /nix as root), docker/postgres (no engine in the pod). Tests that need them are out of scope.
set -euo pipefail

BIN="$HOME/.local/bin"
mkdir -p "$BIN"
export PATH="$BIN:$PATH"

echo "==> 1/4 Tooling check"
node -v
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22 || (a===22 && b<9)) { console.error("need Node >= 22.9"); process.exit(1) }'

echo "==> 2/4 pnpm via corepack (into \$HOME, not /usr/local)"
PNPM_VERSION="$(node -p 'require("./package.json").packageManager.split("@")[1]')"
corepack enable --install-directory "$BIN" pnpm
corepack prepare "pnpm@${PNPM_VERSION}" --activate
pnpm -v

echo "==> 3/4 Env file"
[ -f .env ] || cp .env.example .env

echo "==> 4/4 Install dependencies"
pnpm install --frozen-lockfile

echo "Ready. Next: pnpm typecheck && pnpm test"
echo "(add \$HOME/.local/bin to PATH in new shells: export PATH=\"\$HOME/.local/bin:\$PATH\")"
