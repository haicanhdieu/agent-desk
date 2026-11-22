# 0036. RBAC has three dimensions: permissions, roles and scope

- Status: Accepted
- Date: 2026-11-22
- Source: [RBAC foundation design](../superpowers/specs/2026-11-20-rbac-foundation-design.md) (Tenancy and permission); [org onboarding design](../superpowers/specs/2026-11-21-org-onboarding-design.md); the code in `packages/contracts/src/access.ts`

## Context

[ADR-0031](0031-scoped-rbac-roles-assignments.md) decided scoped RBAC, but its model is spread across bullets about permissions, roles, assignments and the guard. People reading the code or adding a route need one short statement of the model and of how a request is checked against it. This ADR restates and clarifies 0031's model. It does not change any of 0031's decisions.

## Decision

RBAC has three dimensions: **permissions**, **roles** and **scope**.

| Dimension      | What it is                                                                                 | Example                              |
| -------------- | ------------------------------------------------------------------------------------------ | ------------------------------------ |
| **Permission** | One action on one entity: `resource:verb`, with a condition `any` or `own`                 | `run:cancel` (own)                   |
| **Role**       | A named group of permissions; it defines which actions on which entities a user is granted | `admin`, `member`, `viewer`, `owner` |
| **Scope**      | Where the user may use those permissions: the whole org, or one project                    | org, or project P1                   |

An **assignment** is (user, role, scope). Assignments add up; nothing restricts. There is no deny rule.

```text
user ──assignment──► role ──holds──► permissions (resource:verb, any|own)
            │
            └──► scope: org (every project) | project P
```

| Assignment            | Result                                                                 |
| --------------------- | ---------------------------------------------------------------------- |
| `admin` on project P1 | Full permission on every resource inside P1; nothing in other projects |
| `admin` on the org    | Full permission on every resource in every project of the org          |

Two rules from the code make the examples exact:

- **Each permission has a level** (`PERMISSION_LEVEL`). Project-level permissions (project data: runs, agents, skills, rules, setup, `project:read|update`, assignments) count from an org-scope grant (all projects) or a project grant (that project). Org-level permissions (`project:create`, `project:delete`, `connection:*`, `member:*`, `org:update`, `org:delete`) count only from an org-scope grant. So `admin` on P1 cannot delete P1, create projects, read connections or manage org members.
- **`own`** means the target's owner is the caller: the run's owner, or the setup test's starter. An ownerless run matches only `any`.

### How a request is checked

The route table (`routeAccess` in `packages/contracts/src/route-access.ts`) names the permission and, for project routes, the path param that leads to the project. The guard (`apps/api/src/auth/session.guard.ts` calling `checkTenantAccess` in `apps/api/src/access/check-access.ts`) then decides in this order:

1. Not a member of the active org: 403. A path `:orgId` that is not the active org: 404.
2. Load the caller's grants under `withOrg` (`loadAccess`).
3. The permission is not held anywhere in the org (`holdsAnywhere`, any condition): 403, before any id is looked up. A missing, foreign or malformed id gets the same answer as a real one.
4. Project routes: resolve the target's project and owner in one lookup (`resolveTarget`). Missing, in another org, or outside every scope of the caller (`inScope`): 404.
5. Visible, but `can(access, permission, target)` is false (for example someone else's run under an `own` line): 403.

Lists use `visibleProjects`: `all` with an org-scope grant, else the projects whose grant holds the permission. The terminal follows the same model but closes 4403 for both a missing permission and an out-of-scope project (ADR-0031).

### Where each dimension lives

| Dimension   | Code                                                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Permission  | `Permission`, `PermissionCondition`, `OWNABLE_PERMISSIONS`, `PERMISSION_LEVEL` in `packages/contracts/src/access.ts`; checks `can`, `holdsAnywhere`, `inScope`, `visibleProjects`                                              |
| Role        | Global templates `role_templates` and `role_template_permissions` (seeded by migration `0026`), copied into per-org `roles` and `role_permissions` by `copyRoleTemplates` (`packages/core/src/access/`) when an org is created |
| Scope       | `role_assignments.scope_type` (`org` or `project`) and `project_id` (migration `0024`); `Scope` in contracts; read per request by `loadAccess`                                                                                 |
| Enforcement | `apps/api/src/access/` (`authorize.ts`, `check-access.ts`, `target-resolver.ts`, `grant-rules.ts`). RLS stays org-only; project scope is enforced in the API guard only                                                        |

"Project admin" is `admin` granted on a project scope, not a separate role. `owner` is assignable only at org scope. Platform permissions (`platform-*`) are never in a tenant role.

### Not decided here

- The contents of the built-in roles are being revised in GitHub issue #216. Options under discussion: the lowest role may become own-runs-only, and `run:read` may gain an `own` condition. Until a later decision lands, the seeded roles in migration `0026` are the truth.

## Alternatives considered

No alternatives were weighed for this ADR: it restates the model ADR-0031 chose. 0031's alternatives (better-auth access control, hardcoded roles, project scope in RLS) still apply.

## Consequences

### Positive

- One short statement of the model for reviewers, route authors and the role revision in #216.
- The guard order is written down, so a new route or check can be compared against it.

### Negative

- The word "full" in the examples is limited by permission levels: org-level permissions never take effect from a project grant. Readers must read the level rule, not only the examples.

## Links

- Restates and clarifies: [0031](0031-scoped-rbac-roles-assignments.md)
- Related: [0006](0006-tenant-ready-schema-with-rls.md) (RLS stays org-only), [0035](0035-per-request-org-check-and-auth-allow-list.md) (org check before the access check)
- [RBAC foundation design](../superpowers/specs/2026-11-20-rbac-foundation-design.md) (v1 role matrix)
