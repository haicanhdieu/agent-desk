#!/bin/bash
# Runner entrypoint (control-plane spec §8). Env: REPO_CLONE_URL (holds a token), GH_TOKEN (same token, set by the
# provider adapter so `gh` works), CHECKOUT_REF, PROMPT, BOT_NAME,
# BOT_EMAIL, and CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY. Untrusted values are only ever expanded as
# quoted values, never evaluated. No `set -x`: the clone URL is a secret.
set -euo pipefail

REPO_DIR=/workspace/repo

git clone --quiet -- "$REPO_CLONE_URL" "$REPO_DIR" 2>&1 | sed 's#://[^@/]*@#://***@#g' >&2
cd "$REPO_DIR"
git config user.name "${BOT_NAME:-agentdesk}"
git config user.email "${BOT_EMAIL:-agentdesk@users.noreply.github.com}"
if [ -n "${CHECKOUT_REF:-}" ]; then
  git fetch --quiet origin -- "$CHECKOUT_REF"
  git checkout --quiet --detach FETCH_HEAD
fi

# Skip Claude Code's first-run onboarding and folder-trust prompts.
cat > "$HOME/.claude.json" <<JSON
{"hasCompletedOnboarding": true, "projects": {"$REPO_DIR": {"hasTrustDialogAccepted": true}}}
JSON

# remain-on-exit keeps the dead pane so its exit status and scrollback can be read. It is set before new-session (same
# tmux invocation, after start-server) so a command that dies at once still leaves its pane and output behind.
tmux start-server \; set-option -g remain-on-exit on \; \
  new-session -d -s agent -x 200 -y 50 -c "$REPO_DIR" 'exec claude --permission-mode bypassPermissions "$PROMPT"'
echo 'agentdesk: session started'

while [ "$(tmux display-message -p -t agent '#{pane_dead}' 2>/dev/null || echo 1)" != 1 ]; do
  sleep 1
done
status="$(tmux display-message -p -t agent '#{pane_dead_status}' 2>/dev/null || echo 0)"

echo 'agentdesk: final scrollback begin'
tmux capture-pane -J -p -S - -t agent 2>/dev/null || true
echo 'agentdesk: final scrollback end'
exit "${status:-0}"
