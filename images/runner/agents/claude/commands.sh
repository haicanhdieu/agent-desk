# Sourced by entrypoint.sh. Each value is the tmux command; $PROMPT is expanded by the shell tmux starts.
AGENT_START_CMD='exec claude --permission-mode bypassPermissions "$PROMPT"'
AGENT_RESUME_CMD='exec claude --permission-mode bypassPermissions --continue'
