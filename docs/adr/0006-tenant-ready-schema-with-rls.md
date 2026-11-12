# 0006. Tenant-ready schema: `org_id` everywhere and Postgres RLS

- Status: Accepted
- Date: 2026-11-12
- Source: control plane design §2 (Tenancy), §4.1, §4.2

## Context

The PRD lists multi-tenant SaaS concerns (organizations, roles) as PoC
non-goals, and the Architecture doc's schema keys projects by
`owner_user_id`. The control plane design commits to a roadmap with orgs,
roles, SSO and audit. Retrofitting a tenant key onto every table later is the
expensive migration.

## Decision

Build tenant-ready now, without any org UI:

- Every application table has `org_id uuid not null` (`inbound_events.org_id`
  is nullable until the project is resolved).
- Each such table has `ENABLE` and `FORCE ROW LEVEL SECURITY` with the policy
  `org_id = current_setting('app.org_id')::uuid`.
- The app connects as `agentdesk_app` (no `BYPASSRLS`, not owner); migrations
  run as `agentdesk_owner`.
- `withOrg(orgId, fn)` opens a transaction, sets `app.org_id`, and is the only
  way request and activity code obtain a database handle.
- Cross-tenant reads are limited to two `SECURITY DEFINER` functions:
  `resolve_project` (webhook intake) and `queued_runs_without_workflow`
  (outbox sweep).
- Each user gets one personal organization at first sign-in (owner role, slug
  from the handle); the session carries `activeOrganizationId`.
- A record from another org is invisible and returns 404.

## Alternatives considered

| Alternative                                            | Why rejected                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Full multi-tenant now (org UI, invitations, switching) | Weighed; out of scope for the PoC, while the schema work is what is costly to defer |
| PoC single-owner (Architecture doc's `owner_user_id`)  | Retrofitting `org_id` later is the expensive migration; this avoids it cheaply      |

## Consequences

### Positive

- Tenant isolation is enforced by the database, not by each query.
- Orgs, roles and invitations can be added without a data migration.
- URLs and caches are already org-scoped ([0003](0003-vite-spa-tanstack-router.md)).

### Negative

- Every table, migration and test carries `org_id`; an RLS leak test across two
  orgs is required on every table.
- Webhooks and the outbox sweep need definer functions to cross tenants.
- Open check: Drizzle `pgPolicy` with `FORCE ROW LEVEL SECURITY` and
  `SECURITY DEFINER` functions in drizzle-kit migrations.

## Links

- [Control plane design](../superpowers/specs/2026-11-12-control-plane-design.md) §2, §4, §9, §11
- [PRD (PoC)](<../Agent Desk — PRD (PoC).md>) §2 Non-goals
- Related: [0007](0007-drizzle-for-data-access.md), [0008](0008-better-auth-in-process.md)
