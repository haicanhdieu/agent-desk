# Sourced by entrypoint.sh. Each value is the tmux command; $PROMPT and $RESUME_NOTE are expanded by the shell tmux
# starts, as quoted values (each is joined to its flag as one `--prompt=<value>` element, so a value with spaces, quotes,
# shell metacharacters or a leading dash stays one argv element). The TUI's flags are --prompt <text>, --continue, --session,
# --standalone, --auto (checked against `opencode --help` and run under tmux, CLI 2.4.1; `--prompt=<text>` submitted the
# text). It has NO --model flag: `opencode --model=x` exits 1 with "Unrecognized flag: --model" (--model exists only on
# `opencode run`), so the model is not passed here: prepare.sh writes it as the `model` key of the user config file
# ($XDG_CONFIG_HOME/opencode/opencode.json), which the TUI starts on.
# `opencode service set disabled true` (spike.json, service) keeps the pod to one private server instead of a background
# service; a failure is not fatal. Status comes from the plugin prepare.sh installs; sessions and credentials live in the
# CLI's database on the per-run volume.
AGENT_START_CMD='opencode service set disabled true >/dev/null 2>&1 || true; exec opencode ${PROMPT:+"--prompt=$PROMPT"}'
# Spike (spike.json, resume): the TUI reopens the newest session with --continue.
AGENT_RESUME_CMD='opencode service set disabled true >/dev/null 2>&1 || true; exec opencode --continue ${RESUME_NOTE:+"--prompt=$RESUME_NOTE"}'
AGENT_ENDPOINT_URL=''

# Prints the API address of the inline provider config (OPENCODE_CONFIG_CONTENT), or nothing. The JSON is parsed by node
# from the environment, never by the shell; the entrypoint prints only the validated origin.
agent_endpoint() {
  [ -n "${OPENCODE_CONFIG_CONTENT-}" ] || return 0
  node -e '
    try {
      const url = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT).provider.agentdesk.options.baseURL;
      if (typeof url === "string") process.stdout.write(url);
    } catch {}
  ' 2> /dev/null || true
}
