# 0019. Repo setup script and plugins from approved stores only

- Status: Accepted
- Date: 2026-11-13
- Source: [workspace setup and plugins design](../superpowers/specs/2026-11-13-workspace-setup-and-plugins-design.md) §3 (decisions 1, 2, 7, 8), §5.1

## Context

A run pod starts the agent with nothing but the cloned repo. A repo can enable Claude Code plugins in
`.claude/settings.json`, but nothing registers the marketplace or installs them, and a repo may need a one-off
preparation step (dependencies, tooling) before the agent starts. Repo text is untrusted (AGENTS rule 6), runs are
unattended (a prompt would hang the Job), and the same pod env already carries the clone token and the agent
credential.

## Decision

The runner entrypoint gets phases after checkout and before the agent: plugins, then a setup
script stored by Agent Desk. This ADR records the whole decision; the entrypoint implements both phases.

- **Plugins install only from approved stores.** The worker passes env `PLUGIN_MARKETPLACES` (JSON
  `{"<name>": "<source>"}`, from platform config). Approval is by marketplace name, but the pod always registers an
  approved name from the configured source, never from a source the repo supplies, and ignores the repo's
  `extraKnownMarketplaces`. Plugins from other stores are skipped.
- `select-plugins.mjs` (plain Node, in the image) reads the repo settings as JSON only. Ids must match a strict slug
  regex; a configured source containing a control character (tab, newline, CR, NUL) is dropped. The entrypoint parses
  its tab-separated output strictly and passes every value to `claude` as a separate argv element, under
  `timeout 120` and `</dev/null`. Nothing is evaluated or interpolated into a shell string.
- A plugin or marketplace failure prints a warning marker and the run continues (decision 7). Plugin command output is
  emitted with line prefix `plugin| ` so it can never form a protocol marker.
- **Decision 8: credentials visible to setup are accepted.** The setup script runs with the pod's existing env (clone
  token, provider `runEnv`, agent credential). Only users allowed to edit a project's setup can change the script,
  and they can already attach to run terminals where the same credentials are visible, so setup adds no new
  exposure. Test pods still get no agent credential. Hiding credentials from setup and the agent is follow-up F6.

### CLI spike (pinned `CLAUDE_CODE_VERSION=2.1.323`, image `agentdesk-runner:dev`, run as uid 10001)

Commands, each with stdin closed under `timeout 120`:

```
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin install superpowers@claude-plugins-official
```

Results:

- Both exit 0 with `</dev/null`. No interactive prompt appears. No `~/.claude.json` or `settings.json` key beyond the
  existing onboarding/trust keys is needed; the CLI records the marketplace in `~/.claude/settings.json`
  (`extraKnownMarketplaces`) and `~/.claude/plugins/known_marketplaces.json` itself.
- **Names.** Source `anthropics/claude-plugins-official` registers as `claude-plugins-official`. Source
  `anthropics/claude-code` registers as `claude-code-plugins`.
- `anthropic-plugin-directory` is **built in** to the CLI (`claude plugin marketplace list` shows "Built in
  (Anthropic Directory)" before anything is added). No source registers under that name, so it cannot be approved
  through `PLUGIN_MARKETPLACES` and is dropped from the default config. `claude plugin install
superpowers@anthropic-plugin-directory` works without any `marketplace add`; it is the same plugin as
  `superpowers@claude-plugins-official`, and installing the second after the first answers "already installed" with
  exit 0.
- Default `RUN_PLUGIN_MARKETPLACES`: `{"claude-plugins-official":"anthropics/claude-plugins-official"}`. Consequence:
  this repo's own `.claude/settings.json` (which uses `superpowers@anthropic-plugin-directory`) shows that plugin as
  skipped until the repo switches to the `claude-plugins-official` id or a follow-up supports approving built-in
  store names without a source.

## Alternatives considered

The source spec (§4) records these.

| Alternative                                      | Why rejected                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Auto-install from any marketplace the repo names | Repo text is untrusted; a repo could make the pod fetch and run arbitrary code from any source    |
| Init container for preparation                   | A failed init container leaves nothing to attach a terminal to; HOME/plugins need a shared volume |
| Pre-built per-project image                      | The custom-image path (image builds, storage, rebuild triggers); possible later optimisation      |

## Consequences

### Positive

- Repos get their plugins without a prompt that hangs an unattended run; a repo cannot impersonate an approved store.
- Failures never block the agent; the entrypoint's markers show which plugin loaded, was skipped or failed.

### Negative

- Pod egress must reach the marketplace sources (GitHub) and package registries, so a future egress allowlist needs them.
- Plugin install adds startup time (a clone per approved store in use) on every run.
- Setup runs with the pod's credentials (decision 8), accepted until F6.
- Built-in store names cannot be approved today (see above).

## Links

- [Workspace setup and plugins design](../superpowers/specs/2026-11-13-workspace-setup-and-plugins-design.md) §5.1
- [Control-plane design](../superpowers/specs/2026-11-12-control-plane-design.md) §8 (runner contract)
- Related ADRs: [0010](0010-one-kubernetes-job-per-run.md), [0012](0012-credentials-in-kubernetes-secrets.md)
