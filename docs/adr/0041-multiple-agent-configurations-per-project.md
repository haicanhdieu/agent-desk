# 0041. A project holds several named agent configurations

- Status: Accepted
- Date: 2026-11-25
- Source: [Multiple agent configurations design](../superpowers/specs/2026-11-24-multi-agent-configs-design.md); [plan](../superpowers/plans/2026-11-25-multi-agent-configs.md) Task 6; issue #277

## Context

A project had exactly one agent row (Claude Code), so every rule ran the same configuration and a person without a Claude credential could not finish setup. Admins need several configurations per project (different providers, accounts and models), a rule that can pick one, and run history that stays readable after a configuration is renamed or deleted. [0026](0026-agent-adapters-for-models-and-endpoint.md) already defines the model list, model and API address per adapter.

## Decision

A project keeps many named agent configurations, exactly one of them the default. Specifics:

- **Named configurations.** Each agent has a `name` (unique per project, case-insensitive, index `agents_project_name_lower_key`) and an optional account label. `provider` is immutable after create.
- **One default.** `agents.is_default` with a partial unique index `agents_project_default_key` on `(project_id) where is_default` allows at most one default; the service guarantees at least one. Set-default moves the flag under a project row lock and affects new runs only.
- **Rules.** A rule's `agent_id` may be null and then follows the project default at queue time; intake freezes the resolved agent, name and model on the run.
- **Project-wide limits.** The five run-lifecycle limits (run time limit, keep paused, keep finished, end idle, automatic resumes) move from the agent row to the `projects` row and apply to every agent. `maxTurns` stays per agent. The old agent columns stay, unread, until a follow-up drops them (issue #287).
- **Delete safeguards.** A delete is refused (409) when it is the project's only agent, when it is the default and another agent exists, when a rule names it, or when a run that is not final, or is paused, or whose session is kept uses it. Otherwise the row and its Secret are removed; history runs keep `agent_id = NULL`.
- **Project creation and wizard.** A new project is seeded with a placeholder default agent named "Claude" (Claude Code, no credential), so a project always has an agent. The wizard's Agent step preselects nothing; the person picks a provider and the step creates the new agent, makes it default and removes the placeholder, so no one needs a Claude credential to finish setup.
- **`agent_name` snapshot.** `runs.agent_name` is written once at intake and never updated; the displayed name is `coalesce(agents.name, runs.agent_name, '(deleted agent)')`.
- **Runnable kinds.** `AgentKind` is `claude`, `codex` and `opencode`, each with an adapter, a capability row and a runner. Compat routes `GET` and `PUT /api/projects/:id/agent` act on the default agent and the project limits.
- **Capability flags.** The capability table gains `credentialOptional` (OpenCode runs with no credential), `modelOptional` (OpenCode may have an empty model) and `baseUrl.requiredFor` (credential types that need an address; OpenCode `api_key` requires one and `auth_json` refuses one). `CredentialType` gains `auth_json`.
- **Coming soon.** Ten providers are listed with logo and name but cannot be saved or run (422 on `/provider`): Gemini CLI, GitHub Copilot CLI, Cursor, Amp, Aider, Cline, Goose, Qwen Code, Kiro and Google Antigravity. They are not `AgentKind` values.
- **Unchanged.** ADR 0026's rule that an address change replaces the credential stays as is. [0036](0036-rbac-permissions-roles-scope.md) is unchanged: no new permission or role; the new routes use `agent:read` and `agent:update` at project level.

## Alternatives considered

| Alternative                                                      | Why rejected                                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Keep one agent per project and add providers by switching it     | A rule could not pick a configuration and history would lose which one ran.                        |
| Make Antigravity a runnable kind                                 | The human chose OpenCode instead; Antigravity stays Coming soon and its CLI approval is withdrawn. |
| Enforce "exactly one default" with a deferred constraint trigger | The partial unique index plus service checks are enough; no trigger.                               |

## Consequences

### Positive

- A project can run Claude Code, Codex and OpenCode side by side, and a rule can pick any of them or follow the default.
- Run history keeps the agent name after a rename or delete.
- Setup no longer requires a Claude credential.

### Negative

- Limits no longer differ per agent.
- The old run-limit columns stay on `agents` until the follow-up.
- Each new provider needs an adapter, a runner path and a pinned CLI in the runner image.

## Links

- [Design](../superpowers/specs/2026-11-24-multi-agent-configs-design.md)
- Related ADRs: [0021](0021-run-time-limit-7-days-with-token-refresh.md), [0022](0022-pause-and-resume-runs-on-a-per-run-volume.md), [0026](0026-agent-adapters-for-models-and-endpoint.md), [0036](0036-rbac-permissions-roles-scope.md)
