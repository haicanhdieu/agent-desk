# Sourced by entrypoint.sh before the session starts; its output is discarded (no credential text can reach the log).
# Codex reads its login from $CODEX_HOME/auth.json on the per-run volume (spike.json: home, credentialEnv).
codex_home="${CODEX_HOME:-$HOME/.codex}"
if [ -n "${AGENT_CREDENTIAL_FILE-}" ]; then
  # A pasted ChatGPT-subscription auth.json is a seed: written on first start, and on a resume only when the credential
  # version changed, so a token the CLI refreshed on the volume is not overwritten by a stale seed.
  if credential_version_changed; then
    mkdir -p "$codex_home"
    chmod 0700 "$codex_home"
    write_credential_file "$codex_home/auth.json"
  fi
elif [ -n "${CODEX_API_KEY-}" ]; then
  # CODEX_API_KEY is documented for `codex exec` only (spike.json), so the interactive TUI gets the key from auth.json,
  # written by `codex login --with-api-key` (the key travels on stdin, never in argv). Once stored it is dropped from the
  # environment the agent and the terminal shell inherit. A failure ends the pod with the fixed reason.
  if ! printf '%s' "$CODEX_API_KEY" | codex -c 'cli_auth_credentials_store="file"' login --with-api-key; then
    credential_import_failed
  fi
  unset CODEX_API_KEY
fi
