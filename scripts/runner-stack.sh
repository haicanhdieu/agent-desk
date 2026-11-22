#!/usr/bin/env bash
# The local e2e stack without devbox or Docker, for the runner pod (docs/runbooks/runner-pod.md). Needs
# `RUNNER_SETUP_PROFILE=test` (or full) from scripts/runner-setup.sh.
#
#   scripts/runner-stack.sh up      Postgres (:54329) + Temporal dev server (:7233) -> migrate -> api (:3000) + worker
#   scripts/runner-stack.sh down    stop everything it started (and KUBE_MODE=fake run "pods")
#   scripts/runner-stack.sh status  one line per service
#
# Then: `pnpm test:e2e:local` (scripts/e2e-local.ts) and `pnpm --filter @agentdesk/web exec playwright test e2e/local`
# (Playwright starts Vite itself). Ports and the Postgres admin login match .env.example; a changed .env must keep them.
# State, logs and PID files live in RUNNER_STACK_DIR (default .agentdesk/runner-stack, git-ignored).
# RUNNER_STACK_APPS=0 starts only Postgres + Temporal (+ migrate).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
# shellcheck source=scripts/runner-env.sh
. scripts/runner-env.sh

dir="${RUNNER_STACK_DIR:-$root/.agentdesk/runner-stack}"
logs="$dir/logs"
pg_port=54329
temporal_port=7233
api_port=3000
# Dev-only admin login from .env.example (DATABASE_ADMIN_URL); the stack listens on 127.0.0.1 only.
pg_admin_password=postgres
pg_bin="${TEST_PG_BIN_DIR:-}"

die() {
  echo "runner-stack: $*" >&2
  exit 1
}

# wait_for <what> <seconds> <command...>: poll until the command succeeds.
wait_for() {
  local what="$1" secs="$2" i
  shift 2
  for ((i = 0; i < secs * 5; i++)); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 0.2
  done
  die "$what not ready after ${secs}s (logs: $logs)"
}

alive() { [ -f "$dir/$1.pid" ] && kill -0 "$(cat "$dir/$1.pid")" 2>/dev/null; }

# start_bg <name> <command...>: own process group (setsid) so `down` stops the whole tree; output to logs/<name>.log.
start_bg() {
  local name="$1"
  shift
  if alive "$name"; then
    echo "$name: already running"
    return
  fi
  setsid "$@" >"$logs/$name.log" 2>&1 </dev/null &
  echo $! >"$dir/$name.pid"
}

stop_bg() {
  local name="$1" pid i
  [ -f "$dir/$name.pid" ] || return 0
  pid="$(cat "$dir/$name.pid")"
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    for ((i = 0; i < 50; i++)); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.2
    done
    kill -KILL -- "-$pid" 2>/dev/null || true
  fi
  rm -f "$dir/$name.pid"
  echo "$name: stopped"
}

# KUBE_MODE=fake runs each run "pod" as a detached node process. There is no procps (pkill) in the runner image, so
# scan /proc for the command line instead.
stop_fake_pods() {
  local f pid
  for f in /proc/[0-9]*/cmdline; do
    pid="${f#/proc/}"
    pid="${pid%/cmdline}"
    if tr '\0' ' ' <"$f" 2>/dev/null | grep -q 'kube/fake-pod\.mjs'; then kill -TERM "$pid" 2>/dev/null || true; fi
  done
}

pg_ctl_cmd() { "$pg_bin/pg_ctl" -D "$dir/pgdata" "$@"; }

temporal_healthy() { temporal operator cluster health --address "127.0.0.1:$temporal_port"; }
api_ready() { curl -fsS "http://127.0.0.1:$api_port/readyz"; }

up() {
  if [ -z "$pg_bin" ] || [ ! -x "$pg_bin/pg_ctl" ]; then
    die "no Postgres binaries; run RUNNER_SETUP_PROFILE=test bash scripts/runner-setup.sh"
  fi
  command -v temporal >/dev/null || die "no temporal CLI; run RUNNER_SETUP_PROFILE=test bash scripts/runner-setup.sh"
  mkdir -p "$logs"
  [ -f .env ] || cp .env.example .env

  echo "==> postgres on 127.0.0.1:$pg_port"
  if [ ! -f "$dir/pgdata/PG_VERSION" ]; then
    local pwfile="$dir/pwfile"
    (umask 077 && printf '%s\n' "$pg_admin_password" >"$pwfile")
    "$pg_bin/initdb" -D "$dir/pgdata" -U postgres --pwfile="$pwfile" --auth=scram-sha-256 --encoding=UTF8 \
      --no-locale >"$logs/initdb.log" 2>&1 || {
      rm -f "$pwfile"
      die "initdb failed (log: $logs/initdb.log)"
    }
    rm -f "$pwfile"
  fi
  if pg_ctl_cmd status >/dev/null 2>&1; then
    echo "postgres: already running"
  else
    pg_ctl_cmd -l "$logs/postgres.log" -w -t 60 -o "-p $pg_port -k $dir -h 127.0.0.1" start >/dev/null ||
      die "postgres did not start (log: $logs/postgres.log)"
  fi

  echo "==> temporal dev server on 127.0.0.1:$temporal_port (namespace agentdesk)"
  start_bg temporal temporal server start-dev --headless --ip 127.0.0.1 --port "$temporal_port" \
    --namespace agentdesk --db-filename "$dir/temporal.db" --log-level warn
  wait_for temporal 60 temporal_healthy

  echo "==> migrate"
  pnpm --filter @agentdesk/api migrate >"$logs/migrate.log" 2>&1 || die "migrate failed (log: $logs/migrate.log)"

  echo "==> seed dev admin"
  pnpm --filter @agentdesk/api seed:dev-admin >"$logs/seed-dev-admin.log" 2>&1 || die "seed-dev-admin failed (log: $logs/seed-dev-admin.log)"

  if [ "${RUNNER_STACK_APPS:-1}" = 0 ]; then
    echo "==> up (services only). Logs: $logs"
    return
  fi
  echo "==> api (:$api_port) and worker"
  HOST=127.0.0.1 start_bg api pnpm --filter @agentdesk/api dev
  start_bg worker pnpm --filter @agentdesk/worker dev
  wait_for api 120 api_ready
  echo "==> up. Logs: $logs. Next: pnpm test:e2e:local"
}

down() {
  stop_bg api
  stop_bg worker
  stop_fake_pods
  stop_bg temporal
  if [ -n "$pg_bin" ] && [ -f "$dir/pgdata/PG_VERSION" ] && pg_ctl_cmd status >/dev/null 2>&1; then
    pg_ctl_cmd -m fast -w stop >/dev/null
    echo "postgres: stopped"
  fi
}

status() {
  local s
  if [ -n "$pg_bin" ] && [ -f "$dir/pgdata/PG_VERSION" ] && pg_ctl_cmd status >/dev/null 2>&1; then s=up; else s=down; fi
  echo "postgres: $s"
  for s in temporal api worker; do
    if alive "$s"; then echo "$s: up (pid $(cat "$dir/$s.pid"))"; else echo "$s: down"; fi
  done
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  status) status ;;
  *)
    echo "usage: scripts/runner-stack.sh up|down|status" >&2
    exit 64
    ;;
esac
