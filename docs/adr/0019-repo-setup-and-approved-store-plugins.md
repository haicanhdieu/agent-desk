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
- A plugin or marketplace failure prints a warning marker and the run continues (decision 7). Plugin and setup command
  output is emitted with line prefix `plugin| ` / `setup| `, so that output cannot form a protocol marker. This covers
  the commands' piped stdout and stderr only: a process that writes to the container log directly (for example
  `echo … > /proc/1/fd/1`, as the image's own hooks do, same uid) can still emit a marker. The worker therefore takes a
  setup test's result from the **last** result marker before `agentdesk: session started` (or before the log ends),
  not the first. A forged `agentdesk: session started` can still flip a run to `running` early, and a forged marker
  pair can still decide a test; the script author is trusted (decision 8), so this is a labelling issue, not an
  escalation.
- **Decision 8: credentials visible to setup are accepted.** The setup script runs with the pod's existing env (clone
  token, provider `runEnv`, agent credential). Only users allowed to edit a project's setup can change the script,
  and they can already attach to run terminals where the same credentials are visible, so setup adds no new
  exposure. Test pods get no agent credential, but they do carry the write-scoped workspace clone token (in
  `REPO_CLONE_URL`) and the adapter's `runEnv` (GitHub: `GH_TOKEN`), and the editor who starts a test gets an
  interactive shell holding them for the test's TTL (`SETUP_TEST_TTL_SECONDS`, default 15 min). Hiding credentials
  from setup and the agent is follow-up F6.

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
  (Anthropic Directory)" before anything is added). No source registers under that name, so it is approved with the
  source marker `builtin` (`{"anthropic-plugin-directory":"builtin"}`): the entrypoint skips `marketplace add` for it
  and installs directly. `claude plugin install
superpowers@anthropic-plugin-directory` works without any `marketplace add`; it is the same plugin as
  `superpowers@claude-plugins-official`, and installing the second after the first answers "already installed" with
  exit 0.
- Default `RUN_PLUGIN_MARKETPLACES`: `{"claude-plugins-official":"anthropics/claude-plugins-official","anthropic-plugin-directory":"builtin"}`.
  Both stores are Anthropic's, so repos that enable `<plugin>@anthropic-plugin-directory` (as this repo's own
  `.claude/settings.json` does) are no longer shown as blocked.

## Alternatives considered

The source spec (§4) records these.

| Alternative                                      | Why rejected                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Auto-install from any marketplace the repo names | Repo text is untrusted; a repo could make the pod fetch and run arbitrary code from any source    |
| Init container for preparation                   | A failed init container leaves nothing to attach a terminal to; HOME/plugins need a shared volume |
| Pre-built per-project image                      | The custom-image path (image builds, storage, rebuild triggers); possible later optimisation      |

## Consequences

### Positive

- Repos get their plugins without a prompt that hangs an unattended run. The entrypoint never registers a store from a
  repo-supplied source; repo-executed code (the setup script, the agent's tools) is outside this guarantee (see F6).
  How the agent session itself treats a repo's `extraKnownMarketplaces` or an `enabledPlugins` entry for a built-in
  store (`anthropic-plugin-directory`) is unverified.
- Failures never block the agent; the entrypoint's markers show which plugin loaded, was skipped or failed.

### Negative

- Pod egress must reach the marketplace sources (GitHub) and package registries, so a future egress allowlist needs them.
- Plugin install adds startup time (a clone per approved store in use) on every run.
- Setup runs with the pod's credentials (decision 8), accepted until F6.
- `builtin` trusts the CLI's own built-in store: a CLI version that changed what that store serves would change what installs.
- Setup-test pods run in the run namespace (`agentdesk-runs`) and count against its `ResourceQuota` (infra spec §6.5:
  `pods` 2, `limits.memory` 1536 Mi). An open test (kept for its TTL) can take the slot a run pod needs; that run then
  fails after the 2 min Pending limit with "no pod was created". Follow-up: a separate quota (or a separate namespace)
  for setup tests, sized for one open test per project, so tests never compete with runs.

## Links

- [Workspace setup and plugins design](../superpowers/specs/2026-11-13-workspace-setup-and-plugins-design.md) §5.1
- [Control-plane design](../superpowers/specs/2026-11-12-control-plane-design.md) §8 (runner contract)
- Related ADRs: [0010](0010-one-kubernetes-job-per-run.md), [0012](0012-credentials-in-kubernetes-secrets.md)
