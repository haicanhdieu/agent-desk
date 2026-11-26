#!/usr/bin/env bash
# Opt-in Serena (semantic code tools) for the Agent Desk runner pod. Called by scripts/runner-setup.sh with
# cwd = repo root; does nothing unless RUNNER_ENABLE_SERENA=1 (unset or 0 = off). Everything lands under $HOME.
# Idempotent: finished steps are skipped. Linux only, and only when the `claude` CLI is on PATH.
set -euo pipefail

case "${RUNNER_ENABLE_SERENA:-0}" in
  0) exit 0 ;;
  1) ;;
  *)
    echo "runner-serena: RUNNER_ENABLE_SERENA must be unset, 0 or 1" >&2
    exit 64
    ;;
esac

if [ "$(uname -s)" != Linux ]; then
  echo "runner-serena: skipping, Serena is only set up on Linux (the runner pod)" >&2
  exit 0
fi
BIN="$HOME/.local/bin"
export PATH="$BIN:$PATH"
if ! command -v claude >/dev/null 2>&1; then
  echo "runner-serena: skipping, the claude CLI is not on PATH" >&2
  exit 0
fi

# --- Pins (bump a version together with its sha256 values; a stale pin fails closed) ---
SERENA_VERSION=2.1.0 # PyPI serena-agent
UV_VERSION=0.9.28 # astral-sh/uv release
UV_PYTHON=3.12 # interpreter uv provisions for the Serena tool environment
case "$(uname -m)" in
  aarch64 | arm64)
    uv_arch=aarch64
    UV_SHA256=382c342735ff29f8ba4574d88e39bca798bcbac50bff6742710ca9cd8143e7d2
    ;;
  x86_64 | amd64)
    uv_arch=x86_64
    UV_SHA256=66ad1822dd9cf96694b95c24f25bc05cff417a65351464da01682a91796d1f2b
    ;;
  *)
    echo "runner-serena: unsupported CPU $(uname -m)" >&2
    exit 1
    ;;
esac

step() { echo "==> runner-serena: $*"; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# fetch <url> <sha256> <file>: download into the scratch dir and refuse anything that does not match the pin.
fetch() {
  local url="$1" want="$2" out="$work/$3" got
  curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$out" "$url"
  got="$(sha256sum "$out" | cut -d' ' -f1)"
  if [ "$got" != "$want" ]; then
    echo "runner-serena: sha256 mismatch for $url (want $want, got $got); refusing to install" >&2
    exit 1
  fi
}

step "uv $UV_VERSION"
# Real output is "uv 0.9.28 (<build> <date>)", so match the version token, not the whole line.
case "$(uv --version 2>/dev/null || true)" in
  "uv $UV_VERSION" | "uv $UV_VERSION "*) uv_ok=1 ;;
  *) uv_ok=0 ;;
esac
if [ "$uv_ok" = 1 ]; then
  echo "already installed"
else
  uv_name="uv-$uv_arch-unknown-linux-gnu"
  fetch "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/$uv_name.tar.gz" "$UV_SHA256" uv.tgz
  mkdir -p "$BIN" "$work/uv"
  tar -xzf "$work/uv.tgz" -C "$work/uv" --no-same-owner --strip-components=1 "$uv_name/uv" "$uv_name/uvx"
  install -m 0755 "$work/uv/uv" "$work/uv/uvx" "$BIN/"
fi

step "serena-agent $SERENA_VERSION"
# `uv tool list` prints "serena-agent v2.1.0" (exact line match; `serena --version` prints "Serena 2.1.0").
tools="$(uv tool list 2>/dev/null || true)"
if printf '%s\n' "$tools" | grep -qxF "serena-agent v$SERENA_VERSION"; then
  echo "already installed"
else
  uv tool install --python "$UV_PYTHON" "serena-agent==$SERENA_VERSION"
fi

# The agent's PATH has no ~/.local/bin in the run pod, so register the absolute path of the serena executable.
serena_bin="$(uv tool dir --bin)/serena"
step "register with Claude Code ($serena_bin, project $PWD)"
# `claude mcp get` prints "  Command: <exe>" and "  Args: <args>"; both must match, so a stale entry (bare `serena`,
# another checkout) is replaced.
registered=0
if got="$(claude mcp get serena 2>/dev/null)"; then
  if printf '%s\n' "$got" | grep -qxF "  Command: $serena_bin" &&
    printf '%s\n' "$got" | grep -qxF "  Args: start-mcp-server --context claude-code --agent-interface tools --project $PWD"; then
    echo "already registered"
    registered=1
  else
    # May fail (entry lives in another scope, or is already gone); add below reports any real problem.
    claude mcp remove --scope local serena || echo "runner-serena: could not remove the old registration; adding anyway" >&2
  fi
fi
if [ "$registered" = 0 ]; then
  if ! claude mcp add --scope local serena -- "$serena_bin" start-mcp-server --context claude-code --agent-interface tools --project "$PWD"; then
    echo "runner-serena: claude mcp add failed; Serena is installed but not registered (run it by hand)" >&2
    exit 1
  fi
fi

step "keep .serena/ out of git"
if exclude="$(git rev-parse --git-path info/exclude 2>/dev/null)"; then
  mkdir -p "$(dirname "$exclude")"
  grep -qxF '.serena/' "$exclude" 2>/dev/null || echo '.serena/' >>"$exclude"
fi
step "ready"
