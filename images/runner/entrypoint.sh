#!/bin/bash
# Runner entrypoint (control-plane spec §8). Env: REPO_CLONE_URL (holds a token), GH_TOKEN (same token, set by the
# provider adapter so `gh` works), CHECKOUT_REF, PROMPT, BOT_NAME, BOT_EMAIL, PLUGIN_MARKETPLACES (JSON
# {store: source}, optional), SETUP_SCRIPT (optional), SETUP_TIMEOUT_SECONDS (digits, else 600), RUN_MODE (`setup_test`
# opens an idle shell instead of the agent; `resume` continues a saved session on the run volume), AGENT (fixed list,
# default claude), AGENT_MODEL (optional, passed to the agent as --model), ANTHROPIC_BASE_URL (optional custom API
# address, only its origin is printed), and CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY. AGENTDESK_REPO_DIR, AGENTDESK_LIB_DIR,
# AGENTDESK_HOME_SKEL and AGENTDESK_RUN_DIR (default /run/agentdesk, the in-memory volume that holds the `stop` and
# `agent-exit` files) are test seams. Untrusted values are only ever expanded as quoted values, never evaluated.
# No `set -x`: the clone URL is a secret.
set -euo pipefail

REPO_DIR="${AGENTDESK_REPO_DIR:-/workspace/repo}"
LIB_DIR="${AGENTDESK_LIB_DIR:-/usr/local/lib/agentdesk}"
HOME_SKEL="${AGENTDESK_HOME_SKEL:-/usr/local/share/agentdesk/home-skel}"
RUN_DIR="${AGENTDESK_RUN_DIR:-/run/agentdesk}"

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

# Git identity of the repo (run in the repo dir; fresh and resumed pods both call it, so a volume first started under an
# older config is corrected on resume). The run's commits are authored and committed by the person who triggered the run
# (RUN_AUTHOR_NAME / RUN_AUTHOR_EMAIL, plain values chosen by the worker); without both, the bot as before. The bot
# reaches the commits as a Co-Authored-By trailer through a prepare-commit-msg hook copied into the repo's own hooks
# dir (core.hooksPath is not touched, so the repo's other hooks keep running; a repo that sets its own core.hooksPath,
# for example husky, runs its hooks and skips the trailer, while author and committer stay right). A prepare-commit-msg
# the repo shipped is kept as prepare-commit-msg.repo and run by ours. Values are only ever passed as quoted argv elements.
install_commit_hook() {
  local src="$LIB_DIR/hooks/prepare-commit-msg" dest=.git/hooks/prepare-commit-msg
  mkdir -p .git/hooks
  # Our own copy (an older one on a surviving volume) is replaced; any other file is the repo's and is kept.
  if [ -e "$dest" ] && ! grep -q '^# agentdesk-commit-trailer-hook' "$dest" && [ ! -e "$dest.repo" ]; then
    mv "$dest" "$dest.repo"
  fi
  cp "$src" "$dest"
  chmod 0755 "$dest"
}

apply_git_identity() {
  local name email
  name="${RUN_AUTHOR_NAME:-}"
  email="${RUN_AUTHOR_EMAIL:-}"
  if [ -z "$name" ] || [ -z "$email" ]; then
    name="${BOT_NAME:-agentdesk}"
    email="${BOT_EMAIL:-agentdesk@users.noreply.github.com}"
  fi
  git config user.name "$name"
  git config user.email "$email"
  install_commit_hook
  echo "agentdesk: git identity $name $email"
}

if [ "${RUN_MODE:-}" = resume ]; then
  # Resume: the volume holds the repo, home and conversation. No clone, checkout, plugins or setup.
  if [ ! -f "$HOME/.agentdesk/session-started" ] || [ ! -d "$REPO_DIR/.git" ]; then
    echo 'agentdesk: resume failed (no saved session)'
    exit 79
  fi
  cd "$REPO_DIR"
  apply_git_identity
  echo 'agentdesk: session resumed'
else
# Fresh start (not reindented to keep the diff small): clone, checkout, plugins, setup.
git clone --quiet -- "$REPO_CLONE_URL" "$REPO_DIR" 2>&1 | sed 's#://[^@/]*@#://***@#g' >&2
cd "$REPO_DIR"
apply_git_identity
if [ -n "${CHECKOUT_REF:-}" ]; then
  git fetch --quiet origin -- "$CHECKOUT_REF"
  git checkout --quiet --detach FETCH_HEAD
fi
echo "agentdesk: checkout $(git rev-parse HEAD)"

# Skip Claude Code's first-run onboarding and folder-trust prompts. (`claude plugin ...` with stdin closed needs no
# further pre-accept keys on the pinned version; see ADR 0019.)
# A custom ANTHROPIC_API_KEY makes the TUI ask "use this API key?" on every new pod (it blocks the run, and no hook
# fires for it). Claude remembers its answer as the key's last 20 characters in customApiKeyResponses.approved, so that
# suffix is pre-approved here. Only a key made of the characters real keys use is accepted, so nothing odd reaches the JSON.
api_key_approved=''
api_key="${ANTHROPIC_API_KEY:-}"
if [ -n "$api_key" ] && [[ "$api_key" =~ ^[A-Za-z0-9_-]+$ ]]; then
  api_key_approved=", \"customApiKeyResponses\": {\"approved\": [\"${api_key: -20}\"], \"rejected\": []}"
fi
unset api_key
cat > "$HOME/.claude.json" <<JSON
{"hasCompletedOnboarding": true, "projects": {"$REPO_DIR": {"hasTrustDialogAccepted": true}}$api_key_approved}
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

# One launch line per agent start (fresh and resume; not setup_test, where no agent runs): the agent, its model and the
# origin of its API address. Values are only printed with printf '%s', and only the characters of a model id and an
# address (letters, digits and . _ : / @ [ ] + -) are kept; anything else (control characters, C1 bytes, spaces) becomes
# ?, so a value cannot forge a marker line. The origin is scheme://host[:port] only: a value that does not have that
# exact shape (userinfo, odd scheme, empty host) prints as default, so no credential reaches the log.
if [ "${RUN_MODE:-}" != setup_test ]; then
  launch_model="${AGENT_MODEL:-default}"
  launch_endpoint=default
  if [ -n "${AGENT_ENDPOINT_URL:-}" ] && [[ "$AGENT_ENDPOINT_URL" == *://* ]]; then
    endpoint_scheme="${AGENT_ENDPOINT_URL%%://*}"
    endpoint_rest="${AGENT_ENDPOINT_URL#*://}"
    endpoint_rest="${endpoint_rest%%[/?#]*}"
    if [[ "$endpoint_scheme" =~ ^[A-Za-z][A-Za-z0-9+.-]*$ ]] &&
      [[ "$endpoint_rest" =~ ^([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:[0-9]+)?$ ]]; then
      launch_endpoint="$endpoint_scheme://$endpoint_rest"
    fi
  fi
  printf 'agentdesk: agent %s model %s endpoint %s\n' "$AGENT_DIR" "${launch_model//[!A-Za-z0-9._:\/@+\[\]-]/?}" \
    "${launch_endpoint//[!A-Za-z0-9._:\/@+\[\]-]/?}"
fi

# remain-on-exit keeps the dead pane so its exit status and scrollback can be read. It is set before new-session (same
# tmux invocation, after start-server) so a command that dies at once still leaves its pane and output behind.
# The pane runs the command through agentdesk-session, which records the agent's exit code in $RUN_DIR/agent-exit. tmux
# gets the wrapper and the fixed command as two separate arguments (run directly, no extra shell).
tmux start-server \; set-option -g remain-on-exit on \; \
  new-session -d -s agent -x 200 -y 50 -c "$REPO_DIR" "$LIB_DIR/bin/agentdesk-session" "$session_cmd"
# bash as PID 1 ignores SIGTERM without a trap; the flag is checked by the loop below.
end_reason=''
trap 'end_reason=signal' TERM
if [ "${RUN_MODE:-}" != resume ] && [ "${RUN_MODE:-}" != setup_test ]; then
  mkdir -p "$HOME/.agentdesk"
  : > "$HOME/.agentdesk/session-started"
fi
echo 'agentdesk: session started'

# Startup check: Claude can wait on a screen no hook reports (an API-key or login prompt, a trust dialog). If no hook has
# fired within the wait, tell the control plane a person is needed. It only covers startup: the first hook of any kind
# (hook.mjs creates $RUN_DIR/hook-seen) switches it off for the pod, so a long tool call or a long think later in the
# session never triggers it. AGENTDESK_STARTUP_WAIT_SECONDS is a test seam; anything but plain digits means 300 s.
case "${AGENTDESK_STARTUP_WAIT_SECONDS:-}" in
  '' | *[!0-9]* | 0*) startup_wait=300 ;;
  *) startup_wait="$AGENTDESK_STARTUP_WAIT_SECONDS" ;;
esac
startup_checked=0
if [ "${RUN_MODE:-}" = setup_test ]; then startup_checked=1; fi
startup_began=$SECONDS

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

# Check first, then sleep, so an already-finished session ends without a 1s delay. `sleep & wait` lets the TERM trap
# wake the loop, which then sees the flag, so SIGTERM ends the loop within about 1s: a signal that lands between the flag
# check and `wait` is only seen after the 1s sleep ends, which fits well inside the pod grace
# period. Order (spec 3): stop file, agent-exit file, session gone, trap flag; then the pane-dead check stays as a
# fallback for a wrapper that could not write its file.
# The agent shares this container and can write under $RUN_DIR, so the agent-exit content is untrusted: only a regular
# file (not a link, a pipe or a directory) is read, at most 16 bytes, within 2 seconds (a pipe renamed over the file
# after the check would block the open for good, and this is PID 1), and only 1 to 3 digits count (10# keeps a leading
# zero decimal); anything else means code 1. Codes above 255 wrap like an exit status.
agent_exit_code() {
  local f="$RUN_DIR/agent-exit" content
  if [ ! -f "$f" ] || [ -L "$f" ]; then return 1; fi
  content="$(timeout 2 head -c 16 -- "$f" 2>/dev/null || true)"
  if [[ "$content" =~ ^[0-9]{1,3}$ ]]; then
    printf '%s' "$((10#$content % 256))"
  else
    printf '1'
  fi
}

while :; do
  if [ "$startup_checked" = 0 ]; then
    if [ -e "$RUN_DIR/hook-seen" ]; then
      startup_checked=1
    elif [ $((SECONDS - startup_began)) -ge "$startup_wait" ]; then
      startup_checked=1
      echo 'agentdesk: state needs_input startup -'
    fi
  fi
  if [ -e "$RUN_DIR/stop" ] || [ -L "$RUN_DIR/stop" ]; then end_session stop_request 0; fi
  if code="$(agent_exit_code)"; then end_session agent_exit "$code"; fi
  if ! tmux has-session -t '=agent' 2>/dev/null; then end_session session_gone 0; fi
  if [ "$end_reason" = signal ]; then end_session signal 0; fi
  if [ "$(tmux display-message -p -t '=agent:' '#{pane_dead}' 2>/dev/null || true)" = 1 ]; then
    status="$(tmux display-message -p -t '=agent:' '#{pane_dead_status}' 2>/dev/null || true)"
    case "$status" in
      '' | *[!0-9]*) status=1 ;;
    esac
    end_session agent_exit "$((10#$status % 256))"
  fi
  sleep 1 &
  wait $! || true
done
