# 0038. Suspended orgs are refused at the tenant guard, the intake and the first start of a run

- Status: Accepted
- Date: 2026-11-23
- Source: [Platform admin dashboard design](../superpowers/specs/2026-11-23-platform-admin-dashboard-design.md) (BR-37 to BR-52; Architecture; ADR); [plan](../superpowers/plans/2026-11-23-platform-admin-dashboard.md) Task 23; GitHub issue #192

## Context

A platform admin needs to stop an organization (an unpaid account, an abuse report) without deleting its data. Nothing in the product could do that: a member kept every grant they had. The tenant guard ([ADR-0036](0036-rbac-permissions-roles-scope.md)) decides membership, permission and scope, and no step asks whether the org itself is allowed to act. Running runs, webhooks and the worker's first start also need a stated rule.

## Decision

An organization has a status, `active` or `suspended`, and a suspended org is refused where people or triggers start work.

- **Status model.** `organization.status text not null default 'active'` with a CHECK, and `organization.suspended_at` (set exactly when suspended). No reason column on `organization`: the reason lives only in the platform audit `payload`. Only the platform routes `suspendOrg` and `reactivateOrg` (permission `platform-org:update`) change it. better-auth declares `status` as an organization field with `input: false`, so a client can read it in the org list but never write it; `suspended_at` is not declared.
- **Guard order.** Membership, then **org active**, then permission, then target scope, then `any`/`own`. A non-member gets the plain 403 whatever the org's status (the status is read in the same query as the membership, `orgMembership`, and never told to someone who is not a member). A member of a suspended org, whatever their role (owner included), gets 403 with problem type `org-suspended` and the fixed text "This organization is suspended."; no reason, no date, no org data. This holds for every route that goes through `checkTenantAccess`: HTTP routes, SSE connects, terminal attach and re-auth (an open terminal closes at its next re-auth), the install callback and the dev routes. `/api/me/access` is refused too.
- **What stays allowed.** Platform routes (`scope: 'platform'`, the admin is not a tenant member), `me.*` routes with `scope: 'user'` (own invitations, `GET /api/me/platform`), and the better-auth session routes including `set-active` and the org list (which carries `status`), so a member can leave the suspended org through the web switcher and an invitee can accept an invitation into it.
- **Intake.** A webhook's signature is checked first and unchanged; a verified delivery for a suspended org starts no run and is recorded as `ignored_org_suspended`.
- **First start only.** The worker activity `createRunSecretAndJob` refuses the first start (`!resume`) of a run of a suspended org with a non-retryable `OrgSuspended` failure, before any credential read, token mint or Secret write. A resume and the automatic pod-crash recovery ([ADR-0029](0029-unexpected-pod-ends-resume-automatically.md)) are exempt, so a running run finishes; a person's resume or reopen is refused earlier, at the API guard.
- **`GET /api/me/platform`** (`scope: 'user'`) returns `{ platformAdmin: boolean }`, so the web can show the platform entry to an admin whose active org is suspended (where `me.access` is 403).
- **`platform_audit_log.target_org_id`** (uuid, no FK, indexed) records the org a platform action targets. This amends [ADR-0037](0037-platform-admins-in-database.md)'s "no `org_id`" line: the column is not named `org_id`, so no RLS lint or test treats the table as tenant data.
- **A fifth `SECURITY DEFINER` function**, `platform_org_stats`, returns ids, counts and timestamps for the directory (it also returns one owner's user id), in the same shape as the existing four.

## Alternatives considered

The source spec records the human's design and no ranked alternatives, so none are invented here.

## Consequences

### Positive

- One place (the guard) refuses a suspended org for every route, stream and terminal, with no per-route code.
- Data is kept and a reactivated org's members work again on their next request.
- A non-member learns nothing about another org's status.

### Negative

- The membership query now joins `organization`, one more table on every tenant request.
- A suspended org's running runs finish and post to their tickets; stopping them is not part of this decision.
- The guard answers a suspended org before the path `:orgId` check, so a member naming another org in the path gets the suspension, not a 404 (they are a member, so nothing leaks).

## Links

- [Platform admin dashboard design](../superpowers/specs/2026-11-23-platform-admin-dashboard-design.md)
- Amends: [0036](0036-rbac-permissions-roles-scope.md) (guard order), [0037](0037-platform-admins-in-database.md) ("no `org_id`" line)
- Related: [0029](0029-unexpected-pod-ends-resume-automatically.md), [0035](0035-per-request-org-check-and-auth-allow-list.md)
