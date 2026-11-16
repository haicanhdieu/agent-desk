#!/bin/bash
# Runner entrypoint (control-plane spec §8). Env: REPO_CLONE_URL (holds a token), GH_TOKEN (same token, set by the
# provider adapter so `gh` works), CHECKOUT_REF, PROMPT, BOT_NAME, BOT_EMAIL, PLUGIN_MARKETPLACES (JSON
# {store: source}, optional), SETUP_SCRIPT (optional), SETUP_TIMEOUT_SECONDS (digits, else 600), RUN_MODE (`setup_test`
# opens an idle shell instead of the agent; `resume` continues a saved session on the run volume), AGENT (fixed list,
# default claude), and CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY. AGENTDESK_REPO_DIR, AGENTDESK_LIB_DIR and
# AGENTDESK_HOME_SKEL are test seams. Untrusted values are only ever expanded as quoted values, never evaluated.
# No `set -x`: the clone URL is a secret.
set -euo pipefail

REPO_DIR="${AGENTDESK_REPO_DIR:-/workspace/repo}"
LIB_DIR="${AGENTDESK_LIB_DIR:-/usr/local/lib/agentdesk}"
HOME_SKEL="${AGENTDESK_HOME_SKEL:-/usr/local/share/agentdesk/home-skel}"

# HOME may be on the per-run volume (empty on the first start): create it and fill in the baked files without
# overwriting anything already there (a resumed run keeps its own settings and conversation).
mkdir -p "$HOME"
if [ -d "$HOME_SKEL" ]; then
  cp -R -n "$HOME_SKEL/." "$HOME/" || true
fi

# The agent name picks a command file from a fixed list; the value is never used as a path.
case "${AGENT:-claude}" in
  claude) AGENT_DIR=claude ;;
  *)
    echo 'agentdesk: unsupported agent' >&2
    exit 2
    ;;
esac
# shellcheck source=/dev/null
. "$LIB_DIR/agents/$AGENT_DIR/commands.sh"

# A rotating workspace token lives in a mounted file (AGENTDESK_TOKEN_FILE). git reads it through the credential helper
# on every call; the `gh` wrapper on PATH does the same. Without the file, REPO_CLONE_URL / GH_TOKEN carry the token.
if [ -n "${AGENTDESK_TOKEN_FILE:-}" ]; then
  git config --global credential.helper "$LIB_DIR/git-credential-agentdesk"
fi

if [ "${RUN_MODE:-}" = resume ]; then
  # Resume: the volume holds the repo, home and conversation. No clone, checkout, plugins or setup.
  if [ ! -f "$HOME/.agentdesk/session-started" ] || [ ! -d "$REPO_DIR/.git" ]; then
    echo 'agentdesk: resume failed (no saved session)'
    exit 79
  fi
  cd "$REPO_DIR"
  echo 'agentdesk: session resumed'
else
# Fresh start (not reindented to keep the diff small): clone, checkout, plugins, setup.
git clone --quiet -- "$REPO_CLONE_URL" "$REPO_DIR" 2>&1 | sed 's#://[^@/]*@#://***@#g' >&2
cd "$REPO_DIR"
git config user.name "${BOT_NAME:-agentdesk}"
git config user.email "${BOT_EMAIL:-agentdesk@users.noreply.github.com}"
if [ -n "${CHECKOUT_REF:-}" ]; then
  git fetch --quiet origin -- "$CHECKOUT_REF"
  git checkout --quiet --detach FETCH_HEAD
fi
echo "agentdesk: checkout $(git rev-parse HEAD)"

# Skip Claude Code's first-run onboarding and folder-trust prompts. (`claude plugin ...` with stdin closed needs no
# further pre-accept keys on the pinned version; see ADR 0019.)
cat > "$HOME/.claude.json" <<JSON
{"hasCompletedOnboarding": true, "projects": {"$REPO_DIR": {"hasTrustDialogAccepted": true}}}
JSON

# Plugins phase (workspace-setup spec 5.1). The repo's enabledPlugins is untrusted: select-plugins.mjs validates it
# and prints strict tab-separated lines. Values reach the claude CLI only as separate argv elements, and a failure
# only warns. Plugin output is prefixed with "plugin| " (read line by line, so a partial last line cannot join a
# marker line).
# prefix_lines PREFIX: copies stdin to stdout line by line (a final line without a newline is kept, CR is stripped),
# each line starting with PREFIX, so piped command output cannot form a marker line. (A process that writes to
# /proc/1/fd/1 directly bypasses the prefix; the worker takes the last result marker, not the first.)
prefix_lines() {
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    printf '%s%s\n' "$1" "${line//$'\r'/}"
  done
}

run_plugin_cmd() {
  local rc
  set +e
  timeout 120 "$@" </dev/null 2>&1 | prefix_lines 'plugin| '
  rc="${PIPESTATUS[0]}"
  set -e
  return "$rc"
}

echo 'agentdesk: plugins begin'
selection="$(node "$LIB_DIR/select-plugins.mjs" "$REPO_DIR/.claude/settings.json" 2>/dev/null || true)"
registered=$'\n'
failed_stores=$'\n'
while IFS=$'\t' read -r kind plugin store source extra; do
  case "$kind" in
    skip)
      if [ -n "$plugin" ] && [ -z "${store:-}" ]; then
        echo "agentdesk: plugin skipped $plugin (store not approved)"
      fi
      ;;
    install)
      if [ -z "$plugin" ] || [ -z "${store:-}" ] || [ -z "${source:-}" ] || [ -n "${extra:-}" ]; then continue; fi
      id="$plugin@$store"
      if [[ "$registered" != *$'\n'"$store"$'\n'* ]]; then
        registered+="$store"$'\n'
        # A store built in to the CLI (source "builtin", e.g. anthropic-plugin-directory) has nothing to register.
        if [ "$source" != 'builtin' ] && ! run_plugin_cmd claude plugin marketplace add "$source"; then
          failed_stores+="$store"$'\n'
        fi
      fi
      if [[ "$failed_stores" == *$'\n'"$store"$'\n'* ]]; then
        echo "agentdesk: plugin failed $id"
      elif run_plugin_cmd claude plugin install "$id"; then
        echo "agentdesk: plugin installed $id"
      else
        echo "agentdesk: plugin failed $id"
      fi
      ;;
  esac
done <<< "$selection"
echo 'agentdesk: plugins end'

# Setup phase (workspace-setup spec 5.1). SETUP_SCRIPT is untrusted text: it is only written to a file with printf '%s'
# and run as `bash <file>`; the entrypoint never evals, sources or interpolates it. Output is prefixed "setup| ".
setup_failed=0
case "${SETUP_TIMEOUT_SECONDS:-}" in
  '' | *[!0-9]* | 0*) SETUP_TIMEOUT_SECONDS=600 ;;
esac
if [ -n "${SETUP_SCRIPT:-}" ]; then
  echo 'agentdesk: setup begin'
  setup_file="$(mktemp)"
  printf '%s' "$SETUP_SCRIPT" > "$setup_file"
  set +e
  setup_started=$SECONDS
  # `set -m` makes the script's `timeout` a process-group leader, so once it returns (script done, timed out or
  # killed) whatever the script left running (`server &`) is killed with the group. That closes the pipe, so the
  # prefix filter sees EOF and the whole phase is bounded by the timeout plus the 10 s kill grace.
  (
    cd "$REPO_DIR" || exit 1
    set -m
    timeout -k 10 "$SETUP_TIMEOUT_SECONDS" bash "$setup_file" </dev/null &
    setup_job=$!
    wait "$setup_job"
    rc=$?
    kill -KILL -- "-$setup_job" 2>/dev/null
    exit "$rc"
  ) </dev/null 2>&1 | prefix_lines 'setup| '
  setup_rc="${PIPESTATUS[0]}"
  # timeout exits 137 when it had to SIGKILL a script that ignored SIGTERM after the limit.
  if [ "$setup_rc" = 137 ] && [ $((SECONDS - setup_started)) -ge "$SETUP_TIMEOUT_SECONDS" ]; then setup_rc=124; fi
  set -e
  rm -f "$setup_file"
  if [ "$setup_rc" = 0 ]; then
    echo 'agentdesk: setup passed'
  elif [ "$setup_rc" = 124 ]; then
    echo 'agentdesk: setup timed out'
    setup_failed=1
  else
    echo "agentdesk: setup failed exit=$setup_rc"
    setup_failed=1
  fi
else
  echo 'agentdesk: setup skipped (no script)'
fi
# The script must not reach the agent or the terminal shell through the environment.
unset SETUP_SCRIPT

if [ "$setup_failed" = 1 ] && [ "${RUN_MODE:-}" != setup_test ]; then
  exit 78
fi

fi

if [ "${RUN_MODE:-}" = setup_test ]; then
  session_cmd='exec bash -l'
elif [ "${RUN_MODE:-}" = resume ]; then
  session_cmd="$AGENT_RESUME_CMD"
else
  session_cmd="$AGENT_START_CMD"
fi

# remain-on-exit keeps the dead pane so its exit status and scrollback can be read. It is set before new-session (same
# tmux invocation, after start-server) so a command that dies at once still leaves its pane and output behind.
tmux start-server \; set-option -g remain-on-exit on \; \
  new-session -d -s agent -x 200 -y 50 -c "$REPO_DIR" "$session_cmd"
# bash as PID 1 ignores SIGTERM without a trap; the flag is checked by the loop below.
end_reason=''
trap 'end_reason=signal' TERM
if [ "${RUN_MODE:-}" != resume ] && [ "${RUN_MODE:-}" != setup_test ]; then
  mkdir -p "$HOME/.agentdesk"
  : > "$HOME/.agentdesk/session-started"
fi
echo 'agentdesk: session started'

# The entrypoint owns the end of the pod: it saves the scrollback, kills the tmux server (so stale attach clients cannot
# hold it up), prints one end line and exits. end_session REASON CODE
end_session() {
  echo 'agentdesk: final scrollback begin'
  timeout 5 tmux capture-pane -J -p -S - -t '=agent:' 2>/dev/null || true
  echo 'agentdesk: final scrollback end'
  tmux kill-server 2>/dev/null || true
  echo "agentdesk: session ended reason=$1 code=$2"
  exit "$2"
}

# `sleep & wait` lets the TERM trap fire at once. Order: trap flag, session gone, agent pane dead.
while :; do
  sleep 1 &
  wait $! || true
  if [ "$end_reason" = signal ]; then end_session signal 0; fi
  if ! tmux has-session -t '=agent' 2>/dev/null; then end_session session_gone 0; fi
  if [ "$(tmux display-message -p -t '=agent:' '#{pane_dead}' 2>/dev/null || true)" = 1 ]; then
    status="$(tmux display-message -p -t '=agent:' '#{pane_dead_status}' 2>/dev/null || true)"
    case "$status" in
      '' | *[!0-9]*) status=1 ;;
    esac
    end_session agent_exit "$((10#$status % 256))"
  fi
done
