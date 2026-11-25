# Sourced by entrypoint.sh. Each value is the tmux command; $PROMPT, $AGENT_MODEL, $RESUME_NOTE and $PWD are expanded by
# the shell tmux starts, as quoted values (the model is joined to its flag as one `--model=<id>` element, so a model with
# spaces, quotes, shell metacharacters or a leading dash stays one argv element; an empty model adds no --model).
# The pod is the sandbox, so the CLI's own approvals and sandbox are off (like Claude's bypassPermissions). The credential
# store is the file $CODEX_HOME/auth.json on the per-run volume (the keyring is not available in the pod). Status hooks are
# managed hooks (/etc/codex/requirements.toml, see managed-config.toml), so no trust-bypass flag is used. The repo
# directory is pre-trusted so the TUI does not stop at its trust prompt, which no hook reports. Codex has no API address
# field: AGENT_ENDPOINT_URL stays empty and the launch line prints `endpoint default`.
AGENT_START_CMD='exec codex --dangerously-bypass-approvals-and-sandbox -c "cli_auth_credentials_store=\"file\"" -c "projects.\"$PWD\".trust_level=\"trusted\"" ${AGENT_MODEL:+"--model=$AGENT_MODEL"} -- "$PROMPT"'
# Spike (spike.json, resume): `codex resume --last` reopens the newest session saved on the run volume.
AGENT_RESUME_CMD='exec codex resume --last --dangerously-bypass-approvals-and-sandbox -c "cli_auth_credentials_store=\"file\"" -c "projects.\"$PWD\".trust_level=\"trusted\"" ${AGENT_MODEL:+"--model=$AGENT_MODEL"} ${RESUME_NOTE:+-- "$RESUME_NOTE"}'
AGENT_ENDPOINT_URL=''
