# 0037. Platform admins are stored in the database and seeded by hand

- Status: Accepted
- Date: 2026-11-22
- Source: [Platform admin role design](../superpowers/specs/2026-11-22-platform-admin-role-design.md) (Architecture: Data model, Platform setup runbook; Other decisions); [plan](../superpowers/plans/2026-11-22-platform-admin-role.md) Task 8; GitHub issue #215

## Context

[ADR-0031](0031-scoped-rbac-roles-assignments.md) made platform admins an email list in the `PLATFORM_ADMIN_EMAILS` env var, matched on the verified session email. Adding or removing one meant editing the deployment config and restarting the API, no API could grant or revoke the role, and nothing recorded who changed it. The epic (#185, #192) needs platform admins to list, grant and revoke the role themselves, and an operator still needs a way to create the first admin and to recover when none is left.

## Decision

Platform admins are read only from a new table, `platform_admins`, and the env var is removed.

- **`platform_admins`** holds one row per admin, keyed by a unique lowercase email (`platform_admins_email_key`, plus a CHECK that the email is `lower(btrim(email))` and not empty). A user is a platform admin when their verified session email equals a row. The same check backs the session guard's platform branch, `GET /api/me/access` (`platformAdmin`) and the sign-up gate (a seeded email may sign up without an invitation).
- **Hand seed.** The first admin is created by one SQL statement in the [platform setup runbook](../runbooks/platform-setup.md) (`INSERT INTO platform_admins (email) VALUES (…) ON CONFLICT (email) DO NOTHING;`). The same statement is the recovery path when no working admin is left. The seed is not audited by the product. The local stack seeds `admin@dev.local` itself, only when `AUTH_DEV_LOGIN` is on.
- **`platform_audit_log`** is an append-only table that records each grant and revoke (actor, action, target, payload with the email and account id). A repeat grant and a refused change write nothing. Tenants never read it.
- **No `org_id` and no RLS** on either table: they are platform data, not tenant data. `agentdesk_app` gets SELECT, INSERT and DELETE on `platform_admins` and SELECT and INSERT on `platform_audit_log`. They are reached only through `scope: 'platform'` routes (`/api/platform/admins`), `/api/me/access` and the sign-up gate.
- **Permissions** `platform-admin:read`, `platform-admin:create` and `platform-admin:delete` are platform-level, defined in `packages/contracts/src/access.ts` and never seeded into tenant roles.
- **Last-admin rule.** A revoke is refused (409) when no working admin other than the target would remain, where a working admin is an entry whose email matches an existing, verified user.

This amends ADR-0031's "Platform admins (`PLATFORM_ADMIN_EMAILS` …)" line and adds two platform tables to its list of tables without `org_id`.

## Alternatives considered

The source spec records the human's design choice (a database table seeded by hand) and no ranked alternatives, so none are invented here. The earlier design with a bootstrap and retire flow for the env list was dropped by the human in favour of this one.

## Consequences

### Positive

- Platform admins change without a config edit or a restart, take effect on the user's next request, and every API change is audited.
- The platform has one source of truth for the role instead of a config list and a table.
- The seed doubles as recovery, so the product needs no bootstrap or break-glass endpoint.

### Negative

- An existing deploy has no platform admin after the upgrade until the operator runs the seed (the runbook's Upgrade note). A leftover `PLATFORM_ADMIN_EMAILS` is ignored and grants nothing, with no startup warning.
- The manual seed is not audited by the product.
- `platform_admins` and `platform_audit_log` are exceptions to "every app table has `org_id` and RLS" (recorded in [database.md](../conventions/database.md) §2), so access control rests on the platform-scope guard and the grants.

## Links

- Amends: [0031](0031-scoped-rbac-roles-assignments.md) (platform admins line)
- Related: [0036](0036-rbac-permissions-roles-scope.md) (permission, role, scope; platform level), [0006](0006-tenant-ready-schema-with-rls.md) (RLS stays org-only)
- [Platform admin role design](../superpowers/specs/2026-11-22-platform-admin-role-design.md)
- [Set up the platform](../runbooks/platform-setup.md)
