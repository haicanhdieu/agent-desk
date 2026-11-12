# 0005. Provider-agnostic naming with adapter seams

- Status: Accepted
- Date: 2026-11-12
- Source: control plane design §1, §2 (Naming), §4.1, §5; Architecture (PoC) §1 principle "Seams, not abstractions", §9; backend local plan Global Constraints

## Context

The PoC integrates only GitHub (sign-in, code host, board) and only Claude Code.
The Architecture doc already kept two seams, `BoardAdapter` and `AgentRunner`,
each with one implementation, and named tables after GitHub
(`webhook_deliveries`, `repo_full_name`, `installation_id`). The control plane
design widened the roadmap: any identity provider, and GitLab, Bitbucket and
Jira later, where tickets and code may live in different systems.

## Decision

- Nothing in table, column, route, module or file names is named after a
  provider; `github_*` names are forbidden.
- Generic `connections` (one row per connected provider account, with
  `capabilities {code, board}`), `repo_path` that fits GitHub, GitLab and
  Bitbucket forms, text `ticket_ref` and `external_id`, `inbound_events` with a
  `provider` column, and `POST /webhooks/{provider}`.
- Two code-side seams with a registry keyed by `provider`: `BoardAdapter`
  (verify/parse webhook, poll, get ticket, comment) and `CodeHostAdapter`
  (install, workspace token, clone URL and checkout ref, skills CRUD).
- GitHub specifics (HMAC header, delivery id, installation tokens,
  `refs/pull/N/head`, ETag polling) live only in the `github` adapters.
- The PoC registers `github`; tests and local dev register `fake`.

## Alternatives considered

| Alternative                                                 | Why rejected                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------------- |
| `github_*` tables and names (the Architecture doc's schema) | GitLab, Bitbucket and Jira are planned; renaming later is a migration |
| Unified ticket model up front (Architecture §9)             | Set aside; only seams, not abstractions, until a second board exists  |
| Generic CLI plugin system for agents (Architecture §9)      | Set aside; `AgentRunner`-style seam with Claude only                  |

## Consequences

### Positive

- Adding a provider is a new adapter registration, not a schema rename.
- A `fake` provider makes every flow testable without GitHub credentials.
- Board and code host can be different connections (Jira board, GitHub code).

### Negative

- Indirection for a single real provider in the PoC.
- Adapter interfaces may need reshaping when a second provider shows what is
  actually common.

## Links

- [Control plane design](../superpowers/specs/2026-11-12-control-plane-design.md) §1, §2, §4.1, §5
- [Architecture (PoC)](<../Agent Desk — Architecture (PoC).md>) §1, §3, §9
- [Backend local plan](../superpowers/plans/2026-11-12-backend-local.md) Global Constraints
- Related: [0013](0013-webhook-and-polling-intake.md)
