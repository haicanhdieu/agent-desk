#!/usr/bin/env bash
# Which environment is this, and how should tests run here? (docs/runbooks/runner-pod.md)
#   bash scripts/detect-env.sh          key=value lines (read by humans and scripts), always exit 0
#   bash scripts/detect-env.sh --json   the same as one JSON object
# mode: runner-pod | human-devbox | human-docker | unknown. Read-only: it starts and changes nothing.
set -uo pipefail

json=0
[ "${1:-}" = --json ] && json=1
tools="${RUNNER_TOOLS_DIR:-$HOME/.local/opt/runner-tools}"

yn() { if "$@" >/dev/null 2>&1; then echo yes; else echo no; fi; }

# run_for <seconds> <command...>: like timeout(1), which macOS lacks. Exit status of the command, 124 on timeout.
run_for() {
  local secs="$1" pid watcher rc
  shift
  "$@" >/dev/null 2>&1 &
  pid=$!
  (sleep "$secs" && kill "$pid" 2>/dev/null) >/dev/null 2>&1 &
  watcher=$!
  wait "$pid"
  rc=$?
  kill "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
  return "$rc"
}

engine_reachable() {
  if command -v docker >/dev/null 2>&1 && run_for 5 docker info; then return 0; fi
  command -v podman >/dev/null 2>&1 && run_for 5 podman info
}

# The Job sets AGENTDESK_* (token file, git identity); the image runs as uid 10001 in /workspace.
runner_signal=no
if [ -n "${AGENTDESK_TOKEN_FILE:-}${AGENTDESK_GIT_HOST:-}${AGENTDESK_GIT_USERNAME:-}${AGENTDESK_REPO_DIR:-}" ]; then
  runner_signal=yes
elif [ "$(id -u)" = 10001 ] && [ -d /workspace ]; then
  case "$PWD/" in /workspace/*) runner_signal=yes ;; esac
fi

docker_engine=$(yn engine_reachable)
devbox=$(yn command -v devbox)
if [ "$runner_signal" = yes ]; then
  mode=runner-pod
elif [ "$devbox" = yes ]; then
  mode=human-devbox
elif [ "$docker_engine" = yes ]; then
  mode=human-docker
else
  mode=unknown
fi

postgres_bin=$(yn test -x "$tools/postgresql/bin/postgres")
temporal_cli=$(yn test -x "$tools/temporal-cli/temporal")
temporal_test_server=$(yn test -x "$tools/temporal-test-server/temporal-test-server")
pw_path="${PLAYWRIGHT_BROWSERS_PATH:-}"
if [ -z "$pw_path" ]; then
  case "$(uname -s)" in Darwin) pw_path="$HOME/Library/Caches/ms-playwright" ;; *) pw_path="$HOME/.cache/ms-playwright" ;; esac
fi
chromium=no
for d in "$pw_path"/chromium_headless_shell-* "$pw_path"/chromium-*; do
  if [ -f "$d/INSTALLATION_COMPLETE" ]; then chromium=yes; fi
done
env_sourced=$([ "${TEST_PG_MODE:-}" = local ] && echo yes || echo no)

# Memory: the cgroup limit when there is one (the pod), else physical memory. MiB; "unknown" when unreadable.
mem_limit=unknown
mem_used=unknown
if [ -r /sys/fs/cgroup/memory.max ]; then
  v="$(cat /sys/fs/cgroup/memory.max)"
  [ "$v" != max ] && mem_limit=$((v / 1048576))
  [ -r /sys/fs/cgroup/memory.current ] && mem_used=$(($(cat /sys/fs/cgroup/memory.current) / 1048576))
elif [ -r /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
  v="$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes)"
  [ "$v" -lt 9223372036854000000 ] 2>/dev/null && mem_limit=$((v / 1048576))
  mem_used=$(($(cat /sys/fs/cgroup/memory/memory.usage_in_bytes) / 1048576))
fi
if [ "$mem_limit" = unknown ]; then
  if [ -r /proc/meminfo ]; then
    mem_limit=$(($(awk '/^MemTotal:/{print $2}' /proc/meminfo) / 1024))
  elif command -v sysctl >/dev/null 2>&1; then
    v="$(sysctl -n hw.memsize 2>/dev/null)" && mem_limit=$((v / 1048576))
  fi
fi
mem_headroom=unknown
if [ "$mem_limit" != unknown ] && [ "$mem_used" != unknown ]; then mem_headroom=$((mem_limit - mem_used)); fi
disk_free() { df -Pk "$1" 2>/dev/null | awk 'NR==2{print int($4/1024)}'; }
disk_free_repo=$(disk_free "$PWD")
disk_free_home=$(disk_free "$HOME")

# What to run. Thresholds come from the measured full flow (docs/runbooks/runner-pod.md, "Budget").
case "$mode" in
  human-devbox) tests='devbox run check; e2e: devbox run dev-bg && devbox run e2e-local' ;;
  human-docker) tests='pnpm test (Testcontainers); e2e: pnpm dev, then pnpm test:e2e:local' ;;
  runner-pod)
    if [ "$postgres_bin" = yes ] && [ "$temporal_cli" = yes ]; then
      tests='source scripts/runner-env.sh && pnpm test; e2e: scripts/runner-stack.sh up && pnpm test:e2e:local'
    else
      tests='pnpm test:unit (integration needs RUNNER_SETUP_PROFILE=test bash scripts/runner-setup.sh)'
    fi
    ;;
  *) tests='pnpm test:unit (no container engine or runner tools found)' ;;
esac

keys=(mode uid runner_signal docker_engine devbox postgres_bin temporal_cli temporal_test_server chromium env_sourced
  mem_limit_mib mem_used_mib mem_headroom_mib disk_free_repo_mib disk_free_home_mib tests)
vals=("$mode" "$(id -u)" "$runner_signal" "$docker_engine" "$devbox" "$postgres_bin" "$temporal_cli"
  "$temporal_test_server" "$chromium" "$env_sourced" "$mem_limit" "$mem_used" "$mem_headroom"
  "${disk_free_repo:-unknown}" "${disk_free_home:-unknown}" "$tests")

if [ "$json" = 1 ]; then
  out='{'
  for i in "${!keys[@]}"; do
    v="${vals[$i]}"
    if [[ "$v" =~ ^[0-9]+$ ]]; then out+="\"${keys[$i]}\":$v"; else out+="\"${keys[$i]}\":\"${v//\"/\\\"}\""; fi
    [ "$i" -lt $((${#keys[@]} - 1)) ] && out+=','
  done
  echo "$out}"
else
  for i in "${!keys[@]}"; do echo "${keys[$i]}=${vals[$i]}"; done
fi
exit 0
