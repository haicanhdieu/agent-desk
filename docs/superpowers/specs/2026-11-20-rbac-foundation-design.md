<!-- dev-plan: kind=spec id=rbac-foundation rev=3 hash=38ffcc62851d source=issue#188 -->
# Scoped RBAC foundation design

Status: draft. Sensitive paths: auth (session guard, invitation-gated sign-up, platform admin and the `/api/platform/*` endpoint set, session hooks), terminal (attach authorization and its timed re-check), RLS/`withOrg` (new org tables `roles`, `role_permissions`, `role_assignments`, `invitations` and a new `SECURITY DEFINER` function), migrations (new tables, role seed, run-owner backfill), webhooks (ticket intake trigger authorization, shared with the poller).
Source: issue #188

## Summary

Today any member of an org can do almost everything, and anyone who signs in with GitHub gets a personal org. This slice (slice 1 of epic #185) adds permissions, roles and scopes: an admin gives each person a role on the org or on single projects, and every HTTP, SSE and terminal endpoint, and every run started from a ticket comment, checks it. Sign-up needs an invitation; platform admins come from deployment config and create orgs. Existing users keep their data but have no access until someone grants it. API only: no screen changes.

## Business rules

Confirmed by the human at planning time.

### Goal

Admins give each person a role on a scope; each person can do only what that role allows, only on the projects in scope, on every HTTP, SSE and terminal endpoint and for runs started from ticket comments. Nobody gets in without an invitation; existing users wait for a grant.

### Actors

| Actor | May do |
| ----- | ------ |
| Platform admin | Create orgs; list orgs, an org's members with their assignments, and an org's project ids and names; grant, revoke and invite in any org. All of this goes through its own `/api/platform/*` endpoint set; the tenant routes `/api/orgs/:orgId/*` treat a platform admin like any other user. No other tenant data unless they also hold an assignment there. |
| Org owner (`owner` on the org) | Every action on every project and org endpoint, including granting and revoking `owner`. |
| Org admin (`admin` on the org) | Everything an owner can, except grant, change or revoke `owner`. |
| Project admin (`admin` on a project) | Configure that project and control any run in it; grant, revoke and invite as `admin`, `member` or `viewer` on the projects they administer only. |
| Member | Read every run in scope; start runs; cancel, stop, finish, resume and attach the terminal only on runs they own. |
| Viewer | Read every project's data and event streams in scope; no writes, no terminal. |
| Signed-in user with no assignment | 403 on every endpoint in the org, the project list included; only `GET /api/me/access` answers (200, empty). |
| Invited person not yet signed up | Sign up with the invited verified email; joins the org with the invited role on the org or on each listed project. |
| Ticket-source commenter | Starts a run only when linked to an Agent Desk user who holds `run:create` on the project; that user becomes the run's owner. |
| Worker / system | Auto-resume, idle pause, time limit, token refresh on existing runs, with no permission check. |

### Rules

Surface: API, including the sign-in flow, the terminal WebSocket, SSE streams and ticket-source comments (no UI in this slice, T8; the sign-in flow and ticket comments are the outside interfaces that also change).

Dropped ids, never reused: BR-10, BR-11, BR-15, BR-19, BR-20 to BR-24, BR-25, BR-43, BR-47.

| Id    | Category         | Rule |
| ----- | ---------------- | ---- |
| BR-1  | permission       | When a user holds `owner` on the org, they can do every action on every project and org endpoint. |
| BR-2  | permission       | When a user holds `admin` on the org, they can do everything an owner can except grant, change or revoke `owner`. |
| BR-3  | permission       | When a user holds `viewer` on the org, they get every project's data and event streams. |
| BR-4  | permission       | When a viewer calls any write endpoint, they get 403 and a reload shows nothing changed. |
| BR-5  | permission       | When a viewer opens a run or setup-test terminal, it closes 4403 before any terminal bytes. |
| BR-6  | permission       | When a caller holds the needed permission nowhere in the org, any target id or body gives 403, not 404 or 400. |
| BR-7  | permission       | When a caller who may do the action targets a missing or other-org resource, they get 404 (terminal 4403). |
| BR-8  | permission       | When a signed-in user is not a member of the active org, every endpoint gives 403 (terminal 4403); no session gives 401 (terminal 4401). |
| BR-9  | state-transition | When a permitted caller cancels, stops, finishes or resumes a run in the wrong state, they get today's 409; a caller without the permission gets 403 whatever the state. |
| BR-12 | feedback-state   | When a request is refused for lack of permission, the 403 problem body says the action is not allowed and carries a requestId, with no other-org or secret detail. |
| BR-13 | permission       | When a member opens the terminal of an active run they own in scope, the attach succeeds. |
| BR-14 | permission       | When a member cancels, stops, finishes or resumes a run they own in scope, the action is accepted. |
| BR-16 | permission       | When a member lists, installs or syncs connections, they get 403. |
| BR-17 | permission       | When a member sets an agent credential, they get 403. |
| BR-18 | permission       | When a member creates or deletes a project, they get 403. |
| BR-33 | permission       | When a member edits project settings, agent, rules, skills, setup script or starts a setup test, they get 403. |
| BR-48 | permission       | When a member opens the terminal of a run someone else owns, it closes 4403. |
| BR-49 | permission       | When a member cancels, stops, finishes or resumes a run someone else owns, they get 403 and the run is unchanged. |
| BR-66 | permission       | When a run has no owner (started before the upgrade), a member gets 403 on its controls and 4403 on its terminal; an admin can. |
| BR-68 | permission       | When a member clicks poll now on a project in scope, the poll runs; a viewer gets 403. |
| BR-27 | permission       | When a user's assignments cover only some projects, the project list shows only those. |
| BR-28 | permission       | When a user requests a project outside their scope (project, runs, run by number, log, transcript, rules, skills, setup, agent, events stream), they get 404; its terminal closes 4403. |
| BR-29 | permission       | When a user is `admin` on P1 only, they can change P1's settings, agent, credential, rules, skills, setup script and setup tests and control any P1 run, and get 403 on project create, project delete and connections. |
| BR-30 | permission       | When a user is `member` on P1 and P2, they read every run in P1 and P2, control only their own, and see no other project. |
| BR-31 | permission       | When a user holds `viewer` on the org and `admin` on P1, they can change P1 and only read every other project. |
| BR-42 | permission       | When a user has only project-scoped assignments, connection list and repo list give 403. |
| BR-44 | permission       | When a project in a user's scope is deleted, it leaves their list and the assignment keeps its other projects. |
| BR-32 | persistence      | When a user who existed before the upgrade signs in after it, every endpoint in their org, the project list included, gives 403 and terminals close 4403 until someone grants them an assignment; then their old projects and runs are there unchanged. |
| BR-26 | permission       | When the ticket source does not mark the commenter as allowed, no run starts (unchanged). |
| BR-50 | side-effect      | When a commenter linked to an Agent Desk user who holds `run:create` on the project posts a trigger command, a run starts and shows that user as its owner. |
| BR-51 | side-effect      | When a linked commenter lacks `run:create` on that project (viewer, out of scope, no assignment), no run starts and the project's ignored list shows a "no permission" outcome. |
| BR-52 | side-effect      | When the commenter is not linked to any Agent Desk user, no run starts and the ignored list shows a "not linked" outcome. |
| BR-53 | side-effect      | When a run's agent writes a trigger command on a ticket and that run's owner holds `run:create` on the target project, a new run starts and shows the same owner. |
| BR-71 | side-effect      | When a bot-written trigger comes from a run in another project, from a run with no owner, or cannot be tied to a run, no run starts and the ignored list shows "not linked". |
| BR-72 | side-effect      | When a bot-written trigger comes from a run whose owner no longer holds `run:create` on the target project, no run starts and the ignored list shows "no permission". |
| BR-34 | permission       | When a platform admin grants a member a role on a scope in an org, that user's next request follows it. |
| BR-35 | permission       | When an assignment is revoked and the user still holds another assignment in the org, their next request no longer sees the projects it covered (404); when they now hold nothing in the org, their next request gets 403; in both cases their open terminal closes 4403 on the re-check, and an open event stream keeps running until it reconnects. |
| BR-36 | permission       | When a member, a viewer, or a project admin acting outside their project calls grant or revoke, they get 403. |
| BR-37 | validation       | (A grant covers the org or one project; invitations may list several, BR-59.) When a grant names a role not in the org, `owner` on a project scope or a project of another org, the caller gets 422; a malformed body, 400; an unknown org, 404; an unknown user or a user who is not a member of that org, 422 with pointer `/userId`. |
| BR-41 | persistence      | When the same grant is sent twice, the user has one assignment and the second call succeeds. |
| BR-45 | permission       | When an org owner or org-scope admin grants or revokes a non-owner role in their own org, it applies on the next request; an admin granting or revoking `owner` gets 403. |
| BR-46 | state-transition | When an org owner revokes the org's last owner assignment, they get 409; a platform admin can, on the platform routes. |
| BR-61 | permission       | When a project admin grants or revokes admin, member or viewer on their own project, it applies; on the org scope or another project, 403. |
| BR-63 | persistence      | When a signed-in user asks for their own access, they get their assignments and permissions in the active org (empty when they have none; the only endpoint that answers a user with no assignment). |
| BR-64 | permission       | When an org owner or admin lists assignments they see all in the org; a project admin sees their project's; a member or viewer gets 403. |
| BR-38 | permission       | When a platform admin with no assignment in an org calls that org's tenant endpoints, they get no data (403 / 404). |
| BR-39 | permission       | When a user's verified email is in the platform-admin config they can call platform endpoints; once removed, their next call gets 403. |
| BR-40 | permission       | When a platform admin lists orgs, an org's members with assignments, or an org's projects, they get ids, names, roles and scopes only. |
| BR-69 | side-effect      | When a platform admin creates an org with a name and a slug, the org exists with that slug, the built-in roles and no members, and the platform admin can invite its first owner into it. |
| BR-70 | permission       | When anyone who is not a platform admin calls org creation, they get 403. |
| BR-73 | validation       | When an org is created without a name or slug, with a name over 100 characters, or with a slug outside the slug format, it is refused with 400; with a slug another org already uses, 409. |
| BR-62 | permission       | When a person whose verified email is in the platform-admin config signs in for the first time without an invitation, the sign-up succeeds. |
| BR-54 | permission       | When a person with no account and no pending invitation signs in, the sign-up is refused and no account is created. |
| BR-55 | side-effect      | When an invited person signs in for the first time with the matching verified email, they become a member of that org with the invited role on the org or on each listed project, and see exactly those projects. |
| BR-56 | side-effect      | When an existing user with a pending invitation signs in, they join that org with the invited role on the org or on each listed project. |
| BR-57 | state-transition | When an invitation is older than 7 days, signing in does not apply it (a new person is refused), lists show it as expired, and revoking it gives 409. |
| BR-58 | state-transition | When an invitation was revoked, signing in does not apply it and revoking it again gives 409. |
| BR-59 | validation       | When an invitation has an invalid or over-long email or an empty project list, it is refused with 400; a role not in the org, `owner` on projects, or a project of another org gives 422; someone already a member or already invited in that org gives 409. |
| BR-60 | permission       | When someone creates, lists or revokes invitations, the same rights as grants apply (platform admin in any org; owner or admin in their own org, admin never `owner`; project admin only admin, member or viewer on projects they administer, any other listed project gives 403); anyone else gets 403. |


### Not observable

- Audit entries for org creation, grants, revokes and invitations (actor, target, and role and scope before and after): there is no audit read endpoint; proved at integration level. Their effects are BR-34, BR-35, BR-45, BR-55, BR-60, BR-69.
- The link from a bot comment to the run that wrote it: internal; its effect is BR-53, BR-71, BR-72.
- Roles as per-org seeded rows, ready for admin-defined roles: structure; its effect is BR-1 to BR-33 and BR-37.
- One permission list and route map in contracts for API and web: structure; its effect is every permission rule.
- Personal orgs are no longer created for new people: visible only as BR-55's landing org.
- The deploy writes no per-user audit entries.

### States

- Invitation: pending → accepted (the person signs in with the matching verified email); pending → revoked (by someone allowed to create it); pending → expired (7 days after creation). Accepted, revoked and expired are final. Lists show each invitation's status (pending, accepted, revoked, expired); revoking one that is not pending gives 409 (state conflict, `backend.md` §4).
- Assignment: created by a grant or an accepted invitation; deleted by a revoke. Assignments do not expire.
- Org: created by a platform admin with the built-in roles and no members.
- Run, setup-test and connection state machines are unchanged; permission and scope are checked before state (`backend.md` §4), so a caller without the permission gets 403 whatever the state (BR-9).

### Limits and validation

- Grant: target user, role, scope (`org` or one project id).
- Invitation: email, role, scope (`org`, or a list of project ids). Accepting an invitation with a project list creates one assignment per project.
- Org creation: name and slug are both required. Name: 1 to 100 characters. Slug: today's slug alphabet (lowercase `a-z`, `0-9`, `-`, no leading or trailing `-`, `apps/api/src/auth/slug.ts`), 1 to 63 characters, unique (409 when taken). The default slug is built from the name and the person creating the org may edit it. A missing or bad name or slug is 400.
- A body that fails the schema is 400. A well-formed role id that is not one of the org's roles, or a role on a scope it does not allow (`owner` on a project), is 422 (semantically invalid reference, `backend.md` §4).
- Project id not in that org: 422 with a pointer (`backend.md` §4).
- Unknown org: 404. Unknown user, or a user who is not a member of the org, in a grant: 422 with pointer `/userId`, the same answer for both.
- Invitation project list: an empty list or a malformed body is 400; duplicate project ids collapse; at most 100 ids; any listed project not in the org is 422; a project admin listing a project they do not administer is 403.
- Email: a valid address, at most 254 characters, compared case-insensitively.
- Invitation for someone already a member of the org: 409 (use a grant). A second pending invitation for the same email in the same org: 409 (revoke first).
- Invitation expiry: 7 days after creation. A sign-in whose only invitation is expired is refused like one with none.
- Repeating an existing grant succeeds and leaves one assignment.
- No count or rate limit on grants, invitations or org creation.

### Edge cases

- Missing or other-org resource: 404; terminal 4403 (`backend.md` §4, ADR-0006).
- Out-of-scope project in the same org counts as missing: 404, left out of lists, terminal 4403.
- The action is authorized before the resource is looked up or the body validated: a caller who holds the permission nowhere in the org gets 403 whatever the target or body; a caller who holds it somewhere gets 404 for an out-of-scope target and 403 for an in-scope target they may not act on (for example a member on another person's run).
- A user with no assignment in the active org gets 403 on every endpoint there, the project list included; `GET /api/me/access` still answers 200 with their empty access.
- An open terminal closes 4403 on the existing timed re-check once access goes (`terminal.gateway.ts`).
- An open event stream is checked only at connect and keeps running until it reconnects (T7).
- HTTP uses the current assignments on every request.
- A deleted project drops out of every scope; the assignment keeps its other projects.
- Pending invitations from several orgs for one email are all accepted at sign-in.
- An existing user with a pending invitation joins that org when they next sign in.
- After sign-in, a user whose only org is the one they were invited to starts in that org.
- A trigger comment written by the desk's bot gets as owner the owner of the run whose agent wrote it; that owner's `run:create` on the target project is checked like any commenter's (T2).
- A bot-written trigger is tied only to an origin run in the same project. If the writing run is in another project, has no owner (pre-upgrade run, or itself ownerless), or the comment cannot be tied to a run, no run starts; the ignored list shows "not linked".
- If the writing run's owner has lost `run:create` on that project, no run starts; the ignored list shows "no permission".
- Ownership passes down a chain (A's agent starts B, B's agent starts C: all owned by A's owner); the existing max-runs-per-ticket and one-active-run guards are the only loop limits.

### Tenancy and permission

Three dimensions: a permission is one action; a role is a named set of permissions; a scope is the org or one project. An assignment is (user, role, scope) inside one org; "member on P1 and P2" is two assignments. Assignments add up (union); nothing restricts. Every check is inside the active org; other orgs stay invisible (AGENTS rule 4, ADR-0006). Authz applies on every endpoint including SSE and terminal (rule 7). 403 means the role lacks the action; 404 means missing, other org or out of scope; the terminal closes 4403 for all of these (`backend.md` §4, ADR-0014).

Roles are per-org seeded rows, not hardcoded: built-in `owner`, `admin`, `member`, `viewer` are copied into every org; no API edits roles in this slice. "Project admin" is the `admin` role granted on a project scope (no separate row). `owner` can be granted only on the org scope. Permission names follow shape D (CRUD plus a short closed verb list), one list in contracts.

v1 matrix (fills every "?" of the approved permission proposal; the human confirmed `member:*` and `org:update` for owner and org admin and `org:delete` for owner only, which no route uses yet):

| Permission | owner (org) | admin (org) | admin (project = project admin) | member | viewer | platform admin |
| --- | --- | --- | --- | --- | --- | --- |
| all `*:read` on project data (project, run, agent, skill, rule, setup) | yes | yes | in scope | in scope | in scope | no |
| `run:create` (start by trigger comment, poll now) | yes | yes | in scope | in scope | no | no |
| `run:update` (stop, finish, resume), `run:cancel`, `terminal:attach` | yes | yes | in scope | own runs only | no | no |
| `project:update`, `agent:update`, `secret:update`, `skill:update/delete`, `rule:create/update/delete`, `setup:update`, `setup:test` | yes | yes | in scope | no | no | no |
| `project:delete` | yes | yes | no | no | no | no |
| `project:create`, `connection:read`, `connection:create` | yes | yes | no | no | no | no |
| `assignment:read/create/delete`, invitations (tenant routes) | yes, incl. granting `owner` | yes, never `owner` | own project only, project roles only | no | no | no (uses `platform-*` permissions on `/api/platform/*` endpoints, any org, incl. `owner`) |
| `member:read/create/update/delete` | yes | yes | no | no | no | no (`platform-*` permissions on `/api/platform/*` endpoints) |
| `org:update` | yes | yes | no | no | no | no |
| `org:delete` | yes | no | no | no | no | no |
| `platform-*` permissions (`platform-org`, `platform-member`, `platform-assignment`, `platform-invitation`, ...) on `/api/platform/*` endpoints | no | no | no | no | no | yes |

- Own run: the run's owner is the caller. Setup tests count as owned by whoever started them; members cannot start them, so they own none.
- A run with no owner (created before the upgrade) can be controlled and attached only by admin and above.
- Poll now needs `run:create`; every run it starts still checks its own owner.
- Grant and revoke: platform admin anywhere, through the platform routes; org owner and org admin in their own org (an org admin never grants, changes or revokes `owner`); project admin only `admin`, `member`, `viewer` on their own project (T3).
- Granting `owner`: an org owner may through the tenant routes; an org admin may not (403); the platform admin may through the platform routes.
- Invitations: the same rights as grants; a project admin invites as `admin`, `member` or `viewer` on the projects they administer only.
- Removing the org's last owner assignment is 409 on the tenant routes, even for an org owner; it is allowed only on the platform routes (orgs start with no owner after deploy).
- A user with no assignment in the active org gets 403 on every endpoint there, the project list included. `GET /api/me/access` is the one exception: it answers 200 with their empty access, so the web can tell "no access yet" from an error; it reads only the caller's own data, not org data.
- `projects.created_by` and `member.role` decide nothing.
- Platform admins come from deployment config listing verified sign-in emails, checked on each request; removing an email revokes it; no API grants it (epic §7.5). A config-listed email may sign up without an invitation. Platform endpoints (`/api/platform/*`) are outside any org, have their own permissions and responses, and need platform admin (403 otherwise); the tenant routes `/api/orgs/:orgId/*` are tenant-only, and platform admin alone gives no tenant data there (epic G4). A platform admin may grant themselves an assignment; it is audited.
- Runs from ticket comments: the existing ticket-source check (author association) still applies first (`security.md` §5); then the commenter must map to an Agent Desk user who holds `run:create` in that project; that user is the run's owner (T6, T6b). "Maps to a user" means the Agent Desk user who signed in with the same account at the ticket source's provider (same external user id); no other link exists in this slice.
- Permission is checked when the run starts; a run already started keeps going if its owner later loses access; worker actions (auto-resume, time limit) are system work and need no owner check.
- Dev-only `/dev/*` routes stay session-only; a fake comment they post still goes through the trigger owner check.
- Names are provider-agnostic: permission, role, scope, assignment, invitation, platform admin, run owner, ticket source, linked account; ignored outcomes are named generically ("commenter not linked", "commenter lacks permission"), never after a provider (AGENTS rule 3).
- Commenter login and external id are untrusted; they are used only as data to look up a linked user, never interpolated (AGENTS rule 6, `security.md` §5). The invitation email is untrusted input, validated and stored as data. Comment text handling is unchanged.

### Lifecycle, compatibility and side effects

- Additive migration; built-in roles are seeded into every org; no applied migration is edited (AGENTS rule 8).
- Existing users get no assignment; their memberships, projects, runs, connections and secrets are kept and reappear when granted. Every existing user loses access at deploy until granted. People who only used GitHub sign-in keep their account and can sign in; they see 403s until granted.
- Existing runs have no owner when `triggered_by_external_id` is null; admin and above control them.
- After deploy no trigger comment starts a run until its author holds `run:create` through a grant (operators grant first).
- Personal orgs are no longer created for new people (sign-up needs an invitation into an org); existing personal orgs stay.
- Org creation, each grant, revoke, invitation create, revoke and accept writes an org audit entry (org creation in the new org's log): actor (user or platform admin), target user or email, and role and scope before and after; a new grant has no "before", a revoke has no "after". The deploy writes none.
- No separate audit row per triggered run: the run's owner and trigger source are the record; refused triggers appear in the project's ignored list.
- Assignments do not expire; revoke deletes; history is the audit entries.
- A refused trigger comment starts no run and appears in the project's ignored list with a "not linked" or "no permission" outcome; no comment is posted on the ticket (same as today's refused triggers).
- A run started from a comment shows its owner.
- A grant or revoke changes what the user sees on their next request; an open terminal closes on the re-check; an open event stream keeps running until reconnect.
- No email is sent for an invitation: no sender exists; the inviter tells the person, who is matched by email at sign-in.
- The web shows the existing 403 and 4403 states; no UI change (T8).
- Docs fixed in the same PR: ADR-0014 and the `security.md` terminal bullet, the `backend.md` §4 403 row, `security.md` §5 trigger control (now also owner permission).

### Out of scope

- Any UI (requirement; T8: API only, screens in a later slice).
- Full invitations: resend, email delivery, accept link (T5: later slice).
- Editing roles (T4: later, by that org's admin).
- Org deletion and ownership transfer (not in the requirement; listed as out by the business area).

The requirement's own out-of-scope list (project-level roles, invitations, platform role) was changed by the human's redesign: project-scoped assignments, a minimal invitation and a config-based platform admin are in this slice.

## Architecture

Confirmed by the human at planning time.

### Overview

Layering is apps → core → db → contracts; web → contracts only (`architecture.md` §1).

- `packages/contracts`: `Permission` enum (shape D names), `PermissionCondition` (`any` | `own`), `OWNABLE_PERMISSIONS`, `PERMISSION_LEVEL` (org | project), `ScopeType`, the `routeAccess` map, new DTOs, a pure `can(access, permission, target)`, the `platform-*` permissions, the platform DTOs, and the slug-from-name helper shared by web and api.
- `packages/db`: new tables, RLS, migrations, seed, and the `pending_invitations_for_email` definer function.
- `packages/core/src/access/` (new folder, shared by api and worker, `backend.md` §1): `loadAccess(tx, userId)`, `findLinkedUser(db, provider, externalId)`, `resolveRunOwner(...)` for intake, `copyRoleTemplates(tx, orgId)`.
- `packages/core/src/intake`: owner resolution and the permission check before a run is created (the webhook in api and `PollOnce` in worker share `processTicketEvent`).
- `apps/api`: the guard, the project/owner resolver for id-keyed routes, the `projects.list` filter, terminal and install-callback checks, the platform-admin check, tenant assignment/invitation/role/member endpoints and a separate `/api/platform/*` endpoint set (own controllers and DTOs, shared services with an explicit actor), the sign-up gate and invitation acceptance in better-auth hooks, audit writes.
- `apps/worker`: no workflow change; `PollOnce` gets the owner check through core.
- `apps/web`, runner: no change (API only, T8).

Flow of a request: session → active org and `member` row → `loadAccess` under `withOrg` → route entry from `routeAccess` → caller holds the permission somewhere in the org, else 403 → org or project check (project id and run owner resolved in one lookup) → handler. Flow of a trigger comment: command → ticket-source association → owner linked → owner holds `run:create` at the project → rule matching → run insert with `owner_user_id`.

Contracts details:

- Shape D: names are `resource:action`, CRUD plus closed verbs (`run:cancel`, `terminal:attach`, `setup:test`), no wildcards, each permission fixed as org-level or project-level. An org-level permission counts only from an org-scope grant; a project-level permission counts from an org-scope grant (all projects) or a project grant (that project). Vocabulary: `project:create|read|update|delete`, `connection:create|read`, `agent:read|update`, `secret:update`, `skill:read|update|delete`, `rule:create|read|update|delete`, `setup:read|update`, `setup:test`, `run:read|create|update`, `run:cancel`, `terminal:attach`, `member:read|create|update|delete`, `assignment:read|create|delete`, `org:update|delete`, plus the `platform-*` permissions below.
- Ownership is a condition on a grant line, not a permission name: `role_permissions.condition` is `any` or `own`; `own` is allowed only for `OWNABLE_PERMISSIONS` = `run:update`, `run:cancel`, `terminal:attach`. The seeded `member` gets these with `own`; `admin` and `owner` with `any`.
- `can(access, permission, { projectId?, ownerUserId? })` is true when a grant at org scope or at `projectId` lists the permission with `any`, or with `own` and `ownerUserId === access.userId`.
- `routeAccess` is typed from `Routes`, so a missing entry fails typecheck. Kinds: `{scope:'org', permission}`, `{scope:'project', permission, param}` (`projectId` | `runId` | `ruleId` | `agentId` | `setupTestId`), `{scope:'self'}`, `{scope:'org-admin', permission}` (tenant assignment, invitation and member routes: coarse guard, exact check in the service; tenant-only), `{scope:'platform', permission}`.
- Platform permissions: level `platform`, names in shape D form with platform resources: `platform-org:create|read`, `platform-project:read`, `platform-role:read`, `platform-member:read`, `platform-assignment:read|create|delete`, `platform-invitation:read|create|delete`. Every config-listed platform admin holds all of them (no platform roles in this slice); the names exist so each platform route declares what it needs and platform roles can come later without renaming. Tenant role rows can never hold a `platform-*` permission (seed and migrate test check; `copyRoleTemplates` and the later role editor reject them). They replace `platform:read` and `platform:assign` from the permission proposal.
- Route to permission map (from the approved proposal): `connections.list`, `connections.repos` → `connection:read`; `connections.install`, `connections.sync` and the install callback → `connection:create`; `projects.list` → `project:read` (filtered); `projects.create` → `project:create`; `projects.get`, `projects.connection`, `projects.ignored` → `project:read`; `projects.update` → `project:update`; `projects.remove` → `project:delete`; `projects.pollNow` → `run:create`; `projects.events` (SSE) → `run:read`; `agents.get`, `agents.models` → `agent:read`; `agents.put` → `agent:update`; `agents.putCredential` → `secret:update`; `skills.list`, `skills.get` → `skill:read`; `skills.put` → `skill:update`; `skills.remove` → `skill:delete`; `rules.list`, `rules.promptPreview` → `rule:read`; `rules.create|update|remove` → `rule:create|update|delete`; `setupScript.get`, `setupScript.versions`, `setupScript.version`, `setup.plugins`, `setupTests.latest`, `setupTests.events` (SSE) → `setup:read`; `setupScript.put` → `setup:update`; `setupTests.create`, `setupTests.end` → `setup:test`; `setupTests.terminal` and `runs.terminal` (WS) → `terminal:attach`; `runs.list`, `runs.stats`, `runs.byNumber`, `runs.get`, `runs.log`, `runs.transcript`, `runs.events` (SSE) → `run:read`; `runs.stop`, `runs.finish`, `runs.resume` → `run:update`; `runs.cancel` → `run:cancel`.
- New DTOs: `RoleDto {id, key, name, builtIn, assignableScopes, permissions: {permission, condition}[]}`, `AssignmentDto`, `InvitationDto {id, email, role: {id, key, name}, scope: {type: 'org'} | {type: 'project', projects: {id, name}[]}, status: 'pending' | 'accepted' | 'revoked' | 'expired', expiresAt, invitedBy, createdAt, acceptedAt}`, `MemberDto {userId, handle, name, assignments}`, `AccessDto {userId, platformAdmin, assignments: {roleKey, scope, permissions}[]}`. Platform DTOs are their own schemas so the two views can diverge: `PlatformOrgDto {id, name, slug, memberCount, createdAt}`, `PlatformProjectDto {id, name}`, `PlatformMemberDto {userId, handle, name, email, assignments: AssignmentDto[]}` (email shown to the platform admin, who needs it to identify people; tenant `MemberDto` has no email), `PlatformRoleDto` (the `RoleDto` fields), and `PlatformAssignmentDto` and `PlatformInvitationDto` (the `AssignmentDto` and `InvitationDto` shapes under platform names).
- New ignored outcomes `ignored_owner_unlinked` and `ignored_owner_not_permitted`, added wherever the contracts enum for ignored events lists outcomes.

### Data model

New migrations follow `0021_agent_auto_resume_max.sql`; schema and data migrations are separate (`database.md` §5).

- `role_templates` (global platform catalog): `id uuid pk`, `key text unique`, `name`, `assignable_scopes text[]`, `created_at`. `role_template_permissions`: `template_id` (fk, cascade), `permission text`, `condition text check in ('any','own')`, `pk(template_id, permission)`. No `org_id`, no RLS; `agentdesk_app` has SELECT only. This is a documented exception to "every app table has org_id", recorded in the ADR (platform-owned, read-only to the app, holds no tenant data).
- `roles` (org): `id uuid pk`, `org_id uuid not null`, `key text not null`, `name text not null`, `built_in boolean not null default false`, `template_id uuid null` (fk `role_templates`, on delete set null), `assignable_scopes text[] not null`, `created_at`. Unique `(org_id, key)` and `(org_id, id)`. RLS, forced, with policy and leak test.
- `role_permissions` (org): `org_id`, `role_id`, `permission text not null`, `condition text not null default 'any' check in ('any','own')`, PK `(role_id, permission)`, FK `(org_id, role_id) → roles(org_id, id) on delete cascade`. RLS and leak test. No CHECK on `permission` and no permissions table: the contracts `Permission` enum is the catalog; names are parsed on read and unknown ones are ignored with a warn; a migrate test asserts every seeded name parses, `own` appears only on ownable permissions, and every permission in `routeAccess` is granted by at least one template.
- Database privileges on roles: the app gets SELECT and INSERT on `roles` and `role_permissions` (copy at org creation), no UPDATE or DELETE until the role-editing feature (fail closed).
- `role_assignments` (org): `id`, `org_id`, `user_id text` (fk `user`, on delete cascade), `role_id` with FK `(org_id, role_id) → roles(org_id, id) on delete restrict`, `scope_type text check in ('org','project')`, `project_id uuid null` (fk `projects`, on delete cascade), scope check `(scope_type = 'org' and project_id is null) or (scope_type = 'project' and project_id is not null)`, `granted_by text`, `granted_at`. Unique `(org_id, user_id, role_id, project_id) nulls not distinct`; indexes `(org_id, user_id)` and `(project_id)`. RLS and leak test.
- `invitations` (org, minimal, T5): `id`, `org_id`, `email text not null` (lowercased), `role_id` with FK `(org_id, role_id)`, `scope_type`, `project_ids uuid[] not null default '{}'`, `status text check in ('pending','accepted','revoked','expired')`, `expires_at timestamptz not null`, `invited_by text not null`, `accepted_by text`, `accepted_at`, `created_at`. Check `(scope_type = 'org' and project_ids = '{}') or (scope_type = 'project' and cardinality(project_ids) >= 1)`. Partial unique `(org_id, email) where status = 'pending'`; index `(email) where status = 'pending'`. RLS and leak test. Scope is the org or a list of projects; accepting creates one assignment per listed project. It is its own table, not better-auth's `invitation`.
- Expired invitations are computed from `expires_at` and stored lazily: reads (`InvitationDto.status`, the list endpoint) report `expired` for any `pending` row with `expires_at <= now()`; the definer lookup and acceptance ignore such rows. The row is written `expired` only when something touches it: a new invitation for the same org and email first sets the old expired-pending row to `expired` in the same transaction (so the partial unique key frees up), and acceptance skips it. No sweep job.
- `pending_invitations_for_email(email text) returns table(id uuid, org_id uuid)`: `SECURITY DEFINER`, `SET search_path`, pending and unexpired only, ids only, with an RLS test. The sign-up gate needs it to find invitations across orgs by email before any org is known. It is the third definer function, so it gets a security review (`architecture.md` §4).
- `runs.owner_user_id text null` (fk `user`, on delete set null): a nullable add, written at run insert by `processTicketEvent` from the resolved owner.
- `runs.origin_run_id uuid null` (fk `runs(id)`, on delete set null) with index `runs_origin_run_id_idx`: set only for runs triggered by a bot-authored comment; null otherwise. Nullable add, no backfill.
- Data migration 1: seed `role_templates` and their permissions (the v1 roles and lines from the business matrix), then copy them into every existing org with a `DO` loop that sets `app.org_id` per org so forced RLS accepts the inserts; idempotent (`on conflict do nothing`).
- Data migration 2: best-effort backfill of `runs.owner_user_id` from `account` where `provider_id` is the project's board connection provider and `account_id = runs.triggered_by_external_id`, batched, `where owner_user_id is null`. Unmatched runs stay owner-less, so only `any` grants control them.
- No assignment backfill: `role_assignments` starts empty. `member` rows stay as membership; `member.role` and `projects.created_by` are not authz inputs.
- Platform admins come from config only; no user column.

### API

Guard: one global guard, the extended `SessionGuard`:

1. No session → 401. A `scope:'platform'` route (only `/api/platform/*`) needs a verified email in `PLATFORM_ADMIN_EMAILS` (which then holds every `platform-*` permission), else 403; no active org or membership is needed; an unknown `:orgId` → 404. A route-table test asserts every `/api/platform/*` route is `scope:'platform'` and no other route is.
2. Org routes need an active org and a `member` row, else 403.
3. `loadAccess(tx, userId)` under `withOrg(orgId)`: one query over `role_assignments` joined with `role_permissions` (and the role key).
4. The route entry is found by `method + req.routeOptions.url`; an `/api` route with no entry → 403. The install callback reuses `connections.install`.
5. Permission before target lookup: if the caller holds the route's permission at no scope in the org (no grant line at all, any condition) → 403 before any id is resolved, so a missing, other-org or malformed id gets the same 403 and nothing about the target leaks (BR-6). A member with no assignment therefore gets 403 on `projects.list`. Only callers who hold it somewhere go on.
6. `org`: an org-scope grant with the permission, else 403.
7. `project`: resolve `projectId` (and `ownerUserId` for `runId` and `setupTestId`) in one lookup under `withOrg`; missing, other org or not in the caller's scopes → 404; visible but `can()` false (including not the caller's own run) → 403. The resolved ids are put on the request.
8. `org-admin`: the caller holds the route's permission at some scope in the org (tenant only; being a platform admin gives nothing here); the service does the exact scope and escalation check.

- `/api/orgs/:orgId/*` is tenant-only. A platform admin with no membership or assignment there is treated like any non-member: an `orgId` that is not the active org → 404; a member without the permission → 403. A platform admin who is also a member acts there under their tenant grants only.

- Project scope is application logic; RLS stays org-only (`architecture.md` §4).
- `projects.list` filters by `visibleProjects` (all, or a list of project ids) in both the page and `count(*)` (ADR-0028).
- Tenant callers on `/api/orgs/:orgId/*` with an `orgId` other than the active org get 404. Writes run in `withOrg(orgId)`; no definer function besides the invitation lookup.

| Method | Path | Who may call it | Request | Response | Contract |
| ------ | ---- | --------------- | ------- | -------- | -------- |
| GET | `/api/me/access` | any member of the active org (`self`), including one with no assignment | none | `AccessDto` (empty assignments when none) | new |
| GET | `/api/orgs/:orgId/roles` | any assignment in that org | none | `RoleDto[]` | new |
| GET | `/api/orgs/:orgId/members` | `member:read` at org scope, or `assignment:create` at any scope; assignments shown only for scopes the caller may read | `PageQuery` | `pageOf(MemberDto)` | new |
| GET | `/api/orgs/:orgId/assignments?projectId=` | `assignment:read` at that scope | `PageQuery` | `pageOf(AssignmentDto)` | new |
| POST | `/api/orgs/:orgId/assignments` | `assignment:create` at the target scope (org scope for org grants; org or that project for project grants) | `{userId, roleId, scope}` | 201 `AssignmentDto`; a repeat returns 200 with the existing one | new |
| DELETE | `/api/orgs/:orgId/assignments/:assignmentId` | `assignment:delete` at its scope, with the same subset and owner rules | none | 204 | new |
| POST | `/api/orgs/:orgId/invitations` | org scope: `member:create` at org scope plus the grant rules; project scope: `member:create` at org scope, or a project admin holding `assignment:create` on every listed project | `{email, roleId, scope}`, scope `{type: 'org'}` or `{type: 'project', projectIds: uuid[]}` | 201 `InvitationDto` | new |
| GET | `/api/orgs/:orgId/invitations` | `member:read` at org scope, or a project admin for invitations whose every project they administer | `PageQuery` | pending and expired invitations | new |
| DELETE | `/api/orgs/:orgId/invitations/:invitationId` | whoever could have created it (same rules) | none | 204 | new |
| POST | `/api/platform/orgs` | platform admin (`platform-org:create`) | `{name, slug}` | 201 `{id, name, slug}` | new |
| GET | `/api/platform/orgs` | platform admin (`platform-org:read`) | `PageQuery` | `pageOf(PlatformOrgDto)` | new |
| GET | `/api/platform/orgs/:orgId/projects` | platform admin (`platform-project:read`) | `PageQuery` | `pageOf(PlatformProjectDto)` (ids and names only, epic G4) | new |
| GET | `/api/platform/orgs/:orgId/roles` | platform admin (`platform-role:read`) | none | `PlatformRoleDto[]` | new |
| GET | `/api/platform/orgs/:orgId/members` | platform admin (`platform-member:read`) | `PageQuery` | `pageOf(PlatformMemberDto)` | new |
| GET | `/api/platform/orgs/:orgId/assignments?projectId=` | platform admin (`platform-assignment:read`) | `PageQuery` | `pageOf(PlatformAssignmentDto)` | new |
| POST | `/api/platform/orgs/:orgId/assignments` | platform admin (`platform-assignment:create`) | `{userId, roleId, scope}` | 201 `PlatformAssignmentDto`; a repeat returns 200 | new |
| DELETE | `/api/platform/orgs/:orgId/assignments/:assignmentId` | platform admin (`platform-assignment:delete`) | none | 204 | new |
| GET | `/api/platform/orgs/:orgId/invitations` | platform admin (`platform-invitation:read`) | `PageQuery` | `pageOf(PlatformInvitationDto)` (pending and computed expired) | new |
| POST | `/api/platform/orgs/:orgId/invitations` | platform admin (`platform-invitation:create`) | `{email, roleId, scope}` | 201 `PlatformInvitationDto` | new |
| DELETE | `/api/platform/orgs/:orgId/invitations/:invitationId` | platform admin (`platform-invitation:delete`) | none | 204 | new |

Endpoint rules:

- Tenant grant service: the grantor holds `assignment:create` at the target scope (T3); the role's permission lines must be a subset of the grantor's own at that scope (no escalation); on tenant routes `owner` is granted only by an org owner (an org admin or lower → 403); a grantor lacking rights for that role or scope → 403. A project not in the org → 422 (pointer `/scope/projectId`). An unknown `roleId` in this org, or a role the role row does not allow at that scope type (for example `owner` on a project) → 422 with pointer `/roleId`, not 400: the body is well-formed and passes the schema, the combination is semantically invalid (`backend.md` §4: 400 = Zod validation failure, 422 = semantically invalid reference). A `userId` that is not a member of the org or does not exist → 422 with pointer `/userId`, the same answer for both, so it never tells whether a user exists in another org (404 stays for path resources such as `:orgId`).
- Tenant revoke: removing the last org `owner` assignment → 409, even for an org owner (a platform admin can, through the platform routes).
- Tenant invitation create: the guard's coarse check is "`member:create` or `assignment:create` somewhere in the org"; the service does the exact check. A project admin invites only as `admin`, `member` or `viewer` on their own projects: the caller holds `assignment:create` on every listed project and the role's lines are a subset of theirs there; never `owner`, never org scope, never a project they do not administer (→ 403). `projectIds`: 1 to 100 ids, duplicates collapsed. Already a member → 409 ("grant instead"). A project not in the org → 422 (pointer `/scope/projectIds/<i>`); a role not allowed at the scope → 422 (pointer `/roleId`). Expires in 7 days (a constant, no env). No token or link is returned: the invitee signs in with that email.
- Invitation revoke: an invitation that is not pending (accepted, revoked or expired) → 409.
- Org creation: `name` and `slug` are both required (400 when missing or failing the slug format from `apps/api/src/auth/slug.ts`); a taken slug → 409 (pointer `/slug`), caught on better-auth's unique slug index, not read-then-insert (`database.md` §6). The default slug is built from the name by the caller (the later screen) with the contracts slug-from-name helper, so the API takes the slug as sent. One transaction inserts the `organization` row (id = uuid, as `ensurePersonalOrg` did) and copies `role_templates` into `roles` and `role_permissions` under `withOrg(newOrgId)` (`copyRoleTemplates`); audit `org.created` in the new org's `audit_log`. The first owner is then invited with `POST /api/platform/orgs/:orgId/invitations` (owner role, org scope): two calls, not one combined endpoint.
- Platform grant: no subset rule; may grant `owner`; the same 422 rules for user, role/scope and project. Platform revoke: may remove the last owner (orgs start ownerless after deploy). Platform invitation: any role including `owner`, org or project list; the same 409 and 422 rules; revoking an accepted or revoked invitation → 409. Unknown `:orgId` → 404; ids from another org → 404 (everything runs in `withOrg(orgId)`).
- Tenant and platform controllers call the same services with an explicit actor (`{ kind: 'member', access }` or `{ kind: 'platform_admin', userId }`); the services hold the rules (subset, owner, last owner, 422s) and only the platform actor skips the tenant-only ones. One code path, two route sets, two DTO sets.
- Platform actions write the target org's `audit_log` like tenant ones, with `actor_user_id` = the platform admin and `payload.actorKind = 'platform_admin'` (tenant: `'member'`).
- Install callback `complete()`: re-checks `connection:create` at org scope.
- `/dev/*`: session only (dev-only, absent in production).

WebSocket and SSE:

- Terminal WS (`runs.terminal`, `setupTests.terminal`): `check()` uses the same resolver including ownership (run owner; setup test `started_by`) and closes 4403; `reauth` re-runs it on its timer (T7).
- SSE: checked at connect only (T7).
- Webhooks: no change to signature checks; authorization of the trigger happens in intake (see Other decisions).

Sign-up gate and invitation acceptance (better-auth hooks in `apps/api/src/auth/auth.ts`):

- `user.create.before`: allow only if the email is verified and (`pending_invitations_for_email` returns a row or the email is in `PLATFORM_ADMIN_EMAILS`); otherwise throw, so no user row is created (T1). The same gate applies to dev-login sign-ups.
- `user.create.after` and `session.create.before`: `acceptPendingInvitations(userId, email)` under the existing per-user advisory lock, idempotent. For each invitation with a verified matching email, in `withOrg(orgId)`, one transaction per invitation: skip it if expired; insert `member` if absent; org scope → one `role_assignments` row (`scope_type = 'org'`); project scope → one row per listed project that still exists (deleted ones skipped and named in the audit payload), all through the unique key (`on conflict do nothing`, so a retry or a pre-existing grant is a no-op); `granted_by` = the inviter; mark `accepted` with `accepted_by` and `accepted_at`; audit `invitation.accepted` plus one `assignment.granted` per row created. If every listed project was deleted, the invitation is still accepted (membership only) so the person can sign in and be granted later. Existing users invited to another org get it on their next sign-in.
- `session.create.before`: `activeOrganizationId` is the user's oldest membership, or null (a platform admin with no org).
- `ensurePersonalOrg` is no longer called for new users; existing personal orgs are kept untouched.
- Dev only (`AUTH_DEV_LOGIN`, not in production): dev-login marks its accounts email-verified (so local platform-admin and invitation flows work) and links a `fake` provider account (`account_id` = handle) so fake-provider comments map to that dev user.

### Third-party libraries

| Library | New or existing | Used for | Approval |
| ------- | --------------- | -------- | -------- |
| better-auth 1.7.22 | existing | sessions, `account`, `member`, hooks for the sign-up gate and acceptance; its access-control and invitation plugins are not used | existing |
| zod | existing | permission enum, DTOs, request schemas | existing |
| NestJS | existing | guard, controllers | existing |
| Drizzle | existing | schema, migrations | existing |

No new dependency.

### Services and integrations

| Service | New or existing | How it is used |
| ------- | --------------- | -------------- |
| Postgres 18 | existing | new tables, RLS policies, the definer function, seed and backfill migrations |
| better-auth (in process) | existing | hooks for the sign-up gate and invitation acceptance; membership writes |
| Temporal | existing | unchanged; `PollOnce` reaches the owner check through core; no schedule added for invitation expiry |
| Kubernetes, SecretStore, provider APIs | existing | unchanged |

### Other decisions

Worker:

- No workflow change and no new activity. `PollOnce` → `processTicketEvent` now resolves the owner and checks `run:create`; an unlinked or unpermitted commenter is recorded as an ignored outcome and the cursor moves on (not retried). Idempotency is unchanged (`(project_id, trigger_comment_id)`).
- Auto-resume, idle pause, time limit and token refresh are system work and need no permission: they act on an existing run, and the owner check happened at trigger.

Runner and Kubernetes: no change. No untrusted text reaches a shell, a k8s spec or SQL; the owner lookup uses bound parameters.

Provider adapters and run owner:

- Owner = the commenter, resolved generically: the `account` row where `provider_id` is the project's board provider and `account_id` is the event's author external id (the provider user id, already carried to `runs.triggered_by_external_id`). No provider name in tables or core code (rule 3).
- The code-host association check stays. Order in the router: command → association → owner linked → owner holds `run:create` at the project → rule matching.
- Bot-authored triggers: owner = the owner of the run whose agent wrote the comment (round-3 T2). The origin is matched on the desk side, with no runner or prompt change. When `event.author === botLogin`, `processTicketEvent` looks, under `withOrg`, for runs of the same project whose pod could have written the comment: `started_at <= comment.createdAt` and (`finished_at is null` or `comment.createdAt <= finished_at`). It picks the single such run on the same ticket (`ticket_ref`); if there is none on that ticket, the single such run in the project; if zero or several match, there is no origin → ignored `ignored_owner_unlinked` (detail: "bot comment has no single originating run"). The comment time is used, not the processing time, so polled comments match after the origin run ended.
- Same project only: the match never looks outside the event's project, so a bot trigger whose only candidate origin is in another project or org starts no run (`ignored_owner_unlinked`, "not linked").
- The new run gets `origin_run_id` = that run and `owner_user_id` = its owner (transitive for chains). The inherited owner must still hold `run:create` at the project, else `ignored_owner_not_permitted`. An origin with no owner (pre-upgrade run) → `ignored_owner_unlinked`.
- A signed marker in the comment body was considered and not chosen: the agent writes comments itself, so a marker depends on the model complying, needs a runner/prompt change and a per-run key, and a marker visible in a public comment can be copied by another run's pod anyway.
- Residual risk, for the security review: a run pod in the same project can post a bot comment timed so another active run is the only match, making that run's owner the new run's owner. The impact is bounded: same project and repo token (all pods of a project already hold the same code-host powers); the new run's execution, credentials and commit identity do not depend on the owner (bot-triggered runs commit as the bot, `run-author.ts`); ownership only decides who may control the run and who it is attributed to. It never crosses projects or orgs. A bot comment starting another run is an existing cross-run effect of pod output (allowed today by `isAuthorizedAuthor`); this design narrows it to a single origin or nothing and does not widen `security.md` §4.
- `fake` adapter: the comment author external id = the author handle (dev link above).

Secrets: no new secret. `agents.putCredential` needs `secret:update` at project scope. Audit and invitation rows hold ids, emails, role keys and scopes only. `PLATFORM_ADMIN_EMAILS` is config, not a secret.

Events and live updates: no new event type. SSE is checked at connect (T7). The new ignored outcomes appear in the existing ignored-events list.

Config and environment: `PLATFORM_ADMIN_EMAILS` (comma list, lowercased, default empty) in `packages/core/src/config.ts`, in `.env.example` (`admin@dev.local`) and in the chart ConfigMap (`architecture.md` §7). No feature flag.

Failure, observability and scale:

- 403 is problem+json ("not allowed for your role here") with a requestId; 404 for out of scope; a refused sign-up is a better-auth error shown in the web's existing sign-in error state (no new web copy).
- After deploy every existing user is locked out until granted; a release note is required.
- Logs: `info` on each deny with `{requestId, orgId, userId, permission, routeKey, projectId}`; intake logs ignored owner outcomes at `info` without the comment body. Unknown permission names in data log at `warn`.
- Cost: one assignments query per request; one id lookup for id-keyed routes; intake adds an `account` lookup and `loadAccess` per command comment.
- Changes apply on the next request; the terminal within `TERMINAL_REAUTH_MS`.

Audit: grant, revoke, invitation create, revoke and accept, and org creation write the target org's `audit_log` in the same transaction, with actor, target user, and role and scope before and after (no `from` on a new grant, no `to` on a revoke). Payload:

- Columns: `actor_user_id` = who acted (platform admin, owner, admin, project admin, or the inviter for rows created at acceptance), `action`, `target_type`, `target_id`.
- `assignment.granted`: `target_type 'user'`, `target_id` = user id, `payload { to: { roleId, roleKey, scope: { type, projectId? } }, via?: { invitationId } }` (no `from`).
- `assignment.revoked`: same target, `payload { from: { roleId, roleKey, scope } }` (no `to`).
- `invitation.created`, `invitation.revoked`, `invitation.expired`, `invitation.accepted`: `target_type 'invitation'`, `target_id` = invitation id, `payload { email, to: { roleId, roleKey, scope: { type, projectIds? } }, skippedProjectIds? (accept only), acceptedBy? }`. The email is the invitee's address, not a secret; no token exists.
- `org.created`: `target_type 'org'`, `payload { name, slug }`.
- Grants are additive (no in-place role change), so an entry never has both `from` and `to`; a later "change role" endpoint would write both.
- Every audit payload and the stored invitation fields pass through `redactBody` before the write (defence in depth: payloads are built from ids and keys, and any future field named like a secret is dropped). Triggered runs: the run row's `owner_user_id` and `trigger_source` are the record; ignored triggers are in `inbound_events`. No new audit row on intake.

Sensitive paths: auth (guard, sign-up gate, platform admin and the `/api/platform/*` set, session hook), terminal authz, RLS (the new org tables), the new `SECURITY DEFINER` function, migrations with seed and backfill, intake router authorization, audit. The PR gets `review:sensitive` and a high-effort security review.

ADR: `docs/adr/0031-scoped-rbac-roles-assignments.md` records permission names in contracts (shape D with the `own` condition), per-org seeded roles copied from global templates, assignments (user, role, scope), project scope in the api guard (RLS org-only), run owner = linked commenter or, for bot comments, the origin run's owner, platform-admin org creation, invitation-gated sign-up with its own invitations table and one definer lookup, and better-auth access control and invitations not used. It amends ADR-0014 (terminal rule) and ADR-0013 (who may trigger), and records the departure from epic §9's "build on plugin invitations".

Docs fixed in the same PR: `security.md` §5 (trigger rule) and §6 (terminal, project access), `backend.md` §4, ADR-0014, control-plane spec §7.5.

Tests that follow from the platform split (carried into Testing): every `/api/platform/*` route is `scope:'platform'` with a `platform-*` permission and no other route is; no tenant role row (seed or copy) holds a `platform-*` permission; a non-platform user (any tenant role, including owner) calling any `/api/platform/*` route → 403; a platform admin with no membership calling any `/api/orgs/:orgId/*` or tenant project route → 404 (not the active org) or 403 (member without the permission), and a platform admin who is also a member gets exactly their tenant grants there; granting `owner`: platform admin on platform routes → allowed, org owner on tenant routes → allowed, org admin or lower on tenant routes → 403; removing the last owner: platform routes → allowed, tenant routes (even an org owner) → 409; platform responses parse with the platform DTOs (email present in `PlatformMemberDto`, absent in `MemberDto`); audit rows from platform actions carry `actorKind: 'platform_admin'` and payloads pass `redactBody`.

## Testing

Confirmed by the human at planning time.

Strategy:

- Each behaviour is proved at the lowest layer that can prove it, plus e2e for each user-visible or cross-component one (`testing.md` §1, AGENTS.md).
- E2E env is `local` for every rule with an e2e: the rules cross API guards, intake, the worker poller, SSE, the terminal relay and the fake pod (`tests-and-e2e.md` §3a). No `mock` spec: no UI change (T8).
- One spec, `apps/web/e2e/local/rbac.spec.ts`. Setup goes through real APIs: the dev platform admin (config email in the default local `.env`) creates an org and invites its owner; the owner builds P1 (full wizard, active run) and P2 (first wizard step); A = admin on P1, B = member on P1 and P2, C = member on P1, V = viewer on the org, all invited.
- Status codes are asserted as this spec records them (HTTP best practice and `backend.md` §4).
- Platform-admin steps (org create, first-owner invite, grant, revoke, member, assignment, invitation and role lists) call only `/api/platform/*`; tenant steps call `/api/orgs/:orgId/*`.
- Upgrade proof (T9): `apps/api/test/upgrade.int.test.ts` starts Postgres at 0021, seeds today's rows, applies the new migrations and drives the real API; plus BR-32 in `rbac.spec.ts` in its invite-only form.
- Worker: the poller path changes (owner lookup, `run:create` check, bot origin); the poll activity is tested against Testcontainers, idempotent on retry and moving the cursor past refused comments. No workflow input or activity signature changes, so no new replay test.
- Migrations: `migrate.int` asserts additivity (no existing `member`, `projects` or `connections` row changes; no assignment for existing users; `runs.owner_user_id` added nullable; the backfill fills only matching linked accounts and leaves the rest null), built-in roles copied once per existing org, and a seed rerun adds nothing. An RLS leak test runs as `agentdesk_app` for each new org table. The origin link is the `runs.origin_run_id` column, inside the existing `runs` RLS.
- No runner image test: the origin link needs no runner change.
- Determinism: denial and scope tables only hit routes that change nothing; a fresh org per test file; grant and revoke take effect on the next request, so the test makes the next request and never waits; terminal revoke awaits `c.closed` with a small `TERMINAL_REAUTH_MS`, no sleeps; SSE after revoke commits a frame after the revoke and reads it, then a new connect gets 404; poller cases trigger the poll through Temporal as `e2e-local.ts` does, and worker tests use the time-skipping env; local e2e uses fresh `e2e-<rand>` handles and orgs per test, the shared platform admin only creates orgs, invites and grants, and run status is awaited with `waitForStatus`; no `Date.now()` in resolver, guard, invitation or intake logic (`testing.md` §5).
- No bug fix in this slice. The existing carol 403/4403 tests change because the rule changes.

Where the tests live: "access unit" = `packages/core/test/access/**` and `packages/contracts/src/access.test.ts`; "routing unit" = `packages/core/test/router/**` and `packages/core/test/intake/**` with the owner lookup injected; "contract unit" = `packages/contracts/src/routes.test.ts`; API int files are under `apps/api/test/`; "worker int" = `apps/worker/test/**` (poll activity); "e2e" = `apps/web/e2e/local/rbac.spec.ts`.

| Rule | Behaviour | Layer | Where the test lives | E2E env |
| ---- | --------- | ----- | -------------------- | ------- |
| BR-1 | Owner does project create, connection sync, credential, rule edit, run cancel, terminal attach | unit, e2e | access unit; e2e | local |
| BR-2 | Org admin does the same; granting `owner` → 403 | unit, e2e | access unit; e2e | local |
| BR-3 | Viewer opens P1 and P2 run pages; data and live status show | unit, integration, e2e | access unit; `sse.int.test.ts` (at connect); e2e | local |
| BR-4 | Viewer Cancel → toast with the 403 title; rule PATCH → 403, reread unchanged | unit, integration, e2e | access unit; `authz.int.test.ts` denial table; e2e | local |
| BR-5 | Viewer opens an active run → terminal "No access" | unit, integration, e2e | access unit; `terminal.int.test.ts`; e2e | local |
| BR-6 | Viewer PATCHes a random rule id → 403 | integration, e2e | `authz.int.test.ts`; e2e | local |
| BR-7 | A requests another org's project → 404 | e2e | e2e | local |
| BR-8 | Non-member 403, no session 401 (terminal 4403 / 4401) | integration | `authz.int.test.ts`, `auth.int`, `terminal.int.test.ts` | — |
| BR-9 | After the run finishes, V cancel → 403, A cancel → 409 | integration, e2e | `runs.int.test.ts`; e2e | local |
| BR-12 | The 403 problem title and requestId, no other-org or secret detail | integration, e2e | `authz.int.test.ts`; e2e (BR-4 toast) | local |
| BR-13 | B attaches to own run (B commented the trigger) | unit, integration, e2e | access unit; `terminal.int.test.ts`; e2e | local |
| BR-14 | B cancels own run | unit, integration, e2e | access unit; `runs.int.test.ts`; e2e | local |
| BR-16 | B's connection list → 403 | integration, e2e | `connections.int`; e2e | local |
| BR-17 | B's credential PUT → 403 | integration, e2e | `agents.int`; e2e | local |
| BR-18 | B's project create → 403 | integration, e2e | `projects.int`; e2e | local |
| BR-33 | B's rule PATCH → 403; settings, agent, skills, setup script, setup test denied per area | integration, e2e | `projects.int`, `agents.int`, `rules.int`, `skills.int`, `setup-script.int`, `setup-tests.int`; e2e | local |
| BR-48 | B on C's run: terminal "No access" | unit, integration, e2e | access unit; `terminal.int.test.ts`; e2e | local |
| BR-49 | B on C's run: cancel 403, run unchanged | unit, integration, e2e | access unit; `runs.int.test.ts`; e2e | local |
| BR-66 | Ownerless run: member 403 / 4403, admin allowed | unit, integration | access unit; `runs.int.test.ts`, `terminal.int.test.ts`, `upgrade.int.test.ts` | — |
| BR-68 | B clicks poll now on P1 → the poll runs (a queued comment is picked up); V's poll now → 403 | integration, e2e | `runs.int.test.ts`; e2e | local |
| BR-27 | A's list shows P1 only; B's P1 and P2; list `total` matches | integration, e2e | `scope.int.test.ts`; e2e | local |
| BR-28 | A opens P2's URL → not-found; P2 run terminal → "No access"; every project-scoped route key 404 out of scope | integration, e2e | `scope.int.test.ts`, `sse.int.test.ts`; e2e | local |
| BR-29 | A changes P1 settings and rule, controls C's run, 403 on project create | unit, integration, e2e | access unit; per-area int files; e2e | local |
| BR-30 | B reads C's run in P1, cannot cancel it (403), sees no third project | unit, e2e | access unit; e2e | local |
| BR-31 | V, also admin on P1, changes P1 and gets 403 on a P2 rule | unit, e2e | access unit; e2e | local |
| BR-42 | A's connection list → 403 | integration, e2e | `scope.int.test.ts`; e2e | local |
| BR-44 | Owner deletes P2 → B's list drops it, B still sees P1 | integration, e2e | `scope.int.test.ts`; e2e | local |
| BR-32 | Upgraded user: 403 everywhere and terminal "No access" until granted, then old data unchanged; e2e form: C's grant revoked → member with no grant gets 403 on the project list and every other endpoint (the web shows its existing no-access state), terminal "No access"; platform admin grants P2 → C sees P2 only | integration, e2e | `upgrade.int.test.ts`; e2e | local |
| BR-26 | Ticket source refuses the commenter → no run (unchanged) | unit, integration | routing unit; `webhooks.int.test.ts` | — |
| BR-50 | B (linked fake identity) comments a trigger → run owned by B, by webhook and by polling | unit, integration, e2e | routing unit; `webhooks.int.test.ts`; worker int; e2e | local |
| BR-51 | V comments a trigger → no run, ignored list "no permission", no Temporal start | unit, integration, e2e | routing unit; `webhooks.int.test.ts`; worker int; e2e | local |
| BR-52 | Unlinked fake author comments → no run, ignored list "not linked" | unit, integration, e2e | routing unit; `webhooks.int.test.ts`; worker int; e2e | local |
| BR-53 | The dev fake comment route posts as the bot from B's run in P1 → follow-up run in P1 owned by B | unit, integration, e2e | routing unit; `webhooks.int.test.ts`; worker int; e2e | local |
| BR-71 | Bot trigger with no origin run, and bot trigger from a P1 run onto a P2 ticket → no run, "not linked"; ownerless origin → no run | unit, integration, e2e | routing unit; `webhooks.int.test.ts`; e2e (no origin, other project) | local (ownerless-origin case under "Not provable by e2e") |
| BR-72 | B's grant on P1 revoked, then the bot posts a trigger from B's earlier P1 run → no run, "no permission" | unit, integration, e2e | routing unit; `webhooks.int.test.ts`; e2e | local |
| BR-34 | Platform admin grant (through `/api/platform/*`) applies on the next request | integration, e2e | `assignments.int.test.ts`; e2e | local |
| BR-35 | Revoke closes A's open P1 terminal; A, still holding another assignment, gets 404 on P1; a user whose only assignment was revoked gets 403 (the BR-32 e2e step); the stream keeps running, reconnect 404 | integration, e2e | `assignments.int.test.ts`, `terminal.int.test.ts`, `sse.int.test.ts`; e2e (terminal part) | local (stream part under "Not provable by e2e") |
| BR-36 | B grant attempt → 403; A grant on P2 → 403 | integration, e2e | `assignments.int.test.ts`; e2e | local |
| BR-37 | Grant validation 400 / 404 / 422 with problem pointers | contract, integration | contract unit; `assignments.int.test.ts` | — |
| BR-41 | Same grant twice → one assignment | integration, e2e | `assignments.int.test.ts`; e2e | local |
| BR-45 | Org owner grants viewer to a member → applies; org owner grants `owner` to A through the tenant route → 201 and A's next request has owner access; org admin granting or revoking `owner` → 403 and nothing changes; platform admin grants `owner` through `/api/platform/*` → 201 | integration, e2e | `assignments.int.test.ts` (named test); e2e | local |
| BR-46 | Org owner revoking the last owner through the tenant route → 409 (an org admin gets 403, BR-45); platform admin can through `/api/platform/*` | integration, e2e | `assignments.int.test.ts`; e2e | local |
| BR-61 | A grants member on P1 (works), on P2 (403) | integration, e2e | `assignments.int.test.ts`; e2e | local |
| BR-63 | C's `GET /api/me/access` before and after the grant (200, empty before) | integration, e2e | `assignments.int.test.ts`; e2e | local |
| BR-64 | Owner lists all assignments; A lists P1's; B → 403 | integration, e2e | `assignments.int.test.ts`; e2e | local |
| BR-38 | Platform admin with no assignment calls the org's tenant routes (project list, `/api/orgs/:orgId/members`, invitations, assignments) → refused; the same data through `/api/platform/*` answers | integration, e2e | `authz.int.test.ts` denial table; `platform.int.test.ts`; e2e | local |
| BR-39 | Config email removed → next platform call 403 | integration | `platform.int.test.ts` (config override) | — |
| BR-40 | Platform admin lists orgs, members, projects: ids, names, roles, scopes only | integration, e2e | `platform.int.test.ts`; e2e | local |
| BR-69 | Platform admin creates the org with name and slug (built-in roles copied, no members), invites the owner, owner signs in; a second create with the same slug → 409; the default slug comes from the name and an edited slug is accepted | integration, e2e | `platform.int.test.ts`; e2e (the spec's setup) | local |
| BR-70 | The org owner and A call org creation → 403; non-platform callers are refused on every `/api/platform/*` route | integration, e2e | `platform.int.test.ts`, `authz.int.test.ts` denial table; e2e | local |
| BR-73 | Missing name or slug, over-long name, bad slug format → 400 with pointers | contract, integration | contract unit; `platform.int.test.ts` | — |
| BR-62 | Config email signs up without an invitation | integration | `platform.int.test.ts` (fresh DB) | — |
| BR-54 | Uninvited handle's dev-login refused, no account | integration, e2e | `invitations.int.test.ts` (hook through `auth.api`); e2e | local |
| BR-55 | Invited new handle signs in and lands in the org with its scope; B's single invitation for P1 and P2 gives one assignment per project | integration, e2e | `invitations.int.test.ts`; e2e | local |
| BR-56 | B, invited to a second org, joins it on next sign-in | integration, e2e | `invitations.int.test.ts`; e2e | local |
| BR-57 | Invitation past 7 days not applied, listed as expired, revoke → 409 | integration | `invitations.int.test.ts` (past `expires_at` or injected Clock) | — |
| BR-58 | Revoked invitation's handle cannot sign up; revoking again → 409 | integration, e2e | `invitations.int.test.ts`; e2e | local |
| BR-59 | Invitation validation 400 / 422 / 409 | contract, integration | contract unit; `invitations.int.test.ts` | — |
| BR-60 | A invites to P1 (works), to org scope (403); B invites → 403; project admins invite only admin, member or viewer on their own projects | integration, e2e | `invitations.int.test.ts`; e2e | local |
| — | N1 seed: every existing org gets the built-in roles once; a platform-created org gets them; rerun adds nothing; every seeded name parses; every `routeAccess` permission is granted by at least one built-in role; `own` only on ownable permissions | integration | `packages/db/test/migrate.int.test.ts`, `platform.int.test.ts` | — |
| — | N2 roles are data: editing org A's role rows changes A's holders only; a grant naming org B's role id is refused | integration | `authz.int.test.ts` | — |
| — | N3 deny by default: every registered route, SSE, terminal socket and `/dev/*` has an access rule or is public; `routeAccess` covers every route key | contract, integration | contract unit (typecheck plus a test); `authz.int.test.ts` route discovery | — |
| — | N4 no side effect on denial: no row, no secret in `MemorySecretStore`, no Temporal start or signal, no audit row | integration | `authz.int.test.ts` | — |
| — | N5 audit rows for grant, revoke, invitation create/revoke/accept and org create: actor, target user, role and scope before and after (no "from" on a new grant, no "to" on a revoke), same transaction | integration | `assignments.int.test.ts`, `invitations.int.test.ts`, `platform.int.test.ts` | — |
| — | N6 the origin run comes only from stored run records: a human-authored comment never inherits an origin run's owner, whatever its text | integration | `webhooks.int.test.ts` | — |
| — | N7 unknown permission names grant nothing (warn) | unit | access unit | — |
| — | N8 the invitation lookup function returns ids only, pending and unexpired only | integration | `packages/db/test/functions.int.test.ts` | — |
| — | N9 dev-login is absent in production and obeys the sign-up gate | integration | `platform.int.test.ts` | — |
| — | Platform split: every `/api/platform/*` route is `scope:'platform'` with a `platform-*` permission and no other route is; no tenant role row holds a `platform-*` permission; a platform admin who is also a member gets exactly their tenant grants on tenant routes; granting `owner` and removing the last owner follow the per-route rules above (BR-45, BR-46); platform responses parse with the platform DTOs (email in `PlatformMemberDto`, none in `MemberDto`); platform audit rows carry `actorKind: 'platform_admin'` | contract, integration | contract unit (route table); `authz.int.test.ts`; `platform.int.test.ts`; `packages/db/test/migrate.int.test.ts` | — |
| — | `redactBody` on audit and invitation payloads: no value, token, secret or password key survives | integration | `auth.int`, `assignments.int.test.ts`, `invitations.int.test.ts` | — |

The access unit tests use `it.each` over made-up and built-in role fixtures, with the expected table written in the test (never read back from the seed): union, org vs project scope, a project created later, an org-level permission at project scope, own / someone else's / ownerless run. The resolver unit table and the denial table also cover the confirmed `member:*`, `org:update` and `org:delete` cells.

### Not provable by e2e

- BR-8: unchanged by this slice (non-member and no-session paths); API int `auth.int`, `terminal.int.test.ts`, `authz.int.test.ts`.
- BR-26: unchanged association check; routing unit and `webhooks.int.test.ts`.
- BR-37, BR-59: request validation (400 / 422 / 409) with no path beyond the API; contract unit and API int with problem pointers.
- BR-39: removing an email from config needs an API restart with a different env, which a shared stack cannot do; API int with a config override.
- BR-57: a 7-day expiry is a multi-day timer; API int with `expires_at` in the past or an injected Clock.
- BR-62: the first platform-admin sign-in happens once per stack (the configured email); API int on a fresh DB.
- BR-66: ownerless runs come only from before the upgrade (unmatched backfill); no product path creates one; API int and `upgrade.int.test.ts`.
- BR-71, ownerless origin run: ownerless runs come only from before the upgrade; no product path creates one; routing unit and `webhooks.int.test.ts` with a run whose owner is null.
- BR-73: request validation (name and slug required, length limits, slug format) with no path beyond the API; contract unit and `platform.int.test.ts` (400 with pointers). A taken slug (409) is covered by the BR-69 e2e step.
- BR-35, stream part: "an open stream keeps running" needs a timed browser wait; `sse.int.test.ts`.
- N1 to N9, the platform-split checks and the `redactBody` check: no user path or read route; db, API, contract or unit tests as in the table.

### Fakes and fixtures

- Existing fakes cover every outside call (`testing.md` §4): fake provider (`FakeStore`), file-backed `FakeKubeGateway`, `FakeTemporalClient`, the worker time-skipping env, `MemorySecretStore`. GitHub OAuth is never called: the sign-up gate is tested on the better-auth hook. No new fake class.
- The fake provider gains a linked identity per dev user: dev-login is kept (dev-only, absent in production) and obeys the sign-up gate; it signs in the configured platform admin or an invited handle, creates no personal org, marks the email verified and links a `fake` identity with the same handle.
- API int helpers in `apps/api/test/helpers/auth.ts` (new): `asPlatformAdmin(t)`, `createOrg(t, name, slug)` (real `/api/platform/*` endpoint, roles copied; platform-side invite and grant also go through `/api/platform/*`), `inviteAndLogin(t, orgId, handle, roleKey, scope)` (real invitation, then dev-login), `grant(t, ...)` and `revoke(t, ...)` (real endpoints). Each existing api int file replaces `loginAs` plus raw member SQL with `createOrg` plus `inviteAndLogin(..., 'owner', org)` in `beforeAll` (one helper change per file, `testing.md` §3 real path).
- Local e2e helpers in `apps/web/e2e/local/helpers.ts` (new; platform helpers call `/api/platform/*`, tenant helpers `/api/orgs/:orgId/*`): `asPlatformAdmin(page)`, `createOrg`, `inviteAndSignIn(page, org, role, scope)`, `grant`, `revoke`; `signInAndCreateProject` starts from `createOrg` plus an owner invitation; `scripts/e2e-local.ts` `setup` does the same.
- Off-list data (unknown permission names, foreign role ids, ownerless runs) only through direct DB writes in API int tests.
- `packages/db/test/helpers/seed.ts` seeds per-org role rows, two projects, assignments and an invitation per org for the leak tests.
- Every new contracts route gets an MSW handler and a DTO fixture parsed with its schema (`apps/web/src/mocks/msw/contract.test.ts`).
- A migrate-to-a-point helper (a temp copy of `migrations/` with a trimmed `meta/_journal.json`) exported from `@agentdesk/db/testing` (already outside coverage) for `upgrade.int.test.ts`.
- A bot-comment fixture in the fake provider (author = the bot login, with the origin run found by the desk-side match) for core, intake and local e2e tests.

### Security tests

- Cross-org: 404 (terminal 4403) unchanged; RLS leak tests on `roles`, `role_permissions`, `role_assignments`, `invitations`; the invitation lookup definer returns ids only, pending and unexpired only.
- Cross-project: out-of-scope rows are absent from lists, totals and SSE at connect; gets and writes 404; terminal 4403.
- Authz per endpoint: route discovery and the denial table, including SSE, both terminals, `/dev/*`, platform and org-admin routes; a caller holding the permission nowhere gets 403 for any id.
- Ownership: a member cannot control or attach someone else's or an ownerless run.
- Trigger: unlinked, unpermitted and out-of-scope commenters start nothing; a bot follow-up inherits only from the stored origin record in the same project (a human comment's text gains nothing); an origin owner who lost access starts nothing.
- Escalation: grants and invitations are limited to the granter's scope; an admin never touches `owner`; a project admin never invites to org scope or to a project they do not administer; no tenant route sets platform admin; foreign role ids are refused; the last owner is kept.
- Invite-only: an uninvited sign-up is refused with no user row; an invitation is bound to its verified email; an expired or revoked invitation does nothing.
- Platform admin: a separate `/api/platform/*` set; refused on every tenant route, including `/api/orgs/:orgId/*`, without an assignment; config removal denies on the next call.
- Dev-only: dev-login and `/dev/*` answer 404 in production config.
- No side effect on denial. Webhook signature tests are unchanged. Audit and invitation payloads hold ids, emails, role keys and scopes only; `redactBody` applies to them; ticket-source author text stays data (AGENTS rule 6).

### Coverage risks

- contracts 100% lines: the permission enum, `routeAccess`, `can()` and the slug-from-name helper are fully hit.
- Sensitive groups auth 90/72, terminal 90/77, webhooks 90/75: the guard, sign-up gate, invitation acceptance, terminal ownership and scope, and intake owner and bot-origin checks each have a named test per deny branch.
- core 86.8/73.1: `packages/core/src/access/` and routing decisions are covered by unit tables.
- api 92.8/78.8: new services are covered by their int files; the denial and scope tables hit each 403 and 404 branch.
- worker 70.8/60.2: the poll activity owner check is covered by its int test.
- tenancy 89/85: if `functions.ts` gains the invitation lookup wrapper, `functions.int.test.ts` covers each branch.
- Effort risk: every api int file and every local e2e changes its setup; done through the shared helpers.
- No threshold or baseline is lowered (`testing.md` §10).

## Agent calls

- Agent call: a scope is the org or one project; "member on P1 and P2" is two assignments (business: aligns with the architecture data model).
- Agent call: "Project Admin" is the `admin` role granted on a project scope, with no separate row (business: roles stay scope-agnostic, permission proposal §1).
- Agent call: `owner` can be granted only on the org scope (business: as in the approved permission proposal's roles table).
- Agent call: org name 1 to 100 characters; slug in today's slug alphabet (lowercase `a-z`, `0-9`, `-`, no leading or trailing `-`), 1 to 63 characters; a bad name or slug is 400 (business: reuses `apps/api/src/auth/slug.ts`).
- Agent call: contracts exports the slug-from-name helper so web and api share it (architecture: a pure function in a zod-only package).
- Agent call: assignments add up (union); nothing restricts (business: the human's examples only add).
- Agent call: member does not get `setup:test` or `connection:read` (business: operator on own runs, not a configurer, T2).
- Agent call: `project:delete` counts only from an org-scope grant (business: deleting removes the project's runs and history; an org decision).
- Agent call: "own run" means the run's owner is the caller; setup tests are owned by whoever started them, so members own none (business: no reason stated).
- Agent call: a run with no owner can be controlled and attached only by admin and above (business: no reason stated).
- Agent call: poll now needs `run:create`; every run it starts still checks its own owner (business: permission proposal route map).
- Agent call: platform admins come from deployment config listing verified sign-in emails, checked on each request; removing an email revokes; no API grants it (business: epic §7.5 "config/seed, not self-service").
- Agent call: a config-listed email may sign up without an invitation (business: otherwise no first admin can exist on a fresh deploy).
- Agent call: platform admin can list orgs, an org's members with assignments and project ids and names, and grant, revoke and invite in any org; no other tenant data unless they hold an assignment there; a self-grant is audited (business: epic G4).
- Agent call: the existing ticket-source author check still applies first; both checks must pass (business: `security.md` §5 is a MUST; architecture: removing an existing control needs its own review).
- Agent call: "maps to a user" = the Agent Desk user who signed in with the same account at the ticket source's provider (business: no other link exists in this slice).
- Agent call: permission is checked when the run starts; a started run keeps going if its owner loses access; worker actions need no owner check (business: they are system work on an existing run).
- Agent call: `GET /api/me/access` answers 200 with an empty result for a user with no assignment, the only exception to "403 on every endpoint" (business and architecture: the web can tell "no access yet" from an error; it reads only the caller's own data, not org data).
- Agent call: `projects.created_by` and `member.role` decide nothing (business: no reason stated).
- Agent call: removing the last owner assignment is 409 on tenant routes, even for an org owner, and allowed on platform routes (business: orgs start with no owner after deploy).
- Agent call: an org admin cannot grant, change or revoke `owner`; a project admin grants or revokes only `admin`, `member`, `viewer` on their own project (business: no reason stated).
- Agent call: invitation states pending → accepted / revoked / expired, all three final (business: epic §9 email-bound invitations).
- Agent call: a body failing the schema is 400; a well-formed role id not in the org, or a role on a scope it does not allow (`owner` on a project), is 422 with pointer `/roleId` (business and architecture: HTTP best practice and `backend.md` §4, 422 for a semantically invalid reference; the human delegated status codes to best practice).
- Agent call: project id not in that org → 422 with a pointer (business: `backend.md` §4).
- Agent call: unknown org → 404 (business and architecture: a path resource).
- Agent call: an unknown user, or a user who is not a member of the org, in a grant body → 422 with pointer `/userId`, the same answer for both (architecture: `backend.md` §4, 422 for an invalid body reference, and it never tells whether a user exists in another org; the human left the 404-or-422 choice to the spec writer and did not discuss it further).
- Agent call: invitation project list: empty list or malformed body 400; duplicates collapse; a project not in the org 422; a project admin listing a project they do not administer 403 (business: HTTP best practice and `backend.md` §4).
- Agent call: invitation `projectIds` holds 1 to 100 ids (architecture: no reason stated).
- Agent call: lists show each invitation's status including expired; revoking a non-pending invitation is 409; a sign-in whose only invitation is expired is refused like one with none (business: HTTP best practice, 409 for a state conflict).
- Agent call: expired invitations are computed from `expires_at` and stored lazily; no sweep job (architecture: a Temporal Schedule for this alone is not worth it; the computed status is always right).
- Agent call: email must be a valid address, at most 254 characters, compared case-insensitively (business: no reason stated).
- Agent call: invitation for an existing member → 409 (grant instead); second pending invitation for the same email in the same org → 409 (business: revoke first).
- Agent call: invitation expires 7 days after creation, as a constant with no env (business: long enough to sign in, short enough not to linger; architecture: constant).
- Agent call: repeating an existing grant succeeds and leaves one assignment (business: safe retry).
- Agent call: no count or rate limit on these endpoints (business: only admins call them).
- Agent call: an out-of-scope project in the same org counts as missing: 404, left out of lists, terminal 4403; own-run violations are 403 (business and architecture: the run is visible in scope, the action is not allowed).
- Agent call: the permission is checked before the target is looked up: a caller holding it nowhere in the org gets 403 for any id or body; holding it somewhere, an out-of-scope target is 404 and an in-scope forbidden one 403 (business and architecture: HTTP best practice, authorize the action before looking up the resource, so nothing about the target leaks).
- Agent call: HTTP uses current assignments on every request (business: no reason stated).
- Agent call: a deleted project drops out of every scope; the assignment keeps its other projects (business: no reason stated).
- Agent call: pending invitations from several orgs for one email are all accepted at sign-in (business: no reason stated).
- Agent call: an existing user with a pending invitation joins that org when they next sign in (business: no reason stated).
- Agent call: after sign-in a user whose only org is the one they were invited to starts in that org (business: no reason stated).
- Agent call: if the writing run's owner lost `run:create` on that project, the bot-written trigger starts nothing and shows "no permission" (business: same check as any commenter).
- Agent call: ownership passes down a chain; the existing max-runs-per-ticket and one-active-run guards are the only loop limits (business: no new limit stated).
- Agent call: platform endpoints are outside any org and need platform admin (403 otherwise); platform admin alone gives no tenant data (business: epic G4).
- Agent call: dev-only `/dev/*` routes stay session-only; a fake comment they post still goes through the trigger owner check (business: dev-only, absent in production).
- Agent call: personal orgs are no longer created for new people; existing personal orgs stay (business and architecture: sign-up needs an invitation, T1).
- Agent call: org creation, grant, revoke and invitation create, revoke and accept write an org audit entry; the deploy writes none (business and architecture: the requirement asks for audit of role changes).
- Agent call: audit payload: columns `actor_user_id`, `action`, `target_type`, `target_id`; `from` and `to` objects with role id, role key and scope; events `assignment.granted|revoked`, `invitation.created|revoked|expired|accepted`, `org.created`, written in the same transaction (architecture: grants are additive, so an entry never has both `from` and `to`).
- Agent call: no separate audit row per triggered run; the run's owner and trigger source are the record (business and architecture: refused triggers are already in the ignored list).
- Agent call: assignments do not expire; revoke deletes; history is the audit entries (business: no reason stated).
- Agent call: a refused trigger posts no comment on the ticket (business: same as today's refused triggers).
- Agent call: no email is sent for an invitation (business: no sender exists; the inviter tells the person; matched by email at sign-in).
- Agent call: ownership is a condition (`any` | `own`) on a grant line, not a new permission name; `own` only for `run:update`, `run:cancel`, `terminal:attach` (architecture: keeps shape D's names and lets later admin-defined roles pick own or any per line).
- Agent call: built-in roles live as seeded global template rows copied into each org (architecture: the seed is data per the human's correction, and new orgs copy from data, not code constants; documented `org_id` exception in the ADR).
- Agent call: no CHECK on `permission` and no permissions table; unknown names are ignored with a warn; a migrate test checks the seed (architecture: contracts `Permission` is the one catalog).
- Agent call: invitations get their own table, not better-auth's `invitation` (architecture: a per-org role id and project scope do not fit the plugin's single role string, and its accept route would write `member.role`; departs from epic §9, recorded in the ADR).
- Agent call: `runs.origin_run_id` has no backfill (architecture: guessing the origin of older bot-triggered runs after the fact is not reliable; they stay owner-less).
- Agent call: best-effort backfill of `runs.owner_user_id` from linked accounts (architecture: members can then control their own older runs once granted).
- Agent call: one global guard, the extended `SessionGuard` (architecture: no reason stated).
- Agent call: endpoint shapes as in the API table (architecture: contracts first; no further reason stated).
- Agent call: tenant grant service rules: grantor holds `assignment:create` at the target scope; the role's lines must be a subset of the grantor's own at that scope; `owner` only by an org owner (architecture: no escalation, T3).
- Agent call: every config-listed platform admin holds all `platform-*` permissions; no platform roles in this slice (architecture: each platform route declares what it needs, and platform roles can come later without renaming).
- Agent call: platform DTOs are their own schemas, and `PlatformMemberDto` carries the email (architecture: the two views can diverge; the platform admin needs the email to identify people).
- Agent call: tenant and platform controllers call the same services with an explicit actor (architecture: one code path, two route sets, two DTO sets).
- Agent call: the tenant invitation route's coarse guard is "`member:create` or `assignment:create` somewhere in the org"; the service does the exact per-project check (architecture: lets project admins reach the service check).
- Agent call: an invitation whose listed projects were all deleted is still accepted (membership only) (architecture: the person can sign in and be granted later).
- Agent call: org creation and the first owner's invitation are two calls, not one combined endpoint (architecture: each stays small; the invitation path is reused).
- Agent call: `ensurePersonalOrg` is no longer called for new users (architecture: no self sign-up, T1).
- Agent call: router order command → association → owner linked → owner holds `run:create` → rule matching (architecture: removing the existing association control needs its own review).
- Agent call: the bot comment's origin run is matched on the desk side by project, ticket and comment time, with no runner or prompt change (architecture: a signed marker depends on the model complying, needs a runner change and can be copied).
- Agent call: better-auth access-control and invitation plugins are not used; the plugin stays for orgs and membership (architecture: no project scope, single org role string).
- Agent call: ADR `docs/adr/0031-scoped-rbac-roles-assignments.md`, amending ADR-0014 and ADR-0013 (architecture: an architectural choice needs an ADR).
- Agent call: access unit tests use `it.each` over made-up and built-in role fixtures with the expected table written in the test (testing: never read back from the seed).
- Agent call: one local e2e spec, `apps/web/e2e/local/rbac.spec.ts`, set up through real APIs with the cast A, B, C, V (testing: every rule crosses API, intake, worker, SSE and terminal).
- Agent call: dev-login is kept (dev-only), obeys the sign-up gate, creates no personal org, marks the email verified and links a `fake` identity (testing and architecture: local platform-admin and invitation flows need it).
- Agent call: API int helpers `asPlatformAdmin`, `createOrg`, `inviteAndLogin`, `grant`, `revoke` replace `loginAs` plus raw member SQL (testing: `testing.md` §3 real path).
- Agent call: local e2e helpers `asPlatformAdmin`, `createOrg`, `inviteAndSignIn`, `grant`, `revoke`; `signInAndCreateProject` and `scripts/e2e-local.ts` start from an org and owner invitation (testing: every local e2e breaks under invite-only otherwise).
- Agent call: a migrate-to-a-point helper exported from `@agentdesk/db/testing` for `upgrade.int.test.ts` (testing: T9 needs Postgres at 0021 before the new migrations).
- Agent call: a bot-comment fixture in the fake provider (testing: core, intake and local e2e need a bot-authored trigger).

## Open questions

- None.

## E2E requirements

These rules are requirements. Each is what a user can see at the API, including the sign-in flow, the terminal WebSocket, SSE streams and ticket-source comments (no UI in this slice, T8); the feature is done when every case below passes as an e2e spec. Derived from this spec's business rules, not from the code. No sibling source is cited by the rules.

### Rules

Surface: API, including the sign-in flow, the terminal WebSocket, SSE streams and ticket-source comments (no UI in this slice, T8; the sign-in flow and ticket comments are the outside interfaces that also change).

| Id    | Category         | Rule | Source |
| ----- | ---------------- | ---- | ------ |
| BR-1  | permission       | When a user holds `owner` on the org, they can do every action on every project and org endpoint. | spec § Business rules > Rules |
| BR-2  | permission       | When a user holds `admin` on the org, they can do everything an owner can except grant, change or revoke `owner`. | spec § Business rules > Rules |
| BR-3  | permission       | When a user holds `viewer` on the org, they get every project's data and event streams. | spec § Business rules > Rules |
| BR-4  | permission       | When a viewer calls any write endpoint, they get 403 and a reload shows nothing changed. | spec § Business rules > Rules |
| BR-5  | permission       | When a viewer opens a run or setup-test terminal, it closes 4403 before any terminal bytes. | spec § Business rules > Rules |
| BR-6  | permission       | When a caller holds the needed permission nowhere in the org, any target id or body gives 403, not 404 or 400. | spec § Business rules > Rules |
| BR-7  | permission       | When a caller who may do the action targets a missing or other-org resource, they get 404 (terminal 4403). | spec § Business rules > Rules |
| BR-8  | permission       | When a signed-in user is not a member of the active org, every endpoint gives 403 (terminal 4403); no session gives 401 (terminal 4401). | spec § Business rules > Rules |
| BR-9  | state-transition | When a permitted caller cancels, stops, finishes or resumes a run in the wrong state, they get today's 409; a caller without the permission gets 403 whatever the state. | spec § Business rules > Rules |
| BR-12 | feedback-state   | When a request is refused for lack of permission, the 403 problem body says the action is not allowed and carries a requestId, with no other-org or secret detail. | spec § Business rules > Rules |
| BR-13 | permission       | When a member opens the terminal of an active run they own in scope, the attach succeeds. | spec § Business rules > Rules |
| BR-14 | permission       | When a member cancels, stops, finishes or resumes a run they own in scope, the action is accepted. | spec § Business rules > Rules |
| BR-16 | permission       | When a member lists, installs or syncs connections, they get 403. | spec § Business rules > Rules |
| BR-17 | permission       | When a member sets an agent credential, they get 403. | spec § Business rules > Rules |
| BR-18 | permission       | When a member creates or deletes a project, they get 403. | spec § Business rules > Rules |
| BR-33 | permission       | When a member edits project settings, agent, rules, skills, setup script or starts a setup test, they get 403. | spec § Business rules > Rules |
| BR-48 | permission       | When a member opens the terminal of a run someone else owns, it closes 4403. | spec § Business rules > Rules |
| BR-49 | permission       | When a member cancels, stops, finishes or resumes a run someone else owns, they get 403 and the run is unchanged. | spec § Business rules > Rules |
| BR-66 | permission       | When a run has no owner (started before the upgrade), a member gets 403 on its controls and 4403 on its terminal; an admin can. | spec § Business rules > Rules |
| BR-68 | permission       | When a member clicks poll now on a project in scope, the poll runs; a viewer gets 403. | spec § Business rules > Rules |
| BR-27 | permission       | When a user's assignments cover only some projects, the project list shows only those. | spec § Business rules > Rules |
| BR-28 | permission       | When a user requests a project outside their scope (project, runs, run by number, log, transcript, rules, skills, setup, agent, events stream), they get 404; its terminal closes 4403. | spec § Business rules > Rules |
| BR-29 | permission       | When a user is `admin` on P1 only, they can change P1's settings, agent, credential, rules, skills, setup script and setup tests and control any P1 run, and get 403 on project create, project delete and connections. | spec § Business rules > Rules |
| BR-30 | permission       | When a user is `member` on P1 and P2, they read every run in P1 and P2, control only their own, and see no other project. | spec § Business rules > Rules |
| BR-31 | permission       | When a user holds `viewer` on the org and `admin` on P1, they can change P1 and only read every other project. | spec § Business rules > Rules |
| BR-42 | permission       | When a user has only project-scoped assignments, connection list and repo list give 403. | spec § Business rules > Rules |
| BR-44 | permission       | When a project in a user's scope is deleted, it leaves their list and the assignment keeps its other projects. | spec § Business rules > Rules |
| BR-32 | persistence      | When a user who existed before the upgrade signs in after it, every endpoint in their org, the project list included, gives 403 and terminals close 4403 until someone grants them an assignment; then their old projects and runs are there unchanged. | spec § Business rules > Rules |
| BR-26 | permission       | When the ticket source does not mark the commenter as allowed, no run starts (unchanged). | spec § Business rules > Rules |
| BR-50 | side-effect      | When a commenter linked to an Agent Desk user who holds `run:create` on the project posts a trigger command, a run starts and shows that user as its owner. | spec § Business rules > Rules |
| BR-51 | side-effect      | When a linked commenter lacks `run:create` on that project (viewer, out of scope, no assignment), no run starts and the project's ignored list shows a "no permission" outcome. | spec § Business rules > Rules |
| BR-52 | side-effect      | When the commenter is not linked to any Agent Desk user, no run starts and the ignored list shows a "not linked" outcome. | spec § Business rules > Rules |
| BR-53 | side-effect      | When a run's agent writes a trigger command on a ticket and that run's owner holds `run:create` on the target project, a new run starts and shows the same owner. | spec § Business rules > Rules |
| BR-71 | side-effect      | When a bot-written trigger comes from a run in another project, from a run with no owner, or cannot be tied to a run, no run starts and the ignored list shows "not linked". | spec § Business rules > Rules |
| BR-72 | side-effect      | When a bot-written trigger comes from a run whose owner no longer holds `run:create` on the target project, no run starts and the ignored list shows "no permission". | spec § Business rules > Rules |
| BR-34 | permission       | When a platform admin grants a member a role on a scope in an org, that user's next request follows it. | spec § Business rules > Rules |
| BR-35 | permission       | When an assignment is revoked and the user still holds another assignment in the org, their next request no longer sees the projects it covered (404); when they now hold nothing in the org, their next request gets 403; in both cases their open terminal closes 4403 on the re-check, and an open event stream keeps running until it reconnects. | spec § Business rules > Rules |
| BR-36 | permission       | When a member, a viewer, or a project admin acting outside their project calls grant or revoke, they get 403. | spec § Business rules > Rules |
| BR-37 | validation       | (A grant covers the org or one project; invitations may list several, BR-59.) When a grant names a role not in the org, `owner` on a project scope or a project of another org, the caller gets 422; a malformed body, 400; an unknown org, 404; an unknown user or a user who is not a member of that org, 422 with pointer `/userId`. | spec § Business rules > Rules |
| BR-41 | persistence      | When the same grant is sent twice, the user has one assignment and the second call succeeds. | spec § Business rules > Rules |
| BR-45 | permission       | When an org owner or org-scope admin grants or revokes a non-owner role in their own org, it applies on the next request; an admin granting or revoking `owner` gets 403. | spec § Business rules > Rules |
| BR-46 | state-transition | When an org owner revokes the org's last owner assignment, they get 409; a platform admin can, on the platform routes. | spec § Business rules > Rules |
| BR-61 | permission       | When a project admin grants or revokes admin, member or viewer on their own project, it applies; on the org scope or another project, 403. | spec § Business rules > Rules |
| BR-63 | persistence      | When a signed-in user asks for their own access, they get their assignments and permissions in the active org (empty when they have none; the only endpoint that answers a user with no assignment). | spec § Business rules > Rules |
| BR-64 | permission       | When an org owner or admin lists assignments they see all in the org; a project admin sees their project's; a member or viewer gets 403. | spec § Business rules > Rules |
| BR-38 | permission       | When a platform admin with no assignment in an org calls that org's tenant endpoints, they get no data (403 / 404). | spec § Business rules > Rules |
| BR-39 | permission       | When a user's verified email is in the platform-admin config they can call platform endpoints; once removed, their next call gets 403. | spec § Business rules > Rules |
| BR-40 | permission       | When a platform admin lists orgs, an org's members with assignments, or an org's projects, they get ids, names, roles and scopes only. | spec § Business rules > Rules |
| BR-69 | side-effect      | When a platform admin creates an org with a name and a slug, the org exists with that slug, the built-in roles and no members, and the platform admin can invite its first owner into it. | spec § Business rules > Rules |
| BR-70 | permission       | When anyone who is not a platform admin calls org creation, they get 403. | spec § Business rules > Rules |
| BR-73 | validation       | When an org is created without a name or slug, with a name over 100 characters, or with a slug outside the slug format, it is refused with 400; with a slug another org already uses, 409. | spec § Business rules > Rules |
| BR-62 | permission       | When a person whose verified email is in the platform-admin config signs in for the first time without an invitation, the sign-up succeeds. | spec § Business rules > Rules |
| BR-54 | permission       | When a person with no account and no pending invitation signs in, the sign-up is refused and no account is created. | spec § Business rules > Rules |
| BR-55 | side-effect      | When an invited person signs in for the first time with the matching verified email, they become a member of that org with the invited role on the org or on each listed project, and see exactly those projects. | spec § Business rules > Rules |
| BR-56 | side-effect      | When an existing user with a pending invitation signs in, they join that org with the invited role on the org or on each listed project. | spec § Business rules > Rules |
| BR-57 | state-transition | When an invitation is older than 7 days, signing in does not apply it (a new person is refused), lists show it as expired, and revoking it gives 409. | spec § Business rules > Rules |
| BR-58 | state-transition | When an invitation was revoked, signing in does not apply it and revoking it again gives 409. | spec § Business rules > Rules |
| BR-59 | validation       | When an invitation has an invalid or over-long email or an empty project list, it is refused with 400; a role not in the org, `owner` on projects, or a project of another org gives 422; someone already a member or already invited in that org gives 409. | spec § Business rules > Rules |
| BR-60 | permission       | When someone creates, lists or revokes invitations, the same rights as grants apply (platform admin in any org; owner or admin in their own org, admin never `owner`; project admin only admin, member or viewer on projects they administer, any other listed project gives 403); anyone else gets 403. | spec § Business rules > Rules |

### Test cases

All cases run in env `local`: every rule with an e2e crosses API guards, intake, the poller, SSE, the terminal relay or the fake pod, and the spec has no `mock` spec (spec ## Testing). Routes are cited by the spec's route keys (for example `runs.cancel`) where the spec gives no path; new routes use the spec's API table. "Refused" with a status means the response status; "closes 4403" means the WebSocket closes with that code before any terminal bytes.

Cast, used in every Given and rebuilt fresh in a new org per case: org X created by platform admin PA (the dev config email) with `POST /api/platform/orgs`, first owner O invited through `POST /api/platform/orgs/:orgId/invitations` and signed in; O built projects P1 and P2; P1 has an active run RB owned by B and an active run RC owned by C; P2 has an active run RP2 owned by O; A = admin on P1; B = member on P1 and P2; C = member on P1; V = viewer on the org; D = admin on the org; all invited by email and signed in. A case that adds anything says so in its Given.

#### BR-1: Owner can do every action

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-1.1 | permission | local | Cast | 1. As O, `projects.create` a new project P4. 2. As O, `projects.remove` P4. | Both calls are accepted (2xx); P4 appears in O's project list after step 1 and is gone after step 2. |
| TC-1.2 | permission | local | Cast | 1. As O, `connections.list`. 2. As O, `connections.sync`. | Both calls are accepted (2xx), neither gives 403. |
| TC-1.3 | permission | local | Cast | 1. As O, `agents.putCredential` on P1. 2. As O, `rules.create` a rule on P1, then `rules.update` it, then `rules.remove` it. | Every call is accepted (2xx); the rule list of P1 shows the rule after create and not after remove. |
| TC-1.4 | permission | local | Cast | 1. As O, open the `runs.terminal` WebSocket of RC. 2. As O, `runs.cancel` RC. | The attach succeeds (socket stays open, not closed 4403); the cancel is accepted (2xx) and RC then shows as cancelled. |

#### BR-2: Org admin can do everything except `owner`

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-2.1 | permission | local | Cast | 1. As D, `projects.create` a project. 2. As D, `connections.sync`. 3. As D, `runs.cancel` RC. | All three are accepted (2xx). |
| TC-2.2 | permission | local | Cast | As D, `POST /api/orgs/:orgId/assignments` with `{userId: C, roleId: <owner role id>, scope: {type: 'org'}}`. | 403; C's `GET /api/me/access` still shows no `owner` assignment. |
| TC-2.3 | permission | local | Cast | As D, `DELETE /api/orgs/:orgId/assignments/:assignmentId` for O's org `owner` assignment. | 403; the assignments list still contains O's `owner` assignment. |
| TC-2.4 | permission | local | Cast | As D, `POST /api/orgs/:orgId/invitations` with `{email: <new email>, roleId: <owner role id>, scope: {type: 'org'}}`. | 403; the invitation list shows no new invitation. |

#### BR-3: Viewer reads every project's data and streams

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-3.1 | permission | local | Cast | As V: 1. `projects.list`. 2. `runs.list` on P1 and on P2. 3. `runs.get`, `runs.log` and `runs.transcript` for RB. | The list shows P1 and P2; every read returns 200 with the run data of both projects. |
| TC-3.2 | permission | local | Cast | 1. As V, connect to the `runs.events` stream of P1. 2. As O, finish RC. | The connect succeeds; V's open stream receives a frame for RC's status change. |
| TC-3.3 | permission | local | Cast | As V, connect to the `projects.events` stream of P2. | The connect succeeds (stream opens, no 403 or 404). |

#### BR-4: Viewer writes are refused and change nothing

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-4.1 | permission | local | Cast | 1. As V, `runs.cancel` RB. 2. Reread RB with `runs.get`. | 403; RB is still active. |
| TC-4.2 | permission | local | Cast; P1 has a rule R | 1. As V, `rules.update` (PATCH) R with a new body. 2. Reread the rule list of P1. | 403; R is unchanged. |
| TC-4.3 | permission | local | Cast | 1. As V, `projects.create`. 2. Reread `projects.list` as V. | 403; the list still shows exactly P1 and P2. |
| TC-4.4 | permission | local | Cast | 1. As V, `agents.put` on P1. 2. Reread `agents.get` on P1. | 403; the agent config is unchanged. |

#### BR-5: Viewer terminal closes 4403

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-5.1 | permission | local | Cast | As V, open the `runs.terminal` WebSocket of RB (active). | The socket closes 4403 and no terminal bytes were received before the close. |
| TC-5.2 | permission | local | Cast; O has started a setup test T on P1 | As V, open the `setupTests.terminal` WebSocket of T. | The socket closes 4403 and no terminal bytes were received. |

#### BR-6: No permission anywhere gives 403 for any id or body

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-6.1 | permission | local | Cast | As V, `rules.update` (PATCH) a random well-formed UUID rule id with a valid body. | 403, not 404. |
| TC-6.2 | permission | local | Cast | As V, `rules.update` a rule id that is not a UUID. | 403, not 404 or 400. |
| TC-6.3 | permission | local | Cast; P1 has a rule R | As V, `rules.update` R with a body that fails validation. | 403, not 400. |
| TC-6.4 | permission | local | Cast; another org Y has a project PY | As B, `agents.putCredential` for PY's id. | 403, not 404 (B holds `secret:update` nowhere). |

#### BR-7: Missing or other-org resource gives 404 to a permitted caller

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-7.1 | negative | local | Cast; another org Y owned by someone else with project PY | As A, `projects.get` PY's id. | 404. |
| TC-7.2 | negative | local | Cast | As A, `rules.update` a random well-formed UUID rule id. | 404 (A holds `rule:update` on P1, so the permission passes and the target is missing). |
| TC-7.3 | negative | local | Cast; another org Y with project PY and an active run RY | As O, open the `runs.terminal` WebSocket of RY. | The socket closes 4403. |
| TC-7.4 | negative | local | Cast | As O, open the `runs.terminal` WebSocket for a random well-formed run id. | The socket closes 4403. |
| TC-7.5 | positive | local | Cast | As A, `projects.get` P1 (an existing in-scope project). | 200 with P1's data (the rule is not always on). |

#### BR-8: Not e2e

Not e2e: unchanged by this slice (non-member and no-session paths); proved by API int `auth.int`, `terminal.int.test.ts`, `authz.int.test.ts` (spec ## Testing).

#### BR-9: Wrong-state controls give 409; no permission gives 403

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-9.1 | permission | local | Cast; RC has finished | As V, `runs.cancel` RC. | 403 (not 409). |
| TC-9.2 | state | local | Cast; RC has finished | As A, `runs.cancel` RC. | 409. |
| TC-9.3 | state | local | Cast; RC has finished | As A, `runs.stop` RC. | 409. |
| TC-9.4 | state | local | Cast; RC is active | As A, `runs.resume` RC. | 409. |
| TC-9.5 | permission | local | Cast; RC is active | As V, `runs.resume` RC. | 403 (not 409). |
| TC-9.6 | state | local | Cast; RC has finished | As A, `runs.finish` RC. | 409. |

#### BR-12: The 403 body says not allowed, with a requestId

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-12.1 | permission | local | Cast | As V, `runs.cancel` RB; read the response body. | 403 problem body whose title says the action is not allowed ("not allowed for your role here") and which carries a requestId. |
| TC-12.2 | permission | local | Cast; another org Y with project PY and a secret-bearing agent credential | As V, `agents.putCredential` for PY's id; read the response body. | 403 with the same "not allowed" title and a requestId; the body names no org, project or secret of Y and contains no credential value. |
| TC-12.3 | feedback-state | local | Cast | As B, `connections.list`; read the response body. | 403 with a "not allowed" title and a requestId. |

#### BR-13: Member attaches to own run

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-13.1 | permission | local | Cast; RB is active and B posted its trigger comment | As B, open the `runs.terminal` WebSocket of RB. | The attach succeeds: the socket stays open and is not closed 4403. |

#### BR-14: Member controls own run

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-14.1 | permission | local | Cast; RB active | As B, `runs.cancel` RB. | Accepted (2xx); RB shows as cancelled. |
| TC-14.2 | permission | local | Cast; RB active | As B, `runs.stop` RB. | Accepted (2xx); RB shows as stopped. |
| TC-14.3 | permission | local | Cast; RB active | As B, `runs.finish` RB. | Accepted (2xx); RB shows as finished. |
| TC-14.4 | permission | local | Cast; RB stopped by B | As B, `runs.resume` RB. | Accepted (2xx); RB is active again. |

#### BR-16: Member connection routes refused

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-16.1 | permission | local | Cast | As B, `connections.list`. | 403. |
| TC-16.2 | permission | local | Cast | As B, `connections.install`. | 403. |
| TC-16.3 | permission | local | Cast | As B, `connections.sync`. | 403. |

#### BR-17: Member credential refused

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-17.1 | permission | local | Cast | As B, `agents.putCredential` on P1 with a credential value. | 403; the project agent settings read back unchanged and the response does not contain the value. |

#### BR-18: Member project create and delete refused

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-18.1 | permission | local | Cast | As B, `projects.create`. | 403; B's project list is unchanged. |
| TC-18.2 | permission | local | Cast | As B, `projects.remove` P1. | 403; P1 is still in B's list. |

#### BR-33: Member edits refused per area

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-33.1 | permission | local | Cast | As B, `projects.update` P1 settings. | 403; settings unchanged on reread. |
| TC-33.2 | permission | local | Cast | As B, `agents.put` on P1. | 403; agent unchanged on reread. |
| TC-33.3 | permission | local | Cast | As B, `rules.create` on P1. | 403; the rule list of P1 is unchanged. |
| TC-33.4 | permission | local | Cast; P1 has a rule R | As B, `rules.update` (PATCH) R. | 403; R unchanged on reread. |
| TC-33.5 | permission | local | Cast; P1 has a rule R | As B, `rules.remove` R. | 403; R is still in the rule list. |
| TC-33.6 | permission | local | Cast; P1 has a skill S | As B, `skills.put` on S and, separately, `skills.remove` S. | Both 403; S unchanged on reread. |
| TC-33.7 | permission | local | Cast | As B, `setupScript.put` on P1. | 403; the setup script is unchanged on reread. |
| TC-33.8 | permission | local | Cast | As B, `setupTests.create` on P1. | 403; no setup test is started. |
| TC-33.9 | boundary | local | Cast; P1 has a rule R | As B, `rules.list` on P1. | 200 with R in the list (read is allowed). |

#### BR-48: Member cannot attach to another's run

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-48.1 | permission | local | Cast; RC active, owned by C | As B, open the `runs.terminal` WebSocket of RC. | The socket closes 4403. |

#### BR-49: Member cannot control another's run

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-49.1 | permission | local | Cast; RC active, owned by C | 1. As B, `runs.cancel` RC. 2. Reread RC. | 403; RC is still active. |
| TC-49.2 | permission | local | Cast; RC active | 1. As B, `runs.stop` RC. 2. Reread RC. | 403; RC is still active. |
| TC-49.3 | permission | local | Cast; RC active | 1. As B, `runs.finish` RC. 2. Reread RC. | 403; RC is still active. |
| TC-49.4 | permission | local | Cast; RC stopped by C | 1. As B, `runs.resume` RC. 2. Reread RC. | 403; RC is still stopped. |

#### BR-66: Not e2e (ownerless runs)

Not e2e: ownerless runs come only from before the upgrade (unmatched backfill); no product path creates one; proved by API int `runs.int.test.ts`, `terminal.int.test.ts` and `upgrade.int.test.ts` (spec ## Testing).

#### BR-68: Poll now

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-68.1 | side-effect | local | Cast; a trigger comment by B's linked identity is queued on a P1 ticket and not yet polled | As B, `projects.pollNow` on P1. | Accepted (2xx); the queued comment is picked up and a run owned by B appears in P1's runs. |
| TC-68.2 | permission | local | Cast; a trigger comment by B's linked identity is queued on a P1 ticket | As V, `projects.pollNow` on P1. | 403; no new run appears in P1. |

#### BR-27: Project list shows only projects in scope

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-27.1 | permission | local | Cast | As A, `projects.list`. | Only P1; `total` is 1. |
| TC-27.2 | permission | local | Cast | As B, `projects.list`. | P1 and P2; `total` is 2. |
| TC-27.3 | boundary | local | Cast | As B, `projects.list` with a page size of 1, then the next page. | Each page has one project; `total` is 2 on both pages. |
| TC-27.4 | boundary | local | Cast | As V (org-wide viewer), `projects.list`. | P1 and P2; `total` is 2 (org scope covers all). |

#### BR-28: Out-of-scope project is 404, terminal 4403

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-28.1 | negative | local | Cast | As A, `projects.get` P2, then `runs.list` on P2. | Both 404. |
| TC-28.2 | negative | local | Cast | As A, `runs.byNumber` for RP2's number, `runs.log` RP2, `runs.transcript` RP2. | All 404. |
| TC-28.3 | negative | local | Cast | As A, `rules.list` and `skills.list` on P2. | Both 404. |
| TC-28.4 | negative | local | Cast | As A, `setupScript.get`, `setupTests.latest` and `agents.get` on P2. | All 404. |
| TC-28.5 | negative | local | Cast | As A, connect to the `projects.events` and `runs.events` streams of P2. | Both connects give 404; no stream opens. |
| TC-28.6 | negative | local | Cast | As A, open the `runs.terminal` WebSocket of RP2. | The socket closes 4403. |
| TC-28.7 | negative | local | Cast | As A, `agents.put` on P2. | 404 (A holds `agent:update` on P1, so permission passes and the project is out of scope). |

#### BR-29: Project admin on P1 only

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-29.1 | permission | local | Cast | As A: 1. `projects.update` P1. 2. `agents.put` on P1. 3. `agents.putCredential` on P1. | All accepted (2xx). |
| TC-29.2 | permission | local | Cast | As A: 1. `rules.create` on P1. 2. `skills.put` on P1. 3. `setupScript.put` on P1. 4. `setupTests.create` on P1. | All accepted (2xx). |
| TC-29.3 | permission | local | Cast | As A, `runs.cancel` RC (owned by C). | Accepted (2xx); RC shows as cancelled. |
| TC-29.4 | permission | local | Cast | As A, open the `runs.terminal` WebSocket of RC. | The attach succeeds (not closed 4403). |
| TC-29.5 | permission | local | Cast | As A, `projects.create`. | 403. |
| TC-29.6 | permission | local | Cast | As A, `projects.remove` P1. | 403; P1 is still in A's list. |
| TC-29.7 | permission | local | Cast | As A, `connections.list`. | 403. |

#### BR-30: Member on P1 and P2

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-30.1 | permission | local | Cast; O has also created project P3 | As B, `runs.get` RC (in P1) and `runs.list` on P2. | Both 200: B reads C's run and P2's runs. |
| TC-30.2 | permission | local | Cast | As B, `runs.cancel` RC. | 403; RC is still active. |
| TC-30.3 | permission | local | Cast; O has also created project P3 | As B, `projects.list`, then `projects.get` P3. | The list shows P1 and P2 only; the get gives 404. |

#### BR-31: Org viewer who is also admin on P1

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-31.1 | permission | local | Cast; O also grants V `admin` on P1 | As V, `rules.create` on P1. | Accepted (2xx). |
| TC-31.2 | permission | local | Cast; O also grants V `admin` on P1; P2 has a rule R2 | As V, `rules.update` R2 in P2. | 403 (V holds `rule:update` on P1, so the project is visible but not changeable). |
| TC-31.3 | permission | local | Cast; O also grants V `admin` on P1 | As V, `runs.list` on P2 and `runs.get` RP2. | Both 200 (read-only access to other projects stays). |

#### BR-42: Project-scoped only users refused on connections

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-42.1 | permission | local | Cast | As A, `connections.list`. | 403. |
| TC-42.2 | permission | local | Cast | As A, `connections.repos`. | 403. |

#### BR-44: Deleted project leaves scope

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-44.1 | persistence | local | Cast | 1. As O, `projects.remove` P2. 2. As B, `projects.list`. | The list shows P1 only; `total` is 1. |
| TC-44.2 | persistence | local | Cast | 1. As O, `projects.remove` P2. 2. As B, `GET /api/me/access`. | B's access still lists the assignment on P1 and no entry that names P2. |
| TC-44.3 | persistence | local | Cast | 1. As O, `projects.remove` P2. 2. As B, `runs.list` on P1. | 200; P1's runs are all still there. |

#### BR-32: Locked out until granted (invite-only form)

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-32.1 | persistence | local | Cast; O revokes C's assignment on P1 (C stays a member of X with none) | As C, `projects.list`. | 403 (not an empty list). |
| TC-32.2 | persistence | local | Same as TC-32.1 | As C, `runs.list` on P1 and `rules.list` on P1. | Both 403 (not 404). |
| TC-32.3 | persistence | local | Same as TC-32.1 | As C, open the `runs.terminal` WebSocket of RC. | The socket closes 4403. |
| TC-32.4 | persistence | local | Same as TC-32.1; P2 has a rule R2 | 1. As PA, `POST /api/platform/orgs/:orgId/assignments` granting C `member` on P2. 2. As C, `projects.list`, then `rules.list` on P2. | The list shows P2 only (not P1); R2 is present and unchanged; `projects.get` P1 gives 404. |

#### BR-26: Not e2e

Not e2e: unchanged association check; proved by routing unit and `webhooks.int.test.ts` (spec ## Testing).

#### BR-50: Linked commenter with `run:create` starts an owned run

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-50.1 | side-effect | local | Cast; B's fake-provider identity is linked to B; a P1 ticket with no run | 1. As B's identity, post the project's trigger command on the ticket through the webhook path. 2. As B, `runs.list` on P1. | A new run exists for the ticket and shows B as its owner. |
| TC-50.2 | side-effect | local | Same as TC-50.1 | 1. Queue B's trigger comment on the ticket without webhook delivery. 2. Trigger the poll (as `e2e-local.ts` does). 3. As B, `runs.list` on P1. | A new run exists and shows B as its owner. |

#### BR-51: Linked commenter without `run:create` starts nothing

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-51.1 | side-effect | local | Cast; V's identity is linked to V | 1. As V's identity, post the trigger command on a P1 ticket. 2. As O, read the `projects.ignored` list of P1 and `runs.list` of P1. | No new run; the ignored list shows an entry with a "no permission" outcome. |
| TC-51.2 | side-effect | local | Cast; A's identity is linked to A | 1. As A's identity, post the trigger command on a P2 ticket (A has no scope on P2). 2. As O, read P2's ignored list and runs. | No new run in P2; the ignored list shows a "no permission" outcome. |
| TC-51.3 | side-effect | local | Cast; O revokes C's assignment on P1; C's identity is linked | 1. As C's identity, post the trigger command on a P1 ticket. 2. As O, read P1's ignored list and runs. | No new run; the ignored list shows a "no permission" outcome. |
| TC-51.4 | side-effect | local | Cast; V's identity linked | 1. Queue V's trigger comment on a P1 ticket. 2. Trigger the poll. 3. As O, read P1's ignored list and runs. | Same as TC-51.1 on the polling path: no run, a "no permission" outcome. |

#### BR-52: Unlinked commenter starts nothing

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-52.1 | side-effect | local | Cast; a fake-provider author handle `e2e-<rand>` that no Agent Desk user signed in with | 1. As that author, post the trigger command on a P1 ticket (webhook path). 2. As O, read P1's ignored list and runs. | No new run; the ignored list shows a "not linked" outcome. |
| TC-52.2 | side-effect | local | Same as TC-52.1 | 1. Queue that author's trigger comment, then trigger the poll. 2. As O, read P1's ignored list and runs. | No new run; a "not linked" outcome appears. |

#### BR-53: Bot-written trigger inherits the owner

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-53.1 | side-effect | local | Cast; RB is active on a P1 ticket and is the only matching run | 1. Through the dev fake-comment route, post the trigger command on that ticket as the bot. 2. As B, `runs.list` on P1. | A follow-up run exists in P1 and shows B as its owner. |
| TC-53.2 | side-effect | local | Same as TC-53.1 | As B, `runs.cancel` the follow-up run. | Accepted (2xx). |

#### BR-71: Bot trigger without a single same-project origin starts nothing

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-71.1 | side-effect | local | Cast; no run in P1 is active on the ticket at comment time | 1. Through the dev fake-comment route, post the trigger command on a P1 ticket as the bot. 2. As O, read P1's ignored list and runs. | No new run; the ignored list shows a "not linked" outcome. |
| TC-71.2 | side-effect | local | Cast; RB is the only active run on a P1 ticket; a P2 ticket exists with no active P2 run on it | 1. Post the bot trigger command on the P2 ticket. 2. As O, read P2's ignored list and runs. | No new run in P2 (RB is in another project); the ignored list shows a "not linked" outcome. |

Not e2e (ownerless-origin part of BR-71): ownerless runs come only from before the upgrade; no product path creates one; proved by routing unit and `webhooks.int.test.ts` with a run whose owner is null (spec ## Testing).

#### BR-72: Bot trigger whose origin owner lost `run:create`

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-72.1 | side-effect | local | Cast; RB is active on a P1 ticket | 1. As O, revoke B's assignment on P1 (B keeps P2). 2. Post the bot trigger command on that ticket through the dev fake-comment route. 3. As O, read P1's ignored list and runs. | No new run; the ignored list shows a "no permission" outcome. |

#### BR-34: Platform admin grant applies on the next request

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-34.1 | permission | local | Cast; O revoked C's assignment (C is a member with none) | 1. As C, `projects.list` (403 before). 2. As PA, `POST /api/platform/orgs/:orgId/assignments` with `{userId: C, roleId: <member role id>, scope: {type: 'project', projectId: P2}}`. 3. As C, `projects.list` immediately. | Step 2 returns 201; step 3 shows P2 with no wait. |
| TC-34.2 | permission | local | Same as TC-34.1 | As PA, grant C `viewer` on the org, then as C `projects.list`. | 201; the list shows P1 and P2. |

#### BR-35: Revoke applies on next request and closes the terminal

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-35.1 | permission | local | Cast; A also holds `member` on P2 so A still holds permissions in the org; `TERMINAL_REAUTH_MS` set small | 1. As A, open the `runs.terminal` WebSocket of RC. 2. As O, `DELETE` A's P1 assignment. 3. Await the socket close. | The socket closes 4403 on the re-check. |
| TC-35.2 | permission | local | Same as TC-35.1 | 1. As O, `DELETE` A's P1 assignment. 2. As A, `projects.get` P1, then `projects.list`. | `projects.get` gives 404; the list no longer includes P1 (P2 still shows). |

Not e2e (stream part of BR-35): "an open stream keeps running" needs a timed browser wait; proved by `sse.int.test.ts` (spec ## Testing).

#### BR-36: Grant and revoke refused for members, viewers and out-of-scope project admins

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-36.1 | permission | local | Cast | As B, `POST /api/orgs/:orgId/assignments` granting C `member` on P2. | 403; C's access does not list P2. |
| TC-36.2 | permission | local | Cast | As V, `POST /api/orgs/:orgId/assignments` granting C `member` on P2. | 403. |
| TC-36.3 | permission | local | Cast | As A, grant C `member` on P2. | 403; C's access does not list P2. |
| TC-36.4 | permission | local | Cast | As B, `DELETE /api/orgs/:orgId/assignments/:assignmentId` for C's P1 assignment. | 403; C's assignment still exists. |
| TC-36.5 | permission | local | Cast | As A, `DELETE` B's P2 assignment. | 403; B still sees P2. |

#### BR-37: Not e2e

Not e2e: request validation (400 / 422 / 409) with no path beyond the API; proved by contract unit and API int with problem pointers (spec ## Testing).

#### BR-41: Same grant twice

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-41.1 | persistence | local | Cast | 1. As O, `POST /api/orgs/:orgId/assignments` `{userId: V, roleId: <member role id>, scope: {type: 'project', projectId: P2}}`. 2. Send the identical request again. 3. As O, `GET /api/orgs/:orgId/assignments?projectId=P2`. | Step 1 returns 201; step 2 returns 200 with the same assignment; the list holds exactly one assignment for V on P2 with that role. |
| TC-41.2 | persistence | local | Cast | As PA, send the same grant twice through `POST /api/platform/orgs/:orgId/assignments`, then list with `GET /api/platform/orgs/:orgId/assignments?projectId=P2`. | First 201, second 200; one assignment for V on P2. |

#### BR-45: Owner and admin grant and revoke

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-45.1 | permission | local | Cast | As O, grant C `viewer` on the org (`POST /api/orgs/:orgId/assignments`), then as C `runs.get` RB. | 201; C's next request reads P2's data too, with no wait. |
| TC-45.2 | permission | local | Cast; O granted C `viewer` on the org | As O, `DELETE` that assignment, then as C `runs.list` on P2. | 204; C's next request no longer reads P2 (404). |
| TC-45.3 | permission | local | Cast | As O, grant A `owner` on the org through the tenant route, then as A `projects.create`. | 201; A's next request shows owner access (create accepted). |
| TC-45.4 | permission | local | Cast | As D, grant C `viewer` on the org. | 201; C's next request reads P2. |
| TC-45.5 | permission | local | Cast | As D, grant C `owner` on the org. | 403; C's access shows no `owner`. |
| TC-45.6 | permission | local | Cast; O granted A `owner` on the org | As D, `DELETE` A's `owner` assignment. | 403; A still has owner access. |
| TC-45.7 | permission | local | Cast | As PA, `POST /api/platform/orgs/:orgId/assignments` granting C `owner` on the org. | 201; C's next request has owner access. |

#### BR-46: Last owner

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-46.1 | state | local | Cast; O holds the only `owner` assignment | As O, `DELETE` O's own `owner` assignment through the tenant route. | 409; O still has owner access. |
| TC-46.2 | state | local | Cast; O holds the only `owner` assignment | As PA, `DELETE /api/platform/orgs/:orgId/assignments/:assignmentId` for O's `owner` assignment. | 204; the org has no owner assignment. |
| TC-46.3 | boundary | local | Cast; O granted a second user O2 `owner` on the org | As O, `DELETE` O2's `owner` assignment through the tenant route. | 204 (not the last owner). |

#### BR-61: Project admin grants and revokes on own project

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-61.1 | permission | local | Cast | As A, grant V `member` on P1. | 201; V's next request shows P1 member rights. |
| TC-61.2 | permission | local | Cast | As A, grant V `admin` on P1. | 201. |
| TC-61.3 | permission | local | Cast | As A, grant V `viewer` on P1. | 201. |
| TC-61.4 | permission | local | Cast | As A, grant V `member` on P2. | 403. |
| TC-61.5 | permission | local | Cast | As A, grant V `member` on the org scope. | 403. |
| TC-61.6 | permission | local | Cast; A granted V `member` on P1 | As A, `DELETE` that assignment. | 204; applies on V's next request. |

#### BR-63: Own access

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-63.1 | persistence | local | Cast; O revoked C's assignment (C is a member with none) | As C, `GET /api/me/access`. | 200 with C's userId, `platformAdmin` false and no assignments; `projects.list` for C still gives 403. |
| TC-63.2 | persistence | local | Same as TC-63.1 | 1. As PA, grant C `member` on P2. 2. As C, `GET /api/me/access`. | 200 with one assignment: role `member`, scope project P2, and its permissions. |
| TC-63.3 | persistence | local | Cast | As O, `GET /api/me/access`. | 200 with an `owner` assignment on the org scope and its permissions. |

#### BR-64: Listing assignments

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-64.1 | permission | local | Cast | As O, `GET /api/orgs/:orgId/assignments`. | 200 with every assignment in the org (O, D, A, B on P1 and P2, C, V). |
| TC-64.2 | permission | local | Cast | As D, `GET /api/orgs/:orgId/assignments`. | 200 with every assignment in the org. |
| TC-64.3 | permission | local | Cast | As A, `GET /api/orgs/:orgId/assignments?projectId=P1`. | 200 with P1's assignments only (A, B, C). |
| TC-64.4 | permission | local | Cast | As A, `GET /api/orgs/:orgId/assignments` with no projectId. | 200 with P1's assignments only; none of B's P2 assignment, V's or D's org-scope ones. |
| TC-64.5 | permission | local | Cast | As B, `GET /api/orgs/:orgId/assignments`. | 403. |
| TC-64.6 | permission | local | Cast | As V, `GET /api/orgs/:orgId/assignments`. | 403. |

#### BR-38: Platform admin has no tenant data without an assignment

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-38.1 | permission | local | Cast; PA has no membership or assignment in X | As PA, `projects.list` of org X through the tenant route. | Refused (403 or 404); no project in the body. |
| TC-38.2 | permission | local | Same as TC-38.1 | As PA, `GET /api/orgs/:orgId/members` and `GET /api/orgs/:orgId/assignments`. | Both refused (403 or 404); no data. |
| TC-38.3 | permission | local | Same as TC-38.1 | As PA, `GET /api/orgs/:orgId/invitations`. | Refused (403 or 404); no data. |
| TC-38.4 | positive | local | Same as TC-38.1 | As PA, `GET /api/platform/orgs/:orgId/projects` and `GET /api/platform/orgs/:orgId/members`. | Both 200: ids and names of P1 and P2, and the org's members. |

#### BR-39: Not e2e

Not e2e: removing an email from config needs an API restart with a different env, which a shared stack cannot do; proved by API int with a config override (spec ## Testing).

#### BR-40: Platform lists show ids, names, roles and scopes only

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-40.1 | permission | local | Cast | As PA, `GET /api/platform/orgs`. | 200; the entry for X shows id, name, slug, member count and creation time, and no project or run data. |
| TC-40.2 | permission | local | Cast | As PA, `GET /api/platform/orgs/:orgId/projects`. | 200; P1 and P2 each with id and name only (no repository, settings, agent or run data). |
| TC-40.3 | permission | local | Cast | As PA, `GET /api/platform/orgs/:orgId/members`. | 200; each member shows user id, handle, name, email and assignments (role and scope); no run, project content or secret data. |
| TC-40.4 | permission | local | Cast | As PA, `GET /api/platform/orgs/:orgId/roles`. | 200; the built-in roles with their permission lines. |

#### BR-69: Platform admin creates an org and invites its owner

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-69.1 | side-effect | local | PA signed in; slug `e2e-<rand>` unused | As PA, `POST /api/platform/orgs` with `{name: "E2E <rand>", slug: "e2e-<rand>"}`. | 201 with `{id, name, slug}` where slug is `e2e-<rand>`; the org is listed by `GET /api/platform/orgs`. |
| TC-69.2 | side-effect | local | The org from TC-69.1 | As PA, `GET /api/platform/orgs/:orgId/roles` and `GET /api/platform/orgs/:orgId/members`. | Roles `owner`, `admin`, `member`, `viewer` exist; members is empty. |
| TC-69.3 | side-effect | local | The org from TC-69.1 | 1. As PA, `POST /api/platform/orgs/:orgId/invitations` `{email: <owner email>, roleId: <owner role id>, scope: {type: 'org'}}`. 2. Sign in as that person with the matching verified email. | Step 1 returns 201; after sign-in the person is a member of the org with `owner` on the org (`GET /api/me/access`) and can create a project. |
| TC-69.4 | negative | local | The org from TC-69.1 | As PA, `POST /api/platform/orgs` again with the same slug and another name. | 409. |
| TC-69.5 | positive | local | PA signed in | As PA, `POST /api/platform/orgs` with `{name: "Acme Corp", slug: "acme-eu-<rand>"}` (slug differs from a name-derived one). | 201; the org's slug is the one sent. |

#### BR-70: Non-platform-admins refused on org creation

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-70.1 | permission | local | Cast | As O, `POST /api/platform/orgs` with a valid name and slug. | 403; no org with that slug is listed by PA. |
| TC-70.2 | permission | local | Cast | As A, `POST /api/platform/orgs` with a valid name and slug. | 403. |
| TC-70.3 | permission | local | Cast | As O, `GET /api/platform/orgs`, `GET /api/platform/orgs/:orgId/members` and `GET /api/platform/orgs/:orgId/invitations`. | Each 403. |
| TC-70.4 | permission | local | Cast | As O, `POST /api/platform/orgs/:orgId/assignments` granting C `viewer` on the org. | 403; C's access unchanged. |

#### BR-73: Not e2e

Not e2e: request validation (name and slug required, length limits, slug format) with no path beyond the API; proved by contract unit and `platform.int.test.ts` (400 with pointers); a taken slug (409) is covered by TC-69.4 (spec ## Testing).

#### BR-62: Not e2e

Not e2e: the first platform-admin sign-in happens once per stack (the configured email); proved by API int on a fresh DB (spec ## Testing).

#### BR-54: Uninvited sign-up refused

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-54.1 | negative | local | Cast; handle `e2e-<rand>` has no account and no pending invitation | Dev-login with handle `e2e-<rand>`. | Sign-in is refused with an error; no session is created. |
| TC-54.2 | negative | local | Same as TC-54.1 | 1. Attempt the dev-login. 2. As PA, `GET /api/platform/orgs/:orgId/members`. 3. Attempt the dev-login again. | The member list does not contain `e2e-<rand>`; the second attempt is refused too (no account was created). |

#### BR-55: Invited person signs in with the invited scope

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-55.1 | side-effect | local | Cast; PA invited new handle `h1` as `viewer` on the org | Dev-login as `h1`, then `projects.list` and `GET /api/me/access`. | The list shows P1 and P2; access shows `viewer` on the org scope; `h1` is a member of X. |
| TC-55.2 | side-effect | local | Cast; PA invited new handle `h2` as `member` on project P1 only | Dev-login as `h2`, then `projects.list`. | The list shows P1 only. |
| TC-55.3 | side-effect | local | Cast; PA invited new handle `h3` as `member` with project list P1 and P2 in one invitation | Dev-login as `h3`, then `GET /api/me/access`. | Two assignments: `member` on P1 and `member` on P2; the list shows P1 and P2. |
| TC-55.4 | state | local | Same as TC-55.2 | After `h2` signs in, as PA `GET /api/platform/orgs/:orgId/invitations`. | The invitation for `h2` shows status `accepted`. |

#### BR-56: Existing user joins a second org on next sign-in

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-56.1 | side-effect | local | Cast; a second org Y exists with project PY; PA invited B's email to Y as `viewer` on the org | 1. B signs in again. 2. As PA, `GET /api/platform/orgs/:orgId/members` for Y. | Y's member list shows B with `viewer` on the org. |
| TC-56.2 | side-effect | local | Cast; org Y with projects PY1 and PY2; PA invited B to Y as `member` on PY1 | 1. B signs in again. 2. As PA, list Y's members. | B appears with one assignment, `member` on PY1. |
| TC-56.3 | state | local | Same as TC-56.1 | After B signs in again, as PA `GET /api/platform/orgs/:orgId/invitations` for Y. | The invitation for B shows status `accepted`. |

#### BR-57: Not e2e

Not e2e: a 7-day expiry is a multi-day timer; proved by API int with `expires_at` in the past or an injected Clock (spec ## Testing).

#### BR-58: Revoked invitation does nothing

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-58.1 | state | local | Cast; PA invited new handle `h4` as `viewer` on the org, then revoked it (`DELETE /api/platform/orgs/:orgId/invitations/:invitationId`, 204) | Dev-login as `h4`. | Sign-in is refused; no account exists (the org's member list has no `h4`). |
| TC-58.2 | state | local | Same as TC-58.1 | As PA, `DELETE` the same invitation again. | 409. |
| TC-58.3 | state | local | Cast; a second org Y; PA invited B's email to Y then revoked it | 1. B signs in again. 2. As PA, list Y's members. | B is not a member of Y. |

#### BR-59: Not e2e

Not e2e: request validation (400 / 422 / 409) with no path beyond the API; proved by contract unit and API int with problem pointers (spec ## Testing).

#### BR-60: Invitation rights follow grant rights

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-60.1 | permission | local | Cast | As A, `POST /api/orgs/:orgId/invitations` `{email: <new>, roleId: <member role id>, scope: {type: 'project', projectIds: [P1]}}`. | 201 with a `pending` invitation. |
| TC-60.2 | permission | local | Cast | As A, invite with `scope: {type: 'org'}` and role `member`. | 403; no invitation created. |
| TC-60.3 | permission | local | Cast | As A, invite with `projectIds: [P1, P2]`. | 403; no invitation created. |
| TC-60.4 | permission | local | Cast | As B, `POST /api/orgs/:orgId/invitations` for P1 as `member`. | 403. |
| TC-60.5 | permission | local | Cast | As V, `POST /api/orgs/:orgId/invitations` for P1 as `viewer`. | 403. |
| TC-60.6 | permission | local | Cast | As O, invite a new email as `owner` on the org. | 201. |
| TC-60.7 | permission | local | Cast | As D, invite a new email as `owner` on the org. | 403. |
| TC-60.8 | permission | local | Cast; O invited an email for P2 and another for P1 | As A, `GET /api/orgs/:orgId/invitations`. | 200 listing only invitations whose every project A administers (the P1 one, not the P2 one). |
| TC-60.9 | permission | local | Cast; A created an invitation for P1 | As A, `DELETE /api/orgs/:orgId/invitations/:invitationId`. | 204; the invitation shows status `revoked`. |
| TC-60.10 | permission | local | Cast; O created an invitation for P2 | As A, `DELETE` that invitation. | 403; the invitation is still `pending`. |
| TC-60.11 | permission | local | Cast | As B, `GET /api/orgs/:orgId/invitations`. | 403. |
| TC-60.12 | permission | local | Cast; invitations exist in X | As O, `GET /api/orgs/:orgId/invitations`. | 200 listing every pending invitation of X. |

### Open questions

- Q1 (all cases, Cast): the spec's local cast has A, B, C, V and projects P1 (active run) and P2 (first wizard step), but the cases also need an org admin D, an active run RP2 in P2, a third project P3 (TC-30.1, TC-30.3), a second owner O2 (TC-46.3), a second org Y and the runs owned by B and C (RB, RC). Until answered, the cases assume these are added to the setup of `rbac.spec.ts`.
- Q2 (all HTTP cases): the spec gives no method or path for existing routes (runs, rules, agents, connections, projects, setup) nor the `PageQuery` parameter names; cases cite the route keys and say "a page size of 1". Until answered, cases assert status and observable state only.
- Q3 (BR-50, BR-53, TC-50.1, TC-53.1): no source names the field that shows a run's owner, nor the exact text of the trigger command or how the dev fake-comment route is called. Until answered, the cases assert that the run's data shows the owner's identity.
- Q4 (BR-12, TC-12.1): the spec says the 403 problem body says the action is "not allowed for your role here"; it does not state whether this is the `title` or `detail`. Until answered, the case asserts the phrase appears in the problem body.
- Q7 (BR-38, TC-38.1 to TC-38.3): the rule says 403 / 404 and the spec says a non-active `orgId` gives 404 but a non-member gets 403. Until answered, the cases assert refused with 403 or 404 and no data.
- Q8 (BR-64): the status for a project admin calling `GET /api/orgs/:orgId/assignments?projectId=` with a project outside their scope (403 or 404) is not stated; no case is written for it.
- Q9 (BR-54, BR-55, BR-56, BR-58): the sources do not say how a dev-login handle maps to a verified email (needed to match an invitation, including the case-insensitive match), nor how a multi-org user selects the active org after TC-56.x (active org is the oldest membership). Until answered, cases invite by the email the dev-login produces for a handle and check the second org through the platform member list.
- Q10 (BR-69, TC-69.5): the default slug built from the name is made by the later screen (no UI in this slice), so it cannot be observed at the API. The case asserts only that an edited slug is stored as sent.
