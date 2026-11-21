# 0031. Scoped RBAC with roles, assignments and invitation-only sign-up

- Status: Accepted
- Date: 2026-11-21
- Source: [RBAC foundation design](../superpowers/specs/2026-11-20-rbac-foundation-design.md) (Tenancy and permission, ADR); [plan](../superpowers/plans/2026-11-21-rbac-foundation.md) Task 9

## Context

Access today is "org member, plus project creator or org owner for the terminal". That cannot express a viewer, a project admin, or a member who controls only their own runs, and anyone who signs in can create an organisation. The product is heading to multi-tenant use and needs a permission model that every endpoint, SSE stream and the terminal enforce the same way, and a way to decide who a trigger comment acts for.

## Decision

- **Permissions** are named in `packages/contracts` (CRUD plus a short closed verb list, with an `own` condition for run control): one list, shared by api, web and core. Platform permissions use the `platform-*` prefix and never appear in a tenant role.
- **Roles** are per-org rows copied from global template rows (`role_templates`, `role_template_permissions`). The built-in roles are `owner`, `admin`, `member` and `viewer`. No API edits roles in this slice.
- **Assignments** are (user, role, scope) inside one org, where the scope is the org or one project. Assignments add up; nothing restricts. "Project admin" is `admin` granted on a project scope.
- **Project scope** is enforced in the api guard. RLS stays org-only (`withOrg`); a project the caller cannot see is a 404.
- **Run owner** is the linked commenter. For a bot comment it is the origin run's owner. A trigger runs only when the owner is linked and holds `run:create` on the project; otherwise the outcome is `ignored_owner_unlinked` or `ignored_owner_not_permitted`.
- **Platform admins** (`PLATFORM_ADMIN_EMAILS`, matched on the verified session email) create organisations and manage members and assignments in any org through `/api/platform/*`.
- **Sign-up is invitation-gated.** Invitations live in their own table, accepted through one `SECURITY DEFINER` lookup. Better-auth access control and its invitation plugin are not used.
- **Terminal:** attaching needs `terminal:attach` on the run's project, with ownership for members. Close codes stay 4401, 4403, 4409; 4403 covers a missing permission and an out-of-scope project.
- **Exception to "every app table has org_id":** `role_templates` and `role_template_permissions` are a platform-owned catalog with no tenant data, no RLS, and SELECT only for `agentdesk_app`.
- **Release note (Agent call):** every existing user loses access at deploy until granted a role. Grant operators first.

## Alternatives considered

| Alternative                                      | Why rejected                                                                                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Better-auth access control and invitation plugin | A per-org role id and project scope do not fit the plugin's single role string, and its accept route would write `member.role` (departs from epic §9) |
| Roles hardcoded in code                          | New orgs must copy roles from data; the seed is data                                                                                                  |
| Enforce project scope in RLS                     | RLS stays org-only (ADR-0006); project scope is an api concern                                                                                        |

## Consequences

### Positive

- One permission list drives guards, routes, terminal and trigger intake.
- Viewers, project admins and own-run members are possible without new tables per role.

### Negative

- A global table without `org_id`, and a second invitations table next to better-auth's.
- Existing users have no access after deploy until assignments are granted.

## Links

- [RBAC foundation design](../superpowers/specs/2026-11-20-rbac-foundation-design.md)
- Amends: [0014](0014-terminal-over-websocket-exec-relay.md) (terminal rule), [0013](0013-webhook-and-polling-intake.md) (who may trigger)
- Related: [0006](0006-tenant-ready-schema-with-rls.md)
