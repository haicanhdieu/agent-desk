# Desk access matrix (issue 216)

Status: implemented. Sensitive paths: auth (RBAC role contents, `routeAccess`), migrations (a data migration on role templates and org copies).
Source: issue #216. Decision (human, 2026-11-22): `member` and `viewer` lose Desk read access entirely (option 1). A read-only Desk view with a narrower permission is out of scope.

## Summary

A member or viewer could open the Desk configuration pages (agent and settings, setup, skills, rules) and read the same data from the API, because the seeded `member` and `viewer` roles held `agent:read`, `skill:read`, `rule:read` and `setup:read`, and no web route checked permissions. This change removes those four reads from the two roles (migration `0032`), guards `GET /api/orgs/:orgId/roles` with an admin-level permission, and makes the web app check permissions before it loads a Desk route, the new-project wizard or the invitations page, and before it shows a Desk entry point or a run action.

This page is the one written source of the expected access. The same matrix is enforced by tests: `packages/contracts/src/role-matrix.test.ts` (every `routeAccess` entry against owner, admin, member and viewer), `packages/core/test/access/role-templates.int.test.ts` (the seeded role contents), `apps/api/test/desk-access.int.test.ts` and `apps/api/test/authz.int.test.ts` (HTTP, SSE and WebSocket), and the web route tests listed below.

## Roles after this change

Built-in roles, copied into every org from the templates. `any` unless noted.

| Role | Permissions |
| ---- | ----------- |
| owner | all 35 tenant permissions |
| admin | all tenant permissions but `org:delete` (34) |
| member | `project:read`, `run:read`, `run:create`; `run:update`, `run:cancel`, `terminal:attach` with `own` (6) |
| viewer | `project:read`, `run:read` (2) |

Removed from `member` and `viewer`: `agent:read`, `skill:read`, `rule:read`, `setup:read`. `owner` and `admin` are unchanged.

## API: expected access

O owner, A admin (org scope), M member, V viewer. `own` means the caller's own runs only. Allowed is 2xx; not allowed is 403 (404 when the target is outside the caller's scope). The permission is checked before any id lookup, so a missing, foreign or malformed id gets the same 403.

Desk configuration (the fix):

| Endpoint | Permission (level) | O | A | M | V |
| -------- | ------------------ | - | - | - | - |
| GET `/api/projects/:id/agent`, GET `/api/agents/:id/models` | `agent:read` (project) | yes | yes | no | no |
| PUT `/api/projects/:id/agent` | `agent:update` (project) | yes | yes | no | no |
| PUT `/api/agents/:id/credential` | `secret:update` (project) | yes | yes | no | no |
| GET `/api/projects/:id/setup-script`, `/versions`, `/versions/:v`, GET `/plugins`, GET `/setup-tests/latest` | `setup:read` (project) | yes | yes | no | no |
| PUT `/api/projects/:id/setup-script` | `setup:update` (project) | yes | yes | no | no |
| POST `/api/projects/:id/setup-tests`, POST `/api/setup-tests/:id/end` | `setup:test` (project) | yes | yes | no | no |
| GET `/api/setup-tests/:id/events` (SSE) | `setup:read` (project) | yes | yes | no | no |
| WS `/api/setup-tests/:id/terminal` | `terminal:attach` (project) | yes | yes | no (4403) | no (4403) |
| GET `/api/projects/:id/skills`, `/skills/:name` | `skill:read` (project) | yes | yes | no | no |
| PUT / DELETE `/api/projects/:id/skills/:name` | `skill:update` / `skill:delete` (project) | yes | yes | no | no |
| GET `/api/projects/:id/rules`, `/rules/prompt-preview` | `rule:read` (project) | yes | yes | no | no |
| POST `/api/projects/:id/rules`, PATCH / DELETE `/api/rules/:id` | `rule:create` / `update` / `delete` (project) | yes | yes | no | no |

Org administration:

| Endpoint | Permission (level) | O | A | M | V |
| -------- | ------------------ | - | - | - | - |
| GET `/api/orgs/:orgId/roles` | `assignment:read` (project-level, held anywhere) | yes | yes | no | no |
| GET `/api/orgs/:orgId/members` | `member:read` or `assignment:create` | yes | yes | no | no |
| GET / POST / DELETE `/api/orgs/:orgId/assignments[/:id]` | `assignment:*` | yes | yes (no escalation) | no | no |
| GET `/api/projects/:projectId/members` | `assignment:read` (project) | yes | yes | no | no |
| POST `/api/projects/:projectId/members` | `assignment:create` (project) | yes | yes (no escalation) | no | no |
| PUT `/api/projects/:projectId/members/:userId/role` | `assignment:create` (project), `assignment:delete` per replaced role | yes | yes (no escalation) | no | no |
| DELETE `/api/projects/:projectId/members/:userId` | `assignment:delete` (project); never yourself | yes | yes | no | no |
| GET `/api/projects/:projectId/audit` | `project-audit:read` (project) | yes | yes | no | no |
| GET / POST / DELETE / resend `/api/orgs/:orgId/invitations[/:id]` | `member:*` or `assignment:*` | yes | yes (no escalation) | no | no |
| GET `/api/orgs/:orgId/checklist` | `project:create` (org) | yes | yes | no | no |
| GET `/api/connections`, `/connections/:id/repos` | `connection:read` (org) | yes | yes | no | no |
| POST `/api/connections/:p/install`, `/sync`, GET `/callback` | `connection:create` (org) | yes | yes | no | no |
| `/api/platform/**` (15 routes) | platform admins only (`platform_admins` entries, [ADR-0037](../../adr/0037-platform-admins-in-database.md)) | no | no | no | no |

Projects, runs, tickets (unchanged):

| Endpoint | Permission (level) | O | A | M | V |
| -------- | ------------------ | - | - | - | - |
| GET `/api/projects`, GET `/api/projects/:id`, `/connection`, `/ignored` | `project:read` (project) | yes | yes | yes | yes |
| POST `/api/projects` | `project:create` (org) | yes | yes | no | no |
| PATCH / DELETE `/api/projects/:id` | `project:update` / `project:delete` | yes | yes | no | no |
| POST `/api/projects/:id/connection/poll` | `run:create` (project) | yes | yes | yes | no |
| GET runs list, stats, by number, `/runs/:id`, `/log`, `/transcript`, `/events`, `/projects/:id/events`, `/tickets/pr-states` | `run:read` (project) | yes | yes | yes | yes |
| POST `/api/runs/:id/stop`, `/close-session`, `/finish`, `/resume` | `run:update` (project) | any | any | own | no |
| POST `/api/runs/:id/cancel` | `run:cancel` (project) | any | any | own | no |
| WS `/api/runs/:id/terminal` | `terminal:attach` (project) | any | any | own | no |
| GET `/api/me/access` | self (member of the active org) | yes | yes | yes | yes |
| `/api/me/invitations/**` | signed-in user, own email | yes | yes | yes | yes |
| `/healthz`, `/readyz`, `/auth/*`, `/webhooks/:provider` | public (webhooks: signature checked first) | yes | yes | yes | yes |

An admin granted on one project (project scope) reads and changes the Desk of that project only and gets 404 on another project's Desk routes. They can still list the roles, because `assignment:read` is a project-level permission and they invite people to their project.

Tenant data touched by the Desk routes: the project's agent, skills, rules, setup script and setup tests, all under `withOrg` and the project filter. This change adds no route and widens nothing.

## UI routes: expected access

| Route | O | A | M | V |
| ----- | - | - | - | - |
| `/sign-in` | public | | | |
| `/`, `/projects`, `/o/$org` (redirects) | yes | yes | yes | yes |
| `/invitations`, `/invitations/$invitation` | any signed-in user | | | |
| `/orgs/new` | platform admin only | | | |
| `/o/$org/projects` | yes | yes | yes | yes |
| `/o/$org/projects/new/$step` (wizard) | yes | yes | no | no |
| `/o/$org/invitations` | yes | yes | no | no |
| `/o/$org/p/$project/runs`, `/runs/$run`, `/needs-you` | yes | yes | yes (run actions on own runs only) | yes, read-only |
| `/o/$org/p/$project/desk/agent`, `/desk/setup`, `/desk/skills`, `/desk/rules` | yes | yes | no | no |
| `/o/$org/p/$project/desk/members` | yes | yes | no | no |
| `/o/$org/p/$project/desk/audit` | yes | yes | no | no |
| Delete project (Agent & settings Danger zone) | shown | shown | hidden | hidden |
| Desk tab, project row Settings, connection warning and run panel links to the Desk | shown | shown | hidden | hidden |

Not allowed on a route means the Forbidden page, no loader fetch of the protected data and no nav entry. The routes check in `beforeLoad` (`apps/web/src/features/access/guards.ts`: `requirePermission`, `requireInvite`) with `can(access, permission, { projectId })`. The guards and the hooks (`useAccess`, `useCan`) deny while the grants load or when they failed to load. The web app uses the grants only to show and hide; the API is the authority.

Run actions (Cancel, Finish, Stop session, Close session, Resume, and the Finish and Resume buttons in the notices, the needs-you list and the runs banner) show only where the viewer holds the permission on that run: `run:update` or `run:cancel`, with `own` meaning `run.ownerUserId` is the signed-in user. A viewer sees none.

## Dependencies checked before the migration (AC-5)

Reads of `agent:read`, `setup:read`, `skill:read` and `rule:read` outside the Desk pages, and what was done:

- `useDeskFrame` (used by the runs, run detail and needs-you pages through `useProjectPage`) called `useSetupWarning`, which requested `setupScript.get` and `setupTests.latest` on every project page. A member would have got two 403 per page. The warning is now requested only with `setup:read`.
- The run side panel links Skill, Rule and Setup rows to the Desk, and the run detail "Change time limit", "Open workspace setup" and the runs-board connection warning actions link to Desk pages. These links are now left out without the matching Desk read (plain text for the side panel rows).
- The project list row menu "Settings" and "Switch to polling" linked to the Desk agent page. They are now left out without `agent:read` on that project.
- The new-project wizard reads agent, skills, rules and setup script. It needs `project:create` at org scope, which only owner and admin hold, and both keep every Desk read.
- `rules.promptPreview` is used only by the Desk rules page. Run detail, needs-you and the runs board read no Desk configuration.
- Worker, poller and webhook intake read agents and rules directly through the database, not through these routes or role permissions.

## Agent calls

- `Agent call:` `roles.list` is guarded by `assignment:read`, not `member:read`. Both are admin-level (member and viewer hold neither). `member:read` is an org-level permission, so a project-scoped admin would lose the role list, and the invite dialog needs it for them. `assignment:read` is a project-level permission, so they keep it.
- `Agent call:` the Desk tab (top bar) links to the rules page, so it shows only with `rule:read` on the project. The wizard and the invitations page are refused in `beforeLoad` and the invitations page keeps its own no-access state as a second line.
- `Agent call:` `canCreate` on `Projects` and `ProjectsEmpty` defaults to `false` (fail closed) instead of `true`. A Desk tab, a Settings link or a run action shows only when its href or handler is given.
- `Agent call:` the mock API (`apps/web/src/mocks/msw/handlers.ts`) now answers 403 like the guard when the role lacks the route's permission, so the browser mock and the route tests show what the real API would.
- `Agent call:` the setup-test terminal stays `terminal:attach` (own for a member). A member cannot start a setup test, so they never own one and the socket closes 4403; the matrix test records `own` for that row.

## Out of scope

- A read-only Desk view with a narrower permission (rejected, option 1).
- Platform admin handling, and the contents of `owner` and `admin`.
- Follow-ups (separate issues): re-checking access on long-lived SSE streams when a grant is revoked; a test of the allow-list of public controllers outside `/api` and `/dev`; whether `/api/docs` stays public and whether `/readyz` hides dependency names; `routeAccess` entries for `member:update`, `member:delete`, `org:update` and `org:delete` when those endpoints exist.

## Tests

| Layer | File |
| ----- | ---- |
| Seed and migration | `packages/db/test/desk-reads-revoked.int.test.ts`, `packages/core/test/access/role-templates.int.test.ts`, `packages/core/test/access/access.int.test.ts` |
| Role matrix over `routeAccess` | `packages/contracts/src/role-matrix.test.ts`, `packages/contracts/src/route-access.test.ts` |
| API (HTTP, SSE, WebSocket, scope, cross-org) | `apps/api/test/desk-access.int.test.ts`, `apps/api/test/authz.int.test.ts`, `apps/api/test/assignments.int.test.ts` |
| Web routes and run actions | `apps/web/src/features/access/deskAccess.route.test.tsx`, `apps/web/src/features/runs/runActions.route.test.tsx`, `apps/web/src/mocks/msw/deskAccess.test.ts` |
| E2E mock | `apps/web/e2e/mock/desk-access.spec.ts` |
| E2E local (API, running stack) | `apps/web/e2e/local/rbac-desk-access.spec.ts` |
