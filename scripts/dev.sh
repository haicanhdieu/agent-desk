#!/usr/bin/env bash
# Local dev stack. `scripts/dev.sh up` (default): compose up (healthy) -> DB bootstrap + migrations -> api + worker (+ web).
# `scripts/dev.sh down`: stop the compose stack and any fake run pods left over from KUBE_MODE=fake.
#
# COMPOSE picks the compose command (default "docker compose"; Podman: COMPOSE="podman compose").
# DEV_WEB=0 skips the web app (apps/web belongs to the frontend; it is started when it has a dev script).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

# Intentionally word-split: COMPOSE is a command plus arguments ("podman compose").
read -r -a compose <<<"${COMPOSE:-docker compose}"

case "${1:-up}" in
  up)
    if [ ! -f .env ]; then
      cp .env.example .env
      echo "dev: no .env found; created it from .env.example"
    fi

    "${compose[@]}" up -d --wait

    # Idempotent: roles/databases are created or updated, applied migrations are skipped.
    pnpm --filter @agentdesk/api migrate

    filters=(--filter=@agentdesk/api --filter=@agentdesk/worker)
    if [ "${DEV_WEB:-1}" != "0" ] && node -e 'process.exit(require("./apps/web/package.json").scripts?.dev ? 0 : 1)'; then
      filters+=(--filter=@agentdesk/web)
    fi
    exec pnpm exec turbo run dev "${filters[@]}"
    ;;
  down)
    "${compose[@]}" down "${@:2}"
    # KUBE_MODE=fake runs each "pod" as a detached node process; stop any that outlived the worker.
    pkill -f 'kube/fake-pod\.mjs' 2>/dev/null || true
    ;;
  *)
    echo "usage: scripts/dev.sh [up|down [compose down args]]" >&2
    exit 64
    ;;
esac
