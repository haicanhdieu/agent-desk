#!/usr/bin/env bash
# Keeps the local k3s runner image in step with images/runner. Run by `devbox run dev` (and by hand:
# `devbox run runner-image`). It rebuilds and imports the image only when a file that goes into it changed, or when
# the image is missing from k3s. Only acts for KUBE_MODE=kubeconfig with the local `agentdesk-k3s` container
# (docs/runbooks/connect-github-app-local.md section 4); anything else is skipped so `dev` never blocks on it.
#
# Env: PODMAN (default podman), K3S_CONTAINER (default agentdesk-k3s), RUNNER_IMAGE_REPO_ROOT (test seam).
set -euo pipefail

root="${RUNNER_IMAGE_REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$root"

podman="${PODMAN:-podman}"
k3s="${K3S_CONTAINER:-agentdesk-k3s}"
stamp="$root/.agentdesk/runner-image.sha"

# KUBE_MODE comes from the environment or .env (never sourced: .env holds secrets).
kube_mode="${KUBE_MODE:-}"
if [ -z "$kube_mode" ] && [ -f .env ]; then
  kube_mode="$(sed -n 's/^KUBE_MODE=//p' .env | tail -n 1)"
fi
if [ "$kube_mode" != kubeconfig ]; then
  echo "runner-image: skipped (KUBE_MODE=${kube_mode:-unset}, not kubeconfig)"
  exit 0
fi
if ! command -v "$podman" >/dev/null 2>&1 || [ -z "$("$podman" ps --filter "name=^${k3s}\$" --format '{{.Names}}' 2>/dev/null)" ]; then
  echo "runner-image: skipped (no running '$k3s' container; see connect-github-app-local.md section 4)"
  exit 0
fi

# xargs needs a real command, not a function; both print "<hash>  <file>" lines.
if command -v sha256sum >/dev/null 2>&1; then sha=(sha256sum); else sha=(shasum -a 256); fi

# Hash of everything the Dockerfile can copy: tracked and new files under images/runner, minus tests and the package
# tooling files that are not part of the image. The path is hashed along with the content.
current="$(
  git ls-files -z --cached --others --exclude-standard -- images/runner \
    ':(exclude)images/runner/test' ':(exclude)images/runner/package.json' \
    ':(exclude)images/runner/tsconfig.json' ':(exclude)images/runner/vitest.config.ts' |
    xargs -0 "${sha[@]}" | "${sha[@]}" | cut -c1-16
)"

in_k3s() {
  "$podman" exec "$k3s" ctr -n k8s.io images ls -q 2>/dev/null | grep -q 'agentdesk-runner:dev'
}

if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$current" ] && in_k3s; then
  echo "runner-image: up to date ($current)"
  exit 0
fi

echo "runner-image: images/runner changed or image missing; rebuilding ($current)"
"$podman" build -q -t localhost/agentdesk-runner:dev images/runner >/dev/null
# k3s resolves the docker.io/library/ name, which a plain `podman build -t agentdesk-runner:dev` does not create.
"$podman" tag localhost/agentdesk-runner:dev docker.io/library/agentdesk-runner:dev
"$podman" save docker.io/library/agentdesk-runner:dev | "$podman" exec -i "$k3s" ctr -n k8s.io images import - >/dev/null
mkdir -p "$(dirname "$stamp")"
printf '%s\n' "$current" >"$stamp"
echo "runner-image: loaded into $k3s. Runs started from now use it; running pods keep the old one."
