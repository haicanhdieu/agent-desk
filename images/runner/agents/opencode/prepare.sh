# Sourced by entrypoint.sh before the session starts; its output is discarded (no credential text can reach the log).
# Delivers the status plugin, and the login when the run has one:
#   - no credential: nothing else (no import, no file; the CLI offers its free models).
#   - own endpoint and key: nothing to do here. The pod env already holds AGENTDESK_LLM_API_KEY and the inline provider
#     config OPENCODE_CONFIG_CONTENT (spike.json, configDelivery: the env value is read by the pinned release).
#   - credentials file (auth_json): imported with `opencode auth import` (spike.json, authImport).
opencode_config="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
mkdir -p "$opencode_config/plugins"
# OpenCode auto-loads a .js file in plugins/ (spike.json, status); copied on every start so an image update applies.
cp -f -- "$LIB_DIR/agents/opencode/hook.mjs" "$opencode_config/plugins/agentdesk-status.js"

# Preselects the run's model. The TUI has no --model flag (only `opencode run` has), but a `model` key in the user config
# file makes it start on that model (spike.json, parityNotes.perAgentModel: verified under tmux against a mock endpoint,
# the first request carried the chosen model for `agentdesk/<id>` and a native `provider/model`). The file is written by
# node from the environment as JSON.stringify output, so the model text never reaches a shell or a parser; with no model the
# file is removed (a resume may drop it) and the CLI uses its default.
model_config="$opencode_config/opencode.json"
if [ -n "${AGENT_MODEL-}" ]; then
  node -e '
    require("fs").writeFileSync(process.argv[1], JSON.stringify({ model: process.env.AGENT_MODEL }));
  ' "$model_config"
else
  rm -f -- "$model_config"
fi

# Logs out every stored credential of the integrations the file carries (spike.json, authImport.forTask11): an import of
# an id that already exists is skipped and keeps the old key, and a new id is added inactive, so a rotated credential
# only takes effect after the old ones are gone. Ids come from the CLI's own export and reach argv only when plain.
opencode_logout_stored() {
  local stored pairs integration id
  stored="$(opencode auth export --standalone)" || return 1
  pairs="$(printf '%s' "$stored" | node -e '
    const fs = require("fs");
    const parse = (text) => { try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch { return []; } };
    const ok = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
    const mine = new Set(parse(fs.readFileSync(process.argv[1], "utf8")).map((c) => c && c.integrationID));
    for (const c of parse(fs.readFileSync(0, "utf8"))) {
      if (c && mine.has(c.integrationID) && ok.test(c.integrationID) && ok.test(c.id)) console.log(c.integrationID + "\t" + c.id);
    }
  ' "$1")" || return 1
  while IFS=$'\t' read -r integration id; do
    [ -n "$integration" ] || continue
    opencode auth logout --standalone "$integration" "$id" || return 1
  done <<< "$pairs"
}

if [ -n "${AGENT_CREDENTIAL_FILE-}" ] && credential_version_changed; then
  auth_file="$RUN_DIR/opencode-auth.$$.json"
  write_credential_file "$auth_file"
  import_rc=0
  # A first start has an empty store; a resume with a new version rotates.
  if [ -f "$HOME/.agentdesk/credential-version" ]; then opencode_logout_stored "$auth_file" || import_rc=$?; fi
  if [ "$import_rc" = 0 ]; then opencode auth import --standalone "$auth_file" || import_rc=$?; fi
  # The file never outlives the import, also a failed one.
  rm -f -- "$auth_file"
  if [ "$import_rc" != 0 ]; then credential_import_failed; fi
fi
