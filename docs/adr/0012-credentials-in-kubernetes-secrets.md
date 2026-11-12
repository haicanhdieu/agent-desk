# 0012. Agent credentials in Kubernetes Secrets, never in Postgres

- Status: Accepted
- Date: 2026-11-11
- Source: PRD (PoC) FR-3, §6 non-functional; Architecture (PoC) §3 (`agents`), §7 Secrets; control plane design §4.1, §7.2, §9; infra design §3.3; backend local plan Global Constraints

## Context

Each agent needs a Claude credential (API key or Claude Code OAuth token) that
must reach the run container. The PRD requires storing it as a secret that is
never displayed after save, and that credentials never appear in logs, stream
events or ticket comments. Runs also need a short-lived code host token.

## Decision

- The agent credential is written by the api through a `SecretStore` to the
  Kubernetes Secret `org-{orgId}-agent-{agentId}` in the control-plane
  namespace. Postgres stores only `credential_secret_name` (plus type and
  updated-at metadata), never the value.
- `PUT /api/agents/{id}/credential` is write-only: the response is
  `{ updatedAt }`; the value is never returned or cached by the web.
- Per run, the worker copies the credential and a freshly minted one-hour
  workspace token into a per-run Secret `run-{runId}` referenced by the Job.
  The workspace token is never persisted.
- Credential values and tokens never reach Postgres, logs, API responses,
  `run_events` or `audit_log`; stored scrollback and logs are redacted as a
  backstop.
- Runtime credentials are not in Git, so Flux never prunes them. Platform
  secrets (DB, auth, GitHub App) use fixed names supplied per target (see
  [0018](0018-portable-app-layer-target-contracts.md)).

## Alternatives considered

The docs give no alternatives for where agent credentials are stored; the
Architecture doc states the choice directly ("Credential value lives in a
Kubernetes Secret, not in Postgres").

## Consequences

### Positive

- A database dump or RLS bug cannot leak agent credentials.
- `SecretStore` is a test seam (in-memory in tests).

### Negative

- The api service account needs `secrets` RBAC in `agentdesk` and
  `agentdesk-runs`.
- Known gap: the credential is readable by the agent process, so a successful
  prompt injection could exfiltrate it. PoC mitigation is a dedicated low-limit
  key; the later fix is an egress proxy that injects the credential outside the
  container.

## Links

- [PRD (PoC)](<../Agent Desk — PRD (PoC).md>) §5 FR-3, §6
- [Architecture (PoC)](<../Agent Desk — Architecture (PoC).md>) §3, §7
- [Control plane design](../superpowers/specs/2026-11-12-control-plane-design.md) §4.1, §6.2, §7.2, §7.6
- [Infra design](../superpowers/specs/2026-11-12-infra-design.md) §3.3, §6.6
- [Backend local plan](../superpowers/plans/2026-11-12-backend-local.md) Global Constraints
