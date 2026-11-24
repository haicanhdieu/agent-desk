# 0039. Per-org connection ownership and webhook fan-out

- Status: Accepted
- Date: 2026-11-24
- Source: issue #278 (GitHub installation sync across orgs); human decision on the open routing question (fan out to every matching project)

## Context

A provider installation (for GitHub, an App installed on a user or organization account) belongs to the provider account, not to an Agent Desk org. A person who works in two Agent Desk orgs can have both orgs use the same installation. Until now `connections` was unique on `(provider, external_id)` across all orgs, so the second org could not link an installation the first one already held, and `resolve_project` returned a single project. `inbound_events` was unique on `(provider, delivery_id)` across all orgs, so a delivery recorded by one org hid the same delivery from every other.

## Decision

Each org owns its own connection row for an installation, and a webhook is handled for every project that uses it.

- `connections` is unique on `(org_id, provider, external_id)`. A non-unique index on `(provider, external_id)` serves the webhook lookup. One org holds at most one row per installation; several orgs may each hold one.
- Linking is explicit and per org: `connections.sync` and the install callback create the row for the caller's org, and need `connection:create` at org level (ADR-0036). The user's own provider account proves access to the installation. No org sees or uses another org's row.
- `resolve_project(provider, external_id, repo_path)` returns every `(org_id, project_id)` match (zero, one or many), ordered by project creation. It stays `SECURITY DEFINER`, owned by `agentdesk_owner`, with a pinned `search_path`, executable only by `agentdesk_app`, and still requires the connection to belong to the project's org. It returns ids only.
- Webhook intake handles the event once per match, each inside its own `withOrg` transaction with that org's id. Routing, authorization (the run owner must hold `run:create` in that project), the suspension check and the run start all happen per org. A failure in one project is recorded or logged and does not stop the others; the error is rethrown after all of them ran, so the sender's retry finishes only the project that failed.
- Dedupe is per org: `inbound_events` is unique on `(org_id, provider, delivery_id)`. A delivery that matched no project has a null org, which a plain unique key treats as distinct, so a partial unique index on `(provider, delivery_id) where org_id is null` keeps those replays deduped. `runs` stays unique on `(project_id, trigger_comment_id)`.
- Signature verification still comes first, before any side effect and before the lookup.
- The webhook reply is one outcome for the whole delivery: `run_created` (202) if any project started a run, else the first project's outcome.

## Alternatives considered

| Alternative                                                           | Why rejected                                                                                               |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Keep the global unique key; one org owns an installation              | A person in two orgs could never use their installation in the second org (the bug in #278).               |
| Share one connection row between orgs                                 | Breaks `org_id` on every row and RLS; one org could read or change another's connection.                   |
| Route each event to the oldest project only                           | A later org linking the same repo would silently never receive its events. Rejected by the human decision. |
| Keep `inbound_events` globally unique and record one row per delivery | The second org would see its event as a duplicate and never run it.                                        |

## Consequences

### Positive

- The same installation works in every org its user belongs to, with each org's data and access kept apart.
- A webhook for a shared repo starts the run in every org that set it up.

### Negative

- One delivery can start several runs (one per org); each org pays for its own.
- A delivery's replay is checked once per org, so a retry after a partial failure reprocesses only the orgs that did not finish.
- The webhook reply cannot describe each org's outcome; per-org outcomes are in each org's `inbound_events`.

## Links

- Amends [0013](0013-webhook-and-polling-intake.md) (dedupe key, project resolution) and [0006](0006-tenant-ready-schema-with-rls.md) (what `resolve_project` returns)
- Related: [0036](0036-rbac-permissions-roles-scope.md), [0038](0038-suspended-orgs-refused-at-guard-intake-and-first-start.md)
