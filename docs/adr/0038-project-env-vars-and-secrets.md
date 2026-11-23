# 0038. Project environment variables and secrets are injected into workspace pods

- Status: Accepted
- Date: 2026-11-23
- Source: [Workspace environment variables and secrets design](../superpowers/specs/2026-11-23-workspace-env-secrets-design.md) (Architecture, Other decisions; Lifecycle, compatibility and side effects; Edge cases); [plan](../superpowers/plans/2026-11-23-workspace-env-secrets.md) Task 5; GitHub issue #176

## Context

[ADR-0019](0019-repo-setup-and-approved-store-plugins.md) shipped repo setup with no secrets or env vars for setup or the agent (follow-up F2), so private registries and tools that need a token fail. [ADR-0012](0012-credentials-in-kubernetes-secrets.md) keeps credentials in Kubernetes Secrets and out of Postgres. Project admins now need to configure plain variables and secrets that the setup script and the agent can read. Decision 8 of ADR-0019 already accepts that setup sees the pod's credentials, and that anyone who can attach to a run terminal can read them.

## Decision

Project admins configure environment variables and secrets per project, and the worker injects them into every new workspace Pod (run Pods, resumed run Pods and setup-test Pods).

- **Per-entry Secrets.** Each secret entry is stored as its own Kubernetes Secret through the SecretStore, named from the org and the entry id (`projectEnvSecretName(orgId, entryId)`). Postgres (`project_env_vars`, with `org_id` and RLS) holds plain values and, for secrets, only the name and metadata, never the value.
- **Rows are authoritative.** The `project_env_vars` rows decide which entries exist. At run or setup-test creation the worker reads the rows (org and project filter) and then each secret entry from the SecretStore. Project delete removes the rows and their Secrets.
- **New Pods only.** A save takes effect for Pods created afterwards. Running Pods keep their old values; Stop then Resume builds a new Pod with the current values. Setup does not run again on resume.
- **Reserved names** (static list in contracts, dynamic adapter names checked again at Job build) keep project entries from overriding platform variables. A clash fails the run non-retryably and names the variable, never its value.
- **Audit and redaction.** Each add, edit and remove is audited with actor, project, name and kind, never a value. Secret values are redacted from stored run output, transcripts, ticket comments and setup-test logs (`***`).
- **Access** reuses existing permissions (`setup:read`, `setup:update`, `secret:update`); no change to `access.ts`.

This extends ADR-0012 (a second kind of Secret, per entry) and decision 8 of ADR-0019, which stands. It closes follow-up F2 of the workspace setup spec.

## Alternatives considered

The source spec records the confirmed design and no ranked alternatives, so none are invented here.

## Consequences

### Positive

- Setup scripts and the agent can use private registries and tokens without putting them in the script or the repo.
- Secret values never reach Postgres, logs, events or API responses; the API returns names and metadata only.
- Per-entry Secrets and routes map each kind to its own permission and avoid echoing a secret back.

### Negative

- Setup and the agent can read every value. This is an accepted risk (spec Edge cases): a live terminal attach can show a secret, and a member who owns a run can attach and read the Pod env, even though members cannot open Desk. Hiding credentials from setup and the agent stays follow-up F6.
- Plain values are shown in clear and are not redacted from logs; the UI says so.
- Changes do not reach running Pods.
- Secrets shorter than the minimum length are not redacted, so they are refused.
- `docs/conventions/security.md` §1 may need new wording; it is flagged in the PR, not edited here.

## Links

- [Source spec](../superpowers/specs/2026-11-23-workspace-env-secrets-design.md)
- Related ADRs: [0012](0012-credentials-in-kubernetes-secrets.md), [0019](0019-repo-setup-and-approved-store-plugins.md), [0036](0036-rbac-permissions-roles-scope.md)
