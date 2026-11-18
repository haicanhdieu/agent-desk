#!/usr/bin/env bash
# Smoke checks for the container images built by the `images / build` CI job. Each check runs the image the way the
# platform will: as uid 10001, with a read-only root file system and a writable /tmp.
# Usage: scripts/smoke-app-images.sh <api|worker|web|runner>
# Env: IMAGE_PREFIX (default agentdesk), IMAGE_TAG (default ci). The image is $IMAGE_PREFIX-<name>:$IMAGE_TAG.
set -euo pipefail

name="${1:?usage: smoke-app-images.sh <api|worker|web|runner>}"
image="${IMAGE_PREFIX:-agentdesk}-$name:${IMAGE_TAG:-ci}"
run_args=(--read-only --tmpfs "/tmp:rw,mode=1777,size=512m")
cid=""

cleanup() {
  if [ -n "$cid" ]; then docker rm -f "$cid" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

fail() {
  echo "smoke($name): $*" >&2
  if [ -n "$cid" ]; then docker logs "$cid" >&2 || true; fi
  exit 1
}

# Waits up to 60 seconds for a URL to answer with a success status.
wait_for() {
  local _
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "$1" 2>/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}

uid="$(docker run --rm --entrypoint id "$image" -u)"
[ "$uid" = "10001" ] || fail "runs as uid $uid, want 10001"

case "$name" in
  api)
    # Liveness must not need a database: every dependency points at a closed port.
    cid="$(docker run -d "${run_args[@]}" -p 127.0.0.1:3000:3000 \
      -e PUBLIC_ORIGIN=http://localhost:3000 \
      -e DATABASE_APP_URL=postgres://smoke:smoke@127.0.0.1:1/smoke \
      -e DATABASE_OWNER_URL=postgres://smoke:smoke@127.0.0.1:1/smoke \
      -e DATABASE_ADMIN_URL=postgres://smoke:smoke@127.0.0.1:1/smoke \
      -e TEMPORAL_ADDRESS=127.0.0.1:1 -e TEMPORAL_NAMESPACE=smoke \
      -e BETTER_AUTH_SECRET=smoke-test-secret-smoke-test-secret \
      -e RUNNER_IMAGE=smoke-runner \
      "$image")"
    wait_for http://127.0.0.1:3000/healthz || fail "/healthz did not return 200 within 60s"
    body="$(curl -fsS http://127.0.0.1:3000/healthz)"
    [ "$body" = '{"status":"ok"}' ] || fail "unexpected /healthz body: $body"
    # The migrate entry starts and, with no configuration, stops with a clear message.
    if out="$(docker run --rm "${run_args[@]}" "$image" node --import tsx src/migrate.ts 2>&1)"; then
      fail "migrate exited 0 without configuration"
    fi
    grep -q 'Missing required environment variable DATABASE_ADMIN_URL' <<<"$out" || fail "unexpected migrate output: $out"
    ;;
  worker)
    # No configuration: the worker loads every module, then stops on the configuration error.
    if out="$(docker run --rm "${run_args[@]}" "$image" 2>&1)"; then
      fail "worker exited 0 without configuration"
    fi
    grep -q 'Invalid configuration' <<<"$out" || fail "unexpected worker output: $out"
    ;;
  web)
    cid="$(docker run -d "${run_args[@]}" -p 127.0.0.1:8080:8080 "$image")"
    wait_for http://127.0.0.1:8080/ || fail "/ did not return 200 within 60s"
    index="$(curl -fsS http://127.0.0.1:8080/)"
    grep -q '<div id="root">' <<<"$index" || fail "/ is not index.html"
    deep="$(curl -fsS http://127.0.0.1:8080/o/acme/projects/demo)"
    [ "$deep" = "$index" ] || fail "an unknown path does not fall back to index.html"
    headers="$(curl -fsSI http://127.0.0.1:8080/)"
    grep -iq '^cache-control: no-cache' <<<"$headers" || fail "index.html is cacheable: $headers"
    asset="$(grep -o '/assets/[^"]*\.js' <<<"$index" | head -n 1)"
    [ -n "$asset" ] || fail "index.html names no script under /assets/"
    headers="$(curl -fsSI "http://127.0.0.1:8080$asset")"
    grep -iq '^cache-control:.*immutable' <<<"$headers" || fail "$asset is not immutable: $headers"
    code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/assets/missing.js)"
    [ "$code" = "404" ] || fail "a missing asset returned $code, want 404"
    ;;
  runner)
    docker run --rm --entrypoint sh "$image" -c 'git --version && gh --version && tmux -V && claude --version' >/dev/null ||
      fail "a tool the runner needs is missing"
    # The real entrypoint rejects an unknown agent before it touches anything else.
    status=0
    out="$(docker run --rm -e AGENT=smoke "$image" 2>&1)" || status=$?
    [ "$status" = "2" ] || fail "entrypoint exited $status, want 2: $out"
    grep -q 'unsupported agent' <<<"$out" || fail "unexpected entrypoint output: $out"
    ;;
  *)
    fail "unknown image name (api, worker, web or runner)"
    ;;
esac

echo "smoke($name): ok"
