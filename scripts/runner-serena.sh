#!/usr/bin/env bash
# Opt-in Serena (semantic code tools) for the Agent Desk runner pod. Called by scripts/runner-setup.sh with
# cwd = repo root; does nothing unless RUNNER_ENABLE_SERENA=1 (unset or 0 = off). Installs land under $HOME; in the
# repo it writes only Serena's Claude Code hooks (.claude/settings.local.json) and the .serena/ git exclude.
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
SERENA_LANGUAGE=typescript # language server for this repo; Serena finds none on its own and then every symbol query is empty
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

step "language server ($SERENA_LANGUAGE, .serena/project.yml)"
# Without a language server `find_symbol` and friends return [] and the agent falls back to grep. Serena writes
# `language_servers: []` when it starts on an unconfigured project, so fix that case too.
project_yml="$PWD/.serena/project.yml"
if [ ! -f "$project_yml" ]; then
  "$serena_bin" project create "$PWD" --language "$SERENA_LANGUAGE"
elif grep -qx 'language_servers: \[\]' "$project_yml"; then
  node - "$project_yml" "$SERENA_LANGUAGE" <<'JS'
const fs = require('node:fs');
const [file, language] = process.argv.slice(2);
const text = fs.readFileSync(file, 'utf8');
fs.writeFileSync(file, text.replace(/^language_servers: \[\]$/m, `language_servers: [${language}]`));
JS
else
  echo "already configured"
fi

step "hooks (.claude/settings.local.json)"
# Absolute path for the same reason as above; Claude Code runs each hook command through a shell, so it is quoted.
hooks_bin="$(uv tool dir --bin)/serena-hooks"
if [ ! -x "$hooks_bin" ]; then
  echo "runner-serena: serena-hooks not found at $hooks_bin" >&2
  echo "runner-serena: A plain rerun does not repair it. Reinstall with \`uv tool install --reinstall --python $UV_PYTHON serena-agent==$SERENA_VERSION\`, or bump the pin" >&2
  exit 1
fi
node - "$PWD/.claude/settings.local.json" "$hooks_bin" <<'JS'
const fs = require('node:fs');
const path = require('node:path');
const [file, bin] = process.argv.slice(2);
const wanted = [
  ['PreToolUse', '', 'remind'],
  ['PreToolUse', 'mcp__serena__*', 'auto-approve'],
  ['SessionStart', '', 'activate'],
  ['SessionEnd', '', 'cleanup'],
];
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const fail = (reason) => {
  console.error(`runner-serena: .claude/settings.local.json is not valid, left unchanged: ${reason}`);
  process.exit(1);
};

const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
let settings = {};
try {
  if (text.trim() !== '') settings = JSON.parse(text);
} catch (e) {
  fail(e.message);
}
if (!isObject(settings)) fail('the top level is not an object');
const hooks = settings.hooks === undefined ? {} : settings.hooks;
if (!isObject(hooks)) fail('"hooks" is not an object');
for (const [event] of wanted) {
  if (hooks[event] !== undefined && !Array.isArray(hooks[event])) fail(`"hooks.${event}" is not an array`);
}

const quoted = `'${bin.replaceAll("'", `'\\''`)}'`;
for (const [event, matcher, name] of wanted) {
  // An earlier entry for this hook, at this or an older path.
  const ours = (h) =>
    typeof h?.command === 'string' &&
    h.command.includes('serena-hooks') &&
    h.command.endsWith(` ${name} --client=claude-code`);
  const groups = (hooks[event] ?? []).flatMap((group) => {
    if (!Array.isArray(group?.hooks)) return [group];
    const kept = group.hooks.filter((h) => !ours(h));
    if (kept.length === group.hooks.length) return [group];
    return kept.length === 0 ? [] : [{ ...group, hooks: kept }];
  });
  groups.push({ matcher, hooks: [{ type: 'command', command: `${quoted} ${name} --client=claude-code` }] });
  hooks[event] = groups;
}
settings.hooks = hooks;

fs.mkdirSync(path.dirname(file), { recursive: true });
const tmp = `${file}.${process.pid}.tmp`;
fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`);
fs.renameSync(tmp, file);
JS

step "keep .serena/ out of git"
if exclude="$(git rev-parse --git-path info/exclude 2>/dev/null)"; then
  mkdir -p "$(dirname "$exclude")"
  grep -qxF '.serena/' "$exclude" 2>/dev/null || echo '.serena/' >>"$exclude"
fi
step "ready"
