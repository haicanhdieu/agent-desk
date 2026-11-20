# Sourced by entrypoint.sh. Each value is the tmux command; $PROMPT, $AGENT_MODEL and $RESUME_NOTE are expanded by the shell tmux
# starts (as quoted values, so a model with spaces, quotes or a leading dash stays one argv element; an empty model adds
# no --model). AGENT_ENDPOINT_URL names the env holding the custom API address, for the launch line.
AGENT_START_CMD='exec claude --permission-mode bypassPermissions ${AGENT_MODEL:+--model "$AGENT_MODEL"} "$PROMPT"'
AGENT_RESUME_CMD='exec claude --permission-mode bypassPermissions ${AGENT_MODEL:+--model "$AGENT_MODEL"} --continue ${RESUME_NOTE:+"$RESUME_NOTE"}'
AGENT_ENDPOINT_URL="${ANTHROPIC_BASE_URL:-}"
