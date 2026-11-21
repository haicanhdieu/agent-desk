<!-- dev-plan: kind=spec id=org-onboarding rev=2 hash=9002c1e6b646 source=issue#189 -->
# Org onboarding design

Status: draft. Sensitive paths: auth (the `/auth` allow-list, the new guard kind `user`, the per-request org header
check, sign-in hooks without auto-accept, the sign-up refusal code, dev-login refusing an uninvited handle); terminal (`orgId` connect param, reauth pinned to
the connect org); RLS/`withOrg` (new `SECURITY DEFINER` function `invitation_org_for_email`); migrations (the invitation
status check gains `declined`). Needs `review:sensitive` and a high-effort security review.
Source: issue #189 (slice 2 of epic #185; depends on #188)

## Summary

Today a person cannot get from sign-in to a working org without operator help: org routes are disabled, sign-in always
picks the oldest org, and there is no invitation or switcher UI. After this change, platform admins create orgs and
invite each org's first owner; owners and admins invite people with a copy link and manage invitations (list, filter,
resend, revoke); invited people accept or decline; members of several orgs switch between them and every page acts on
the org in its URL; a new org's owners and admins follow a first-run checklist until one project is fully set up.

## Business rules

Confirmed by the human at planning time.

### Goal

A person goes from sign-in to a working org without operator help (epic G1). Platform admins create orgs and invite
each org's first owner. Admins invite people with a copy link. Invited people accept or decline. Members of several
orgs switch between them, and a page always acts on the org in its URL. A new org's admins follow a checklist until one
project is fully set up.

### Actors

| Actor | May do |
| ----- | ------ |
| Platform admin (config email) | Create an org with a name, slug and first owner's email; gets the owner invitation's copy link. Not a member of the new org because of that (T1; slice 1 BR-69, BR-70). |
| Org owner | Invite with any role on the org or projects; list, resend, revoke, copy link (slice 1 BR-60; T4). Sees the first-run checklist. |
| Org admin | Same as owner, except never `owner` as a role (slice 1 BR-60). Sees the checklist. |
| Project admin | Invite as admin, member or viewer on the projects they administer only; sees and acts on only those invitations (slice 1 BR-60 and the list rule). No checklist. |
| Member, viewer | No invite controls, no Invitations page, no checklist. |
| Invited person, new or existing | Sees their pending invitations (org, role, scope) and accepts or declines each (T2); opens a copy link (T3). |
| Uninvited person, no account | Refused at sign-in (slice 1 BR-54). |
| Signed-in user with no org | Sees the welcome page: their pending invitations, or "ask for an invitation"; platform admins also get Create organization. |
| Member of several orgs | Switches org; the URL always names the org being acted on (T5). |

Resend has the same rights as create and revoke (Agent call). Only org owners and org admins see the checklist; nobody
else does (T11).

### Rules

Surface: UI (every behaviour reaches a screen: sign-in, welcome, invitation page, Invitations page, invite dialog,
create-org form, org switcher, Projects page checklist).

| Id    | Category         | Rule |
| ----- | ---------------- | ---- |
| BR-1  | permission       | When a person with no account and no pending invitation signs in, the sign-in page shows that no invitation was found for their email, and no account is made. |
| BR-2  | happy-path       | When an invited new person signs in with the matching verified email, they see the invitation (org name, role, scope) with Accept and Decline, and they are not yet a member. |
| BR-3  | happy-path       | When an existing user with a pending invitation signs in, they see a notice of their pending invitations that opens the list with Accept and Decline; the org is not in their switcher until they accept. |
| BR-4  | state-transition | When an invitation is expired or revoked, it is not in the invitee's list and cannot be accepted. |
| BR-5  | permission       | When a person signed in with a different verified email opens an invitation link, they see "not available" with no org name, role or email, and join nothing. |
| BR-6  | happy-path       | When a user who belongs to two or more orgs opens the org switcher, they see each of their orgs with the current one marked. |
| BR-7  | navigation       | When a user picks another org in the switcher, the URL changes to that org and its projects show; a reload stays in that org. |
| BR-8  | navigation       | When a signed-out user opens a link to `/o/<org>/…` and signs in, they land on that page in that org. |
| BR-9  | empty-state      | When a user who is not a platform admin belongs to one org, no switcher shows. |
| BR-10 | feedback-state   | When switching orgs, a loading state shows and no data of the previous org shows under the new URL. |
| BR-11 | edge             | When org A is open in one tab and the user switches to org B in another tab, the first tab's next action never reads or changes org B's data: it reloads org A's data, and a write is refused with "This organization was switched in another tab. Try again." and nothing changed. |
| BR-12 | permission       | When a user opens a link to an org they are not a member of, they see not found. |
| BR-13 | happy-path       | When an org owner or admin opens the Projects page of an org where no project has all four steps done, a checklist card shows Connect a code host, Create a project, Add an agent and Add a rule, each done or not done. |
| BR-14 | state-transition | When a step is completed (connection added, project created, agent credential set, rule added), that item shows done after a reload. |
| BR-15 | navigation       | When an owner or admin clicks a checklist item, the matching setup step of the furthest-along project opens (the new-project wizard when there is no project). |
| BR-16 | state-transition | When one project has all four steps done, the checklist card no longer shows, whether the Projects page has one project or many. |
| BR-17 | permission       | When a project admin, member or viewer opens the Projects page, no checklist card shows. |
| BR-18 | happy-path       | When an inviter clicks Resend on a pending or expired invitation, the row shows pending with a new expiry 2 days from now and the same copy link. |
| BR-19 | state-transition | When an invitation is accepted, declined or revoked, its row offers no Resend or Revoke; an expired row offers Resend only. If the invitation changed while the page was open, Resend or Revoke shows an error, the list refreshes and nothing changes. |
| BR-20 | permission       | When a member or viewer opens the Projects page, no Invite or Invitations control shows; opening the Invitations page URL shows the no-access state. |
| BR-21 | happy-path       | When an invitee clicks Accept, they land on the joined org's projects page, see exactly the invited projects, and the org is in their switcher. |
| BR-22 | state-transition | When an invitee clicks Decline, the invitation leaves their list, they do not join, and the inviter's Invitations page shows it as Declined. |
| BR-23 | edge             | When an invitee clicks Accept or Decline on an invitation that was revoked, expired, accepted or declined meanwhile, the page reloads the invitation and shows its new state (revoked, expired, already joined, declined), and nothing changes. |
| BR-24 | navigation       | When a signed-out person opens an invitation link (`/invitations/<id>`), they are sent to sign in and then back to that invitation. |
| BR-25 | happy-path       | When the matching signed-in person opens a pending invitation link, they see the org name, role, scope, who invited them (display name, or handle when there is no name) and the expiry, with Accept and Decline. |
| BR-26 | state-transition | When the matching person opens the link of an accepted, declined, revoked or expired invitation, the page shows that state and no Accept or Decline. |
| BR-27 | happy-path       | When an owner or admin sends the invite dialog with an email, a role and the whole org or some projects, the copy link shows, and the Invitations page lists the invitation as pending, expiring 2 days later. |
| BR-28 | validation       | When the invite dialog has an invalid or over-long email, no project chosen for a project scope, an email that is already a member, or an email already invited, the dialog shows the matching field error and nothing is created. |
| BR-29 | permission       | When an org admin opens the invite dialog, `owner` is not offered; when a project admin opens it, only admin, member and viewer on the projects they administer are offered, and the whole-org scope is not. |
| BR-30 | happy-path       | When an owner or admin opens the Invitations page, the status filter is set to Pending and only pending invitations show, each with email, role, scope, status and expiry, paged. |
| BR-31 | permission       | When a project admin opens the Invitations page, they see only invitations whose every project they administer. |
| BR-32 | state-transition | When an inviter revokes a pending invitation, the row shows Revoked and the invitee's link shows it is no longer valid. |
| BR-33 | happy-path       | When an inviter clicks Copy link on a pending invitation, the link is copied and a confirmation shows. |
| BR-34 | happy-path       | When a platform admin with no org signs in, the welcome page offers Create organization. |
| BR-35 | happy-path       | When a platform admin submits the create-org form with a name, a URL slug (filled from the name, editable) and the first owner's email, the org is created and the owner invitation's copy link shows. |
| BR-36 | validation       | When the create-org form has an empty or over-long name, a slug outside the slug format, a slug already taken, or an invalid owner email, the form shows the matching field error and no org is created. |
| BR-37 | permission       | When a user who is not a platform admin has no org and no pending invitation, the welcome page shows the heading "You're not a member of any organization", the text "No invitations for <email>. Ask an owner or admin to invite you." and a Sign out button, with no Create organization. |
| BR-38 | happy-path       | When the first owner accepts the owner invitation, they land in the new org's projects page with the checklist showing nothing done. |
| BR-39 | edge             | When the org is created but the owner invitation fails, the form shows the error with Retry, and Retry creates only the invitation, never a second org. |
| BR-40 | navigation       | When a platform admin opens the org switcher, it offers Create organization, even if they belong to one org or none. |
| BR-41 | edge             | When an invitee has pending invitations from several orgs and accepts one, the others stay listed as pending. |
| BR-42 | edge             | When an invitee clicks Accept twice (double click or two tabs), they have one membership and the second ends on the same "already joined" state. |
| BR-43 | navigation       | When a user with several orgs signs in without a link, they land in the projects page of the org they joined first. |
| BR-44 | permission       | When a member with no role in an org opens it from the switcher, they see the existing no-access state and can still switch to another org. |
| BR-45 | edge             | When a new person declines every invitation, they land on the welcome page with no org, and their next sign-in shows the same page. |
| BR-46 | permission       | When anyone who is not a platform admin calls org creation, they get 403 and no org is made (no control shows for them). |
| BR-47 | happy-path       | When an inviter picks a status filter (All, Pending, Accepted, Declined, Revoked, Expired) on the Invitations page, only invitations with that status show (every status for All), and the page count follows. |
| BR-48 | state-transition | When 2 days pass after an invitation was created or last resent without an answer, the Invitations page shows it as Expired, it leaves the invitee's list, and its link tells the invitee it has expired. |
| BR-49 | state-transition | When an inviter resends an expired invitation, the invitee's same link shows Accept and Decline again. |
| BR-50 | validation       | When an inviter resends an expired invitation while that email already has another pending invitation in the org, they see an "already invited" error and nothing changes. |
| BR-51 | feedback-state   | When an inviter looks at the Expires column of the Invitations page, a pending or recently expired invitation shows a relative label with the exact date on hover; an invitation that expired more than 3 days ago shows the exact date directly. |
| BR-52 | feedback-state   | When an inviter looks at the Invited by column, or an invitee looks at an invitation, the inviter shows as their display name, or their handle when there is no name. |

### Not observable

- Audit entries `invitation.resent` and `invitation.declined` (and slice 1's `invitation.accepted`,
  `invitation.created`, `invitation.revoked`, `org.created`): there is no audit view until slice 3. Their effects are
  BR-18, BR-22, BR-21, BR-27, BR-32 and BR-35.
- The better-auth `/organization/*` routes kept disabled or allow-listed: no screen. Effect: BR-46 and slice 1's denial
  table.
- The per-request org check (T5): internal. Effect: BR-11.
- `setActive` latency (requirement question 3): no screen beyond the loading state of BR-10.
- The invitation link carries no secret token: internal. Effect: BR-5, BR-25.
- Pending invitations created before this change keep their 7-day expiry: no user path creates one after the change.
  Proved at integration level.

### States

- Invitation: pending → accepted (the invitee clicks Accept), declined (the invitee clicks Decline), revoked (the inviter
  clicks Revoke) or expired (2 days after creation or the last resend with no answer). expired → pending only by the
  inviter's Resend. Accepted, declined and revoked are final: Resend or Revoke on them gives 409, and a declined
  invitation cannot be reopened; the inviter sends a new one. Revoke works on pending only; an expired invitation offers
  Resend, not Revoke (slice 1 BR-58). Expired is no longer final, and `declined` is a new state; both change slice 1
  §States (T2, T10).
- Invitations never join anyone automatically. Accept or Decline is the only way the invitee resolves one (T2). This
  changes slice 1 BR-55 and BR-56; the sign-up gate (slice 1 BR-54: a new person needs a pending invitation) stays.
- Active org: with no org in the URL, the user lands in the session's active org, which starts as the oldest membership
  (T7). When the URL names an org, the URL wins: every page under `/o/$org` acts only on the org in its URL, and a request
  whose URL org is not the session's active org is refused (409) and changes nothing (T5). Accept makes the joined org
  active and lands the person on its projects page.
- Checklist: shown on the Projects page while no project has all four steps done; hidden once one project has all four.
  It is computed, not stored, so it comes back only if no project has all four any more (T6).

### Limits and validation

- Invitation email: valid, at most 254 characters, compared case-insensitively (slice 1 §Limits, BR-59).
- Role: one of the org's roles allowed at the scope.
- Scope: the org, or 1 to 100 projects (duplicates collapse).
- Expiry: 2 days from creation or the last resend, a fixed value in this slice (T10; replaces slice 1's 7 days).
- Already a member: 409. A second pending invitation for the same email in the org: 409.
- Org name: 1 to 100 characters. Slug: lowercase a-z, 0-9 and `-`, no leading or trailing `-`, 1 to 63 characters,
  unique (409). The default slug comes from the name and can be edited (slice 1 BR-73).
- Create-org form: also takes the first owner's email, with the same rules as an invitation email (T1).
- No rate or count limit on invitations, resend or org creation (slice 1: only admins call them).
- The Invitations page is paged with the shared pagination (ADR-0028).
- An invitation applies only to a signed-in person whose verified email equals the invited email, compared
  case-insensitively (epic §9; slice 1 §Limits).

### Edge cases

- Signed-in email differs from the invitation: the invitation is not in their list, and its link shows a generic "not
  available" page with no org name, role or email (the API answers 404 so the id leaks nothing).
- Invitation revoked, expired, accepted or declined while the page is open: Accept or Decline gets 409; the page reloads
  the invitation and shows its new state, and nothing changes (BR-23).
- Link opened by the matching person after it was resolved: the page shows its state (expired, revoked, already joined,
  declined) and no Accept button. These specific states show only to the matching person; anyone else sees "not
  available" (T9).
- Signed-out visitor opens the link: sign in, then back on the invitation page (existing `redirect` rule).
- Several pending invitations from different orgs: all are listed. Accepting one leaves the others pending.
- New person declines every invitation: their account stays; they land on the welcome page with no org. Their next
  sign-in works (the account exists) and shows the same page.
- Double click or two tabs on Accept: one membership; the second ends on the same "already joined" state (BR-42).
- Every project in a project-scoped invitation was deleted: Accept still makes them a member with no project (slice 1).
- Org open in two tabs, switched in the other tab (T5, T12): the first tab's next request is refused with no change.
  Reads: the tab re-activates its URL's org and reloads its data. Writes are never retried automatically: they show "This
  organization was switched in another tab. Try again.", nothing changed, and the user retries.
- URL with an org slug the user is not a member of: not found (unchanged).
- Member with no assignment in an org: the org is in the switcher; opening it shows the existing no-access state (slice
  1 BR-32, BR-63).
- Create org succeeds but the owner invitation fails: the form shows the error with Retry; Retry only creates the
  invitation and never a second org (slice 1: two calls).
- Resend on an invitation revoked, accepted or declined meanwhile: 409, an error message, and the list refreshes.
- Resend on an expired invitation: it becomes pending, and the invitee's same link works again (T10).
- Resend on an expired invitation when the email already has another pending invitation in the org: 409 "already
  invited", nothing changes (Agent call).
- Invitation expires while the invitee has it open: Accept shows that it has expired (T9 specific message), and nothing
  changes.

### Tenancy and permission

- Every invitation read and write, and every checklist read, is scoped to the URL's org through slice 1's endpoints and
  `withOrg` (AGENTS rule 4, ADR-0006). Another org's invitation id gives 404.
- The invitee's own invitations are listed across orgs only for their verified email, showing org name, role and scope;
  nothing else about those orgs (the definer lookup returns ids only).
- Invitation rights are slice 1 BR-60. The web hides controls the user cannot use (epic §7.2); the server stays the
  authority.
- The org switcher lists only orgs the user is a member of; orgs from pending invitations are not in it.
- A request never runs against an org other than the one in the page's URL (T5).
- Org creation is platform admin only (slice 1 BR-70); everyone else gets 403 and never sees the control.
- Only platform admins create orgs; a new org has no members, and its first owner is invited (T1; slice 1 BR-69).

### Lifecycle, compatibility and side effects

- Audit: slice 1 entries for invitation create, revoke and accept, and `org.created`. Resend writes `invitation.resent`
  and decline writes `invitation.declined`, in the same transaction (Agent call).
- Invitations are never deleted. Resolved ones stay listed with their status (slice 1).
- Accepting creates the membership and assignments that slice 1 created at sign-in; nothing else (T2).
- Slice 1 behaviour changed here; the slice 1 spec is fixed in the same PR, or before it if slice 1 is not built yet
  (AGENTS: fix the stale doc):
  - T2: auto-accept at sign-in (slice 1 BR-55, BR-56) becomes an invitation shown with Accept and Decline.
  - T10: the 7-day expiry (slice 1 BR-57, §Limits) becomes 2 days, and expired is no longer final (resend revives it).
  - T8: the tenant invitation list shows every status with a filter, instead of "pending and expired".
- Existing pending invitations made with a 7-day expiry keep the expiry they were given; no stored row is rewritten
  (Agent call). Existing pending invitations made under slice 1 stay pending and now show Accept and Decline.
- Existing users and personal orgs: unchanged (slice 1). Existing single-org users see no switcher (Agent call), except
  platform admins, who always see it for Create organization (Agent call).
- Existing orgs where one project already has a connection, a credential and a rule show no checklist.
- ADR-0006, ADR-0008 and the control-plane spec still say "personal org per user". Slice 1's PR fixes them; this slice's
  PR flags it if it does not.
- The frontend design spec listed "org switcher and invitations UI" as out of scope for the PoC; this slice adds them.
- What a user sees happen: Accept: the org appears in the switcher and the user lands in it. Decline: the invitation
  leaves the invitee's list; the inviter's list shows Declined. Resend: the row shows the new expiry; the copy link is
  unchanged; no email is sent (T3). Revoke: the row shows Revoked; the invitee's link shows it is no longer valid.
- No ticket comments, run status changes or live-stream events.
- Names stay provider-agnostic: "code host", "connection", "invitation", "organization", never a provider name in
  tables, routes, types or copy outside adapters (AGENTS rule 3). The checklist item is "Connect a code host".
- Invitation email, org name and slug are user input: validated, stored and shown as text only, never interpolated
  (AGENTS rule 6). No ticket, comment or repo text is involved.
- Requirement question 2 (no unwanted personal org): slice 1 creates none for new people.

### Out of scope

- Member management screens (members list, change role, remove: slice 3) and SSO (requirement).
- Email delivery of invitations: a later change (T3). This slice ships copy-link invitations and adds no dependency.
- Making the invitation expiry configurable in platform admin: later work, to be noted on this slice's ticket (T10).
  This slice uses a fixed 2 days.
- Agent call: platform-level invitation screens beyond the create-org form (list or revoke invitations of any org) stay
  in slice 5 (#192 owns the platform admin UI; T1 only asked for org creation).

## Architecture

Confirmed by the human at planning time.

### Overview

Builds on the slice 1 spec `docs/superpowers/specs/2026-11-20-rbac-foundation-design.md` (rev 3, human-confirmed, not
built): its `invitations` table with RLS, tenant `/api/orgs/:orgId/invitations` (create, list, revoke) and platform
mirrors, the `pending_invitations_for_email` definer (ids only), the invite-gated sign-up in `user.create.before`, no
personal orgs, platform-only org creation (`POST /api/platform/orgs`), the `routeAccess` kinds
`org | project | self | org-admin | platform`, and `GET /api/me/access`. Layering stays apps → core → db → contracts;
web → contracts only (AGENTS rule 2).

- `packages/contracts`: new routes and DTOs (my invitations, resend, checklist, `InviterDto`), the new `routeAccess` kind `user`, the
  `ORG_HEADER` name, the `org-mismatch` problem type, the WS close code `4412`, the `INVITATION_EXPIRY_SECONDS` constant,
  the `no_invitation` sign-up refusal code, the `declined` status, and the `status` filter on the invitation lists. Every
  route gets a `routeAccess` entry.
- `packages/db`: one migration (invitation `declined` state, definer `invitation_org_for_email`). No new table.
- `packages/core` `src/access/`: `acceptInvitation`, `declineInvitation`, `resendInvitation`, `listMyInvitations`
  (moved from or extending slice 1's acceptance code), `orgChecklist(tx, visibleProjects)`.
- `apps/api`: the guard (kind `user`, org header check), controllers, the `/auth/*` allow-list, sign-in hooks (auto-accept
  removed; the gate's refusal carries `no_invitation`), the terminal gateway (`orgId` param, reauth pinned to the connect
  org).
- `apps/web`: the org header on every fetch, `orgId` on SSE and WS URLs, resync on mismatch, and the screens in "UI and
  Storybook".
- `apps/worker`, runner: no change.

Flow: the web sends the URL's org id in `x-org-id` on every request (and as `orgId` on SSE and terminal URLs); the API
guard compares it with the session's active org and refuses a mismatch with 409 (WS close 4412) before any side effect;
on that refusal the web re-activates its URL's org, drops the `['org']` cache and reloads. Invitees call the session-only
`/api/me/invitations*` routes; inviters call slice 1's tenant invitation routes plus resend; platform admins create an
org through slice 1's `POST /api/platform/orgs` and then slice 1's platform invitation create; the Projects page reads
the computed checklist.

### Data model

- Reuses slice 1's `invitations` table, its RLS and its leak test. No new table and no new column (the decline time is in
  the audit entry).
- New migration, after slice 1's (an applied migration is never edited, AGENTS rule 8):
  - Widens the `invitations` status check to add `declined`. The existing partial unique index
    `(org_id, email) where status = 'pending'` already frees the slot after a decline.
  - Adds `invitation_org_for_email(invitation_id uuid, email text) returns uuid`: `SECURITY DEFINER`, `SET search_path`;
    returns the org id only when the row's email equals the lowercased email, in any status; null otherwise. It gets an
    RLS/functions test and the security review. It is the fourth cross-org function.
- `listMyInvitations` calls slice 1's `pending_invitations_for_email(callerEmail)` (ids, org ids), then reads the details
  per org under `withOrg(orgId)` (`database.md` §2: definers return ids only).
- Resend is one conditional update: `update invitations set status='pending', expires_at = now() +
  make_interval(secs => INVITATION_EXPIRY_SECONDS) where id = $1 and status in ('pending','expired') returning`; zero
  rows (accepted, declined, revoked) → 409; a partial unique violation (another pending invitation for that email) →
  409; audit `invitation.resent`. It uses the database `now()`, never `Date.now()` (`testing.md` §5). The same link keeps
  working (T10).
- Invitations already stored with slice 1's 7-day expiry keep their `expires_at`; no backfill.
- No new index for the status filter.
- The checklist is computed, not stored (no table, no backfill):
  - `connect_code_host` (org level): the org has an active connection with `capabilities.code`.
  - `create_project` (org level): any visible project exists.
  - `add_agent` and `add_rule` follow one focus project: the visible project with the most of {agent credential set, at
    least one rule} done, ties to the newest. `add_agent` = its agent has `credential_secret_name is not null`;
    `add_rule` = it has at least one rule.
  - `complete` = the focus project has both (its code connection is mandatory, `projects.code_connection_id not null`).
- No backfill; existing orgs, members and personal orgs are unchanged (slice 1 §Lifecycle).

### API

| Method | Path | Who may call it | Request | Response | Contract |
| ------ | ---- | --------------- | ------- | -------- | -------- |
| GET | `/api/me/invitations` | kind `user`: any session | `PageQuery` | `pageOf(MyInvitationDto)`: pending and unexpired invitations for the caller's verified email only; unverified email → empty list | `me.invitations.list` (new) |
| GET | `/api/me/invitations/:invitationId` | kind `user` | — | `MyInvitationDto` with `status`, for the caller's own invitation (matching verified email) in any status; any other email, unverified email or unknown id → 404 | `me.invitations.get` (new) |
| POST | `/api/me/invitations/:invitationId/accept` | kind `user`, verified email | — | `{ org: {id, name, slug} }`; own invitation not pending → 409 with its status (accepted, declined, revoked, expired); other email, unverified email or unknown id → 404 | `me.invitations.accept` (new) |
| POST | `/api/me/invitations/:invitationId/decline` | kind `user`, verified email | — | 204; same 409 / 404 split as accept | `me.invitations.decline` (new) |
| POST | `/api/orgs/:orgId/invitations/:invitationId/resend` | kind `org-admin`, slice 1 invitation rights (same as create and revoke) | — | `InvitationDto`; 404 unknown or other-org id; 409 not pending or expired, or slot taken; 403 by slice 1 rights | `invitations.resend` (new) |
| POST | `/api/platform/orgs/:orgId/invitations/:invitationId/resend` | kind `platform`, new permission `platform-invitation:update` | — | `PlatformInvitationDto`; same 404 / 409 split | `platform.invitations.resend` (new) |
| GET | `/api/orgs/:orgId/checklist` | kind `org` with `project:create` at org scope (org owner, org admin); anyone else 403 (T11) | — | `OrgChecklistDto`, computed over the org's projects | `orgs.checklist` (new) |
| GET | `/api/orgs/:orgId/invitations` | slice 1 rights, unchanged | adds `status` = `pending \| accepted \| declined \| revoked \| expired \| all`, default `pending` (T8) | slice 1 page of `InvitationDto`, filtered | `invitations.list` (changed) |
| GET | slice 1's platform invitation list path | slice 1 rights, unchanged | adds the same `status` filter, default `pending` (T8) | slice 1 page of `PlatformInvitationDto`, filtered | `platform.invitations.list` (changed) |

- `status` semantics: `pending` means stored pending and unexpired; `expired` means stored expired, or pending past
  `expires_at`.
- DTOs: `MyInvitationDto {id, org: {id, name, slug}, role: {key, name}, scope: {type:'org'} | {type:'project', projects:
  {id, name}[]}, invitedBy: InviterDto | null, expiresAt, status}` with `status` one of
  `pending | accepted | declined | revoked | expired` (used by `me.invitations.get`; `me.invitations.list` returns
  pending only). `InviterDto {name: string, handle: string}`: the server applies the fallback, so `name` is the
  inviter's display name trimmed, or the handle when that is empty (better-auth `user.name` is NOT NULL but can be
  empty); the web renders `name` as is; `handle` stays for disambiguation; `invitedBy` is null only when the inviter's
  user row no longer exists. Slice 1's `InvitationDto.invitedBy` and `PlatformInvitationDto.invitedBy` change to the same
  `InviterDto | null` (the Invitations page "Invited by" column, BR-52); slice 1 is not built, so its spec is fixed in
  the same PR, not migrated. `OrgChecklistDto {complete: boolean, projectId: uuid | null, steps: {key: 'connect_code_host' |
  'create_project' | 'add_agent' | 'add_rule', done: boolean}[]}`. No DTO carries a link or token; the web builds
  `<origin>/invitations/<id>` from `window.location.origin` (REST plural, matching `/api/me/invitations/:id`).
- New route kind `{scope:'user'}`: session only; no active org or membership needed; the org header is ignored.
- Accept: needs a session with a verified email. Under the per-user advisory lock and `withOrg(orgId)`, it reads the row
  `for update` where id matches, `status='pending'`, `expires_at > now()` and `email = lower(caller email)`; inserts the
  `member` row if absent; inserts one assignment per scope entry (`on conflict do nothing`, deleted projects skipped);
  marks the invitation accepted; audits `invitation.accepted` and `assignment.granted` (slice 1 shapes). The web then
  navigates to `/o/<slug>/projects` and the `$org` layout calls `setActive`. A double click gets one membership; the
  second call gets 409 (status `accepted`), and the page refetches `GET /api/me/invitations/:id` and shows the "already
  joined" state, with no silent success. Any 409 on accept or decline is handled the same way: refetch and show the new
  state.
- Decline: the same lookup; sets status `declined`; audits `invitation.declined` with the invitee as actor; 204.
- Get mine: looks up the org through `invitation_org_for_email`, then reads under `withOrg`.
- Org header check (T5): in the guard, after the session check and before membership, lookup or body validation. Header
  present and not equal to `session.activeOrganizationId` → 409 `org-mismatch`, no side effect, no audit row. Header
  absent → the session org, as today (curl, integration tests). Applies to the `org`, `project`, `self` and `org-admin`
  kinds; ignored for `user` and `platform`.
- `/auth/*`: `DISABLED_PATHS` becomes an allow-list: `/get-session`, `/sign-in/social`, `/callback/*`, `/sign-out`,
  `/organization/list`, `/organization/set-active`, `/ok`, `/error`. Everything else under `/auth` answers 404.
  Dev-login is its own controller, and server code uses `auth.api`, which skips the router. A test walks every
  better-auth endpoint and asserts allowed or blocked.
- Departure from the requirement wording: the better-auth plugin routes `/organization/create`, `invite-member`,
  `accept-invitation`, `reject-invitation` and `cancel-invitation` stay disabled. Their jobs are done by contracts routes
  on slice 1's tables (slice 1 §Architecture; AGENTS "newer accepted doc wins"; T1). Org creation reuses slice 1's
  `POST /api/platform/orgs`, called by the create-org screen; there is no new create route and the API is unchanged.
- Sign-up refusal: slice 1's `user.create.before` gate throws better-auth `APIError('FORBIDDEN', { code:
  'no_invitation' })`. better-auth 1.7.22's OAuth callback rethrows an `APIError` from user creation and redirects to the
  state's error URL with `?error=<body.code>` (`better-auth/dist/api/routes/callback.mjs:153`,
  `oauth2/link-account.mjs:339`). The web passes `errorCallbackURL` = `/sign-in` (keeping its `redirect` param) to
  `signIn.social`, so a refusal lands on `/sign-in?error=no_invitation`; any other `error` value shows "Sign-in failed".
  The code `no_invitation` is a contracts constant. An integration test asserts the callback redirect.
- Dev-login (enabled only when `AUTH_DEV_LOGIN` is set and not in production, so in every local stack) runs the same
  gate through `auth.api.signUpEmail`; when the response carries code `no_invitation`, it answers 302
  `/sign-in?error=no_invitation` and no user row exists; other failures stay 401. Local e2e covers BR-1 this way, since
  GitHub OAuth is never called in tests.
- Sign-in hooks: the `user.create.before` gate is otherwise unchanged (slice 1). `user.create.after` and
  `session.create.before` no longer accept invitations. `session.create.before` sets the oldest membership as active
  org, or null (T7, slice 1).
- The invite dialog and Invitations page use slice 1's `POST` and `DELETE /api/orgs/:orgId/invitations`,
  `GET /api/orgs/:orgId/invitations` (now with the `status` filter), `GET /api/orgs/:orgId/roles`, `GET /api/me/access`
  and `GET /api/projects`.
- SSE: routes accept an optional `orgId` query param, compared with the session org at connect; mismatch → 409 before
  the stream. Checked at connect only (slice 1 T7), so a stream stays on its org.
- Terminal WebSocket: accepts an optional `orgId` query param, compared at connect; mismatch → close `4412` "org
  changed" (added to the terminal close-code list; 4409 and 4410 are taken, `routes.ts:315`). `reauth` re-checks
  membership and permission in the org fixed at connect, not the session's current org; authority stays session plus
  membership plus permission (AGENTS rule 7).
- No webhook change.

### Third-party libraries

| Library | New or existing | Used for | Approval |
| ------- | --------------- | -------- | -------- |
| better-auth 1.7.22 | existing | session, `organization.list`, `organization.setActive`, sign-in hooks, the OAuth error redirect | existing |
| zod | existing | contracts schemas | existing |
| NestJS | existing | API controllers and guard | existing |
| Drizzle | existing | migration and queries | existing |
| TanStack Router and Query | existing | web routes, queries and mutations | existing |
| better-auth React client | existing | web session and `setActive` | existing |
| Browser Clipboard API | existing (platform API) | Copy link | existing |

No new dependency (T3).

### Services and integrations

| Service | New or existing | How it is used |
| ------- | --------------- | -------------- |
| Postgres | existing | invitation reads and writes, checklist reads, one migration |
| better-auth (in process) | existing | sign-in hooks, `organization/list`, `organization/set-active`, membership rows |
| Temporal, Kubernetes, SecretStore, provider APIs | existing | unchanged |
| Email service | none | no email is sent in this slice (T3) |

### Other decisions

- Worker: no workflow, activity or schedule change (copy-link only, T3; expiry is computed lazily).
- Runner and Kubernetes: no change. Invitation email, org name and slug are untrusted input: Zod-validated, bound
  parameters, rendered as text (AGENTS rule 6).
- Provider adapters: no change. "Connect a code host" uses the generic `connections.capabilities.code`; names are
  provider-agnostic (`checklist`, `connect_code_host`, `x-org-id`) (AGENTS rule 3, ADR-0005).
- Secrets: no new secret. The link carries only the invitation id; no token is stored or hashed. Audit payloads pass
  `redactBody` (slice 1 §Audit). The invitee email is not logged at `info`.
- Events and live updates: no new SSE event. Lists and the checklist are plain queries the web invalidates after
  mutations. An org switch drops the `['org']` cache (existing). On a 409 `org-mismatch`, an SSE error or a WS 4412, the
  web calls `setActive` for its URL org, drops the `['org']` cache and reloads page data (reads refetch; SSE and terminal
  reconnect). A write (POST, PUT, PATCH, DELETE) that got the 409 is never retried automatically: the web shows "This
  organization was switched in another tab. Try again.", keeps the form input, and the user retries (T12). The resync
  runs once at a time per tab (a single in-flight promise), next to the existing 401 handler. Two tabs in use at once
  may take turns resyncing; neither shows the other org's data.
- Config and environment: no new env or flag. The expiry is the contracts constant `INVITATION_EXPIRY_SECONDS = 172800`
  (2 days, T10), the one place it lives (replacing slice 1's 7-day constant); services pass it to SQL
  `now() + make_interval(secs => $1)`. Making it configurable in platform admin is out of scope.
- `setActive` latency (ADR-0008 open check, requirement question 3): one POST, sent only when the URL org differs from
  the session org; same-org navigation sends none (`o.$org.tsx:15`). Closed in this spec and in the new ADR by this
  reasoning, with no timing test.
- What users see on failure: a 409 mismatch on a read is invisible (resync and reload); on a write it shows "This
  organization was switched in another tab. Try again." (T12); a failed `setActive` uses the route error banner;
  accept or decline 404 shows the "invitation not available" state; resend 409 shows the problem title.
- Logs: `info` on mismatch `{requestId, userId, sessionOrgId, headerOrgId}`; on accept, decline and resend
  `{requestId, orgId, invitationId}`; no email at `info`.
- Scale: one extra string compare per request; the checklist is a few indexed queries on `org_id`; my invitations is one
  definer call plus one query per inviting org.
- Races: accept and decline lock the row; resend is a single conditional update (`database.md` §6).
- Sensitive paths touched: auth (allow-list, guard kind `user`, org header check, sign-in hooks), terminal (`orgId`
  param, reauth pinning), RLS and migration (invitation status check, definer `invitation_org_for_email`).
  `review:sensitive` and a high-effort security review.
- ADR: a new ADR (next free number), "Per-request org check and the /auth allow-list": the `x-org-id` header and `orgId`
  param with 409 / 4412, terminal reauth pinned to the connect org, the allow-list, and the `setActive` latency check
  closed. It amends ADR-0003, ADR-0008 and ADR-0014. The same PR fixes slice 1's spec and ADR: auto-accept at sign-in
  replaced by explicit accept and decline (BR-55, BR-56); expiry 2 days and resend of expired invitations (BR-57); the
  list returns every status with a filter; the new definer as the fourth cross-org function; `invitedBy` as
  `InviterDto | null` on `InvitationDto` and `PlatformInvitationDto`.

## UI and Storybook

Screens and components this changes:

- New route `/invitations` (`app/routes/invitations.index.tsx`, outside `/o/$org`): the welcome page. It lists the
  signed-in person's pending invitations with Accept and Decline; with none, the welcome empty state; a platform admin
  also gets "Create organization". `/` and `/projects` send a user with no org here (it replaces today's bare
  no-organization page); also reached from the Projects page banner and by direct link. Screen `screens/MyInvitations.tsx`.
  States: loading, list, empty for a non-admin (welcome copy plus Sign out), empty for a platform admin (plus Create
  organization), error; per card, Accept or Decline in flight (the pressed button pending, the other disabled). Each
  card has Decline on the left and Accept (primary) on the right; dates show as "23 Nov, 14:05" with the full date
  ("23 Nov 2026, 14:05") on hover.
- New route `/invitations/$invitation` (`app/routes/invitations.$invitation.tsx`): the copy-link accept page. Signed out →
  root guard → `/sign-in?redirect=/invitations/<id>` → back here (existing `safeRedirect`). Screen
  `screens/InvitationAccept.tsx`. States: loading, pending, accepting, declining, accepted ("already joined"), declined,
  expired, expired with the inviter deleted (org-wide resend message), revoked (these only for the invitee's own
  invitation, T9), not available (another email or an unknown id), error. The pending state shows a details card
  labelled Role, Access, Invited by and Expires, with Accept first and Decline second; Decline opens the confirm dialog.
  The declined state offers a "Go to invitations" link.
- Inviter deleted (`invitedBy` null, human): `InvitationRow` shows a plain dash under "Invited by"; `InvitationCard` and
  the accept page drop the "Invited by" part (the expiry still shows); the expired message reads "Ask an owner or admin
  of <Org> to resend it."
- New route `/orgs/new` (`app/routes/orgs.new.tsx`, outside `/o/$org`, since a platform admin may have no org): the
  create-org form. Reached from "Create organization" on the welcome page (platform admin with no org) and in the org
  switcher (platform admin). A non-admin who opens it sees `Forbidden`. Screen `screens/CreateOrg.tsx`. States: default,
  slug auto, slug edited, saving, field errors (name, slug format, slug taken, email), org created but invitation failed
  (Banner plus Retry, name and slug read-only), retrying, created (owner link), network or server error on create (form
  Banner), forbidden (non-admin). The form is a 560px centered column. In the invitation-failed state, Retry sits in the
  Banner, the Create button is hidden, and Name and URL are read-only. The created state is a card with the link field,
  "Copy link" and "Done". The forbidden state reuses the existing `Forbidden` copy.
- New route `/o/$org/invitations` (`app/routes/o.$org.invitations.tsx`): the org's invitations with a status filter
  (Pending default, Accepted, Declined, Revoked, Expired, All; T8), Invite people, Copy link, Resend, Revoke. Search
  params `?status=` (Zod enum; a bad value → `pending`; pending left out of the URL) and `?page=`; changing the filter
  resets to page 1. Reached from an "Invitations" button in the Projects page header (and on the empty Projects page),
  shown only to people who can invite. Screen `screens/OrgInvitations.tsx`. States: loading, list, filtered, paged,
  error, forbidden; empty per filter; statuses pending, accepted, declined, revoked and expired, each glyph plus text;
  Expires shows a relative label, an exact date, or a muted dash for accepted, declined and revoked rows; Resend on
  pending and expired rows, Revoke on pending only; a row action in flight disables the row menu. The table has an
  "Actions" column for the row menu; Revoke shows in red in the row menu. The status filter chips show no counts. Status
  icons: Pending an empty circle, Accepted a green check, Declined a grey slashed circle, Revoked a grey crossed circle,
  Expired an orange clock. Other states drawn: row menu open (pending; expired with Resend only), resending, revoke
  confirm, revoked (shown under the All filter), renewed, resend refused, link copied, copy failed (Toast plus a popover
  with the "Invitation link" field), invite dialog (default, some projects, project admin, saving, field error, form
  error, refused because the org was switched in another tab, created).
- Changed `/o/$org/projects` (`screens/Projects.tsx`, `screens/ProjectsEmpty.tsx`): the global top bar shows the org
  switcher, the first-run checklist card, the pending-invitations banner and the "Invitations" button. `Projects` gains
  optional `checklist`, `invitationsBanner`, `invitationsHref` and `canCreate` props. On `ProjectsEmpty`, for owners and
  org admins the live checklist replaces the static `StepCardGrid`; "Create project" is hidden without `project:create`,
  and those people see an `EmptyState` "No projects yet". The banner is hidden at 0, shows a singular or plural count,
  and is hidden if its query fails; it sits at the top of the Projects page in a neutral tone with a mail icon. A member
  sees no switcher (one org), no "Invitations" and no "New project". The existing Projects copy (such as the "GitHub"
  column) is kept. Other states drawn: checklist partial (a new org with one project and no runs), checklist loading,
  checklist error, checklist gone with the banner, no access with the switcher still usable, switching org (loading).
- Changed `/sign-in`: an `error` search param, a Zod enum with the single value `no_invitation` (anything else dropped,
  and the page shows "Sign-in failed"). `SignIn` has no prop change (`error` already takes a node).
- Changed `/` and `/projects`: with no org → `/invitations`. `/` lands in the session's active org, and the URL wins when
  it names one (T7; existing `landingOrg`).
- New `components/OrgSwitch.tsx`: the org name; with 2 or more orgs, or for a platform admin, a button opening a popover
  menu (orgs with the current one `aria-current`, then "Create organization" for platform admins, BR-40); with one org
  and no platform admin, plain text (BR-9). For a platform admin with no org the button reads "No organization" and its
  menu holds only "Create organization". The menu shows a check on the current org and a divider before "Create
  organization". Same keyboard model as `ProjectSwitch`. States: one org (text), several orgs
  (button), platform admin with one org (button), platform admin with no org ("No organization"), menu open, long name
  (ellipsis plus `title`). The org list comes from the already loaded `['session','orgs']`, so the menu has no loading
  state.
- New `components/OnboardingChecklist.tsx`: a card with a heading and four rows (glyph, label, then "Done", or a small
  "Start" button on a todo row that opens where the step is done).
  States: loading (Skeleton rows), error (inline Banner plus Retry; the rest of the page stays usable), none done,
  partial; hidden when done; never rendered for other roles.
- New `components/InvitationRow.tsx`: one row of the org list (email, role, access, status, expires, invited by, row
  menu).
- New `components/InviteDialog.tsx`: the form and the "created" step with the link. States: default, project scope,
  project admin (projects only), saving, field error, form error, created. The Access choices are cards; a project admin
  sees "Some projects" as text with the project checkboxes. The dialog has "Cancel" next to "Create invitation".
- New `components/InvitationCard.tsx`: one invitation for the invitee (org, role, access, inviter, expiry, Accept and
  Decline).
- New `components/InviteLink.tsx`: the labelled read-only link field plus "Copy link", shared by the invite dialog and
  the create-org success view.
- New `components/ExpiryLabel.tsx` (or a pure helper plus `<time>`): the Expires rule (BR-51): a relative label with the
  exact date in `title`; the exact date shown directly once expired more than 3 days.
- Changed `TopBar`: an optional `org` prop renders `OrgSwitch` after `Brand` on the global variant only. The project and
  run variants keep their "org / project" button: the project switcher on Run, Desk and project pages does not change,
  and the org switcher is only in the global top bar, on the Projects, welcome and create-org pages, never on project or
  run pages (human, prototype review).
- Reused from `apps/web/src/ds` and `components`: `FilterChips`/`FilterChip`, `TopBar`, `Popover`, `Dialog`,
  `ConfirmDeleteDialog` (revoke, decline), `EmptyState`, `Banner`, `Toast`, `Field`, `TextInput`, `PrefixInput` (slug
  with `/o/`), `StaticInput` (link field), `Select`, `RadioCard`, `Checkbox`, `Button`, `IconButton`, `InlineStatus`,
  `StatusIcon`, `DataTable`, `Pagination`, `useRowMenu`, `Skeleton`, `RouteLoadError`, `SurfaceCard`.
- Any form or dialog: the two-tab refused write state (Toast, input kept, button re-enabled).
- Pressed buttons show disabled with "Accepting…", "Declining…", "Creating…" or "Retrying…".
- Toast tones: green for "Link copied", "Invitation renewed…" and "Invitation revoked"; red for the copy failure, the
  refused resend and the tab-switched refusal. Toasts have a dismiss button.
- Load and form error states copy `RouteError`: title "Internal server error" plus "Request ID: <id>", with Retry where
  the action can be retried.
- Every other state follows frontend.md §9: pending skeleton after 300 ms; `EmptyState`; 403 `Forbidden`; 404
  `NotFound`; 5xx or network `Banner` plus Retry with the requestId; form field errors or a form Banner; an inline
  mutation Toast.

User flows:

- New invitee (T2, T3): opens `/invitations/<id>` → signs in → back on the accept page → sees org, role, access, inviter
  (display name, else handle) and expiry → Accept → lands on `/o/<slug>/projects`. Decline → confirm → the declined
  state; with no org left, a link to `/invitations`.
- Existing user with a link: the same page; Accept → that org, which now appears in the switcher.
- Existing user without the link: the Projects banner → `/invitations` → Accept or Decline. Other pending invitations
  stay listed after one is accepted (BR-41).
- No org, no invitations, not a platform admin (BR-37): the welcome page with the welcome copy and "Sign out"; no Create
  organization.
- Platform admin with no org (BR-34): the welcome page with "Create organization" (and any pending invitations).
- Create org (BR-35, BR-36, BR-39): `/orgs/new` → Name, URL slug (prefix `/o/`, filled from the name with the contracts
  slug helper until the user edits it), First owner email → "Create organization" → org created → owner invitation
  created (owner role, org scope) → the page switches to "Organization created" with the owner's link (read-only field),
  "Copy link" and "Done". "Done" goes to `/`.
  - Field errors (BR-36): empty or over-long name, slug outside the format, slug taken (409), invalid owner email → the
    matching field error, no org created, input kept.
  - Org created but invitation fails (BR-39): form Banner with the problem title and "Retry"; name and slug become
    read-only (the org exists); the email stays editable; Retry sends only the invitation create for the created org,
    never a second org. A 4xx on the email shows as the email field error, and Retry re-sends after the fix.
  - Network or 5xx on the org create: form Banner, input kept, button re-enabled.
- Accept page, own invitation: expired ("Ask <inviter> to resend it.", or "Ask an owner or admin of <Org> to resend
  it." when the inviter was deleted), revoked, already joined ("Go to <Org>"), declined; no Accept button.
- Accept page, another email or an unknown id (T9): one "not available" state with no org, role or email, plus "Signed in
  as <email>" and "Sign out".
- Own invitation changed while open: Accept or Decline gets 409 → the page refetches the invitation and shows its new
  state; a second Accept (double click or retry) ends on the same "already joined" state. Network or 5xx → Banner plus
  Retry.
- Refused sign-up: better-auth redirects to `/sign-in?error=no_invitation` → the no-invitation Banner. Other failures
  keep "Sign-in failed".
- Switch org (BR-6, BR-7): switcher → `/o/<slug>/projects` → `setActive` and drop the `['org']` cache → pending skeleton
  after 300 ms → the new org's projects. There is no route for switching: switcher org items link to
  `/o/<slug>/projects`, and `o.$org.tsx` runs `setActive`. `setActive` 5xx or network → `LoaderErrorBanner` plus Retry;
  a non-member slug → `NotFound`.
- Two tabs (T5, T12): 409 `org-mismatch` → `setActive` for the URL's org, drop the `['org']` cache, `router.invalidate()`.
  - Reads: silent; at most the pending skeleton.
  - Writes: not retried; the form or dialog keeps its input, its button re-enables, and a Toast says "This organization
    was switched in another tab. Try again."
  - A second 409 after the resync falls through to the normal error states.
- Member with no assignment: the existing `Forbidden` on the projects list; the switcher stays usable.
- Invite (T3, T4): Invitations page → "Invite people" → dialog with Email, Role and Access (Whole organization, or Some
  projects with project checkboxes) → "Create invitation" → "Invitation created" with the link field, "Copy link" and
  "Done" → the list refetches. Failures: 409 already a member or already invited → Email field error; 400 or 422 → field
  errors by pointer; 403 → form Banner; network → form Banner; input kept.
- Copy link (BR-33): row menu on a pending invitation → clipboard → Toast "Link copied". On a clipboard failure, Toast
  "Could not copy. Select the link and copy it." and the link shows in a small popover.
- Resend (T10): row menu on pending and expired rows → pending with a new expiry → refetch → Toast "Invitation renewed.
  It now expires on <date>." (same link). 409 → Toast titled "Invitation is no longer pending" and a refetch.
- Revoke: row menu on pending rows → confirm → refetch → Toast "Invitation revoked". 409 → Toast and a refetch.
  Accepted, declined and revoked rows offer neither Resend nor Revoke (BR-19).
- Checklist (T6, T11): an owner or org admin opens Projects → the "Get started" card; each todo step's "Start" button
  opens where it is done (the focus project's setup step, or the new-project wizard when there is no project); done steps show a
  check; the card is gone once one project has all four. After a platform admin's first owner accepts, the new org's
  checklist shows nothing done (BR-38).

Data, forms and roles:

- Queries go through the contracts `api`; keys start `['org', slug]` except `['session', …]`; DTO → screen mappers in
  `map.ts` take `now`; no optimistic updates; invalidate on success (frontend.md §3).
- `['session','orgs']` (existing): invalidated after Accept and after create org.
- `['session','invitations']`: my pending invitations (`GET /api/me/invitations`), outside `['org']`; invalidated after
  Accept and Decline; also feeds the banner count. `['session','invitations', id]`: one invitation for the accept page;
  refetched on a 409 from Accept or Decline.
- Access: `['org', slug, 'access']` from `GET /api/me/access`, ensured in the `o.$org` layout for `can()`; on pages
  outside an org (welcome, create-org) the same endpoint under `['session','access']` gives `platformAdmin`. Both are
  dropped on sign-out; the org key is dropped on switch.
- `['org', slug, 'invitations', 'list', {status, page, pageSize}]`: invalidated on create, resend and revoke; `?status=`
  default pending; `?page=` with the shared `Pagination` and `usePageSize()` (ADR-0028).
- `['org', slug, 'checklist']`: fetched only when `can(access, 'project:create')` at org scope (owner, org admin; T11);
  invalidated on success of the mutations that complete a step (connection install, project create, agent credential
  put, rule create); no SSE.
- Create org: two `mutateAsync` calls in sequence (platform org create, then platform invitation create); the org id
  from the first is kept in component state so Retry calls only the second (BR-39).
- Accept: invalidate `['session','orgs']` and `['session','invitations']` → navigate to `/o/<slug>/projects` (the layout
  runs `setActive`).
- Switch: no mutation hook; navigation runs `setActive` in `beforeLoad` (`o.$org.tsx`).
- Two-tab 409 handler (T12): next to the existing 401 handler (the `features/auth/signOut.ts` pattern), once at a time:
  `setActive` for the URL org → `cancelQueries` and `removeQueries(['org'])` → `router.invalidate()`. Queries refetch
  through that; mutations reject, and the mutation error mapper recognises the `org-mismatch` problem type and shows the
  fixed T12 text instead of the problem title.
- While a write is in flight, the pressed button shows pending, conflicting buttons are disabled, and input is kept.
- Expires labels use `useNow()` (30 s tick) and the mapper's `now` (frontend.md §3).
- Clipboard: `navigator.clipboard.writeText` (no dependency).
- Forms use TanStack Form validated by the contracts request schemas (slice 1 platform org create and invitation
  create); `mutateAsync`; `fieldErrorsFromProblem` maps pointers (`/name`, `/slug`, `/email`, `/roleId`, `/projectIds`)
  to fields; unmapped errors → form Banner; input kept on failure; pending submit (frontend.md §11). Errors show on
  submit, then update on change.
- Create org: the slug is auto-filled from the name with the contracts slug-from-name helper until the user edits the
  slug; the user's edit wins, and clearing the slug resumes auto-fill. The owner email is validated by the invitation
  schema; the role is fixed to owner and the scope to org (BR-35), not shown as fields.
- Invite role options: the org's roles filtered by what the inviter may grant via `can()` (an owner may grant owner; an
  org admin never owner; a project admin only admin, member and viewer) (slice 1 BR-60). Access: owners and org admins
  choose Whole organization or Some projects; project admins see only Some projects with only the projects they
  administer; at least one project when Some projects is chosen.
- Invitee email, org names, project names and inviter names are untrusted text, rendered as React text only (AGENTS
  rule 6).
- Role-based UI (epic §7.2; the server stays the authority): Create organization (welcome page and switcher item) and
  `/orgs/new` are for platform admins only (`AccessDto.platformAdmin`; BR-34, BR-37, BR-40); others never see the
  control, and a direct visit shows `Forbidden`. The "Invitations" button and the Invitations page actions show with the
  invitation right (`assignment:create` at org scope, or on at least one project for a project admin); others see no
  button, and a direct visit shows `Forbidden`. The checklist card shows only with `project:create` at org scope (owner,
  org admin; T11). "Create project" and "New project" are hidden without `project:create`. OrgSwitch org items, the
  welcome page and the accept page are for every signed-in person.

Visual system, accessibility and layout:

- Tokens only; no new color, font size, radius or spacing scale; spacing copied from the closest existing screen
  (frontend.md §5). Welcome, accept page and create-org use the `ProjectsEmpty` centered column (`emptyMain`/`emptyCol`)
  with the global top bar; not-available and expired states use the `RouteError` centered `EmptyState`. OrgInvitations
  uses the `Projects` list (`listMain`, `listHead`, `DataTable`, `Pagination`) and the Runs filter chips. Dialogs use the
  existing `Dialog` / `ConfirmDeleteDialog` (as in the DeskSkills delete). OrgSwitch uses the `ProjectSwitch` button and
  menu. OnboardingChecklist uses `SurfaceCard` with the `StepCardGrid` spacing.
- Status tones (amber `idle` is reserved for "needs you"): pending `off`, accepted `ok`, declined `off`, revoked `off`,
  expired `late`, always with a text label; checklist done uses the `succeeded` glyph, todo `queued`.
- OrgSwitch: a real `<button>`, `aria-haspopup="dialog"`, `aria-expanded`; ArrowDown opens; arrows, Home and End move
  through the orgs and "Create organization"; Escape closes and returns focus.
- Dialogs: `useFocusTrap`, focus the first field, return focus to the opener; after "Invitation created", focus moves to
  "Copy link". On the create-org success view, focus moves to the "Organization created" heading.
- Row menus: `useRowMenu`; the menu button `aria-label` is "Actions for <email>".
- Field errors via `Field error` (`aria-invalid`, `aria-describedby`); the link field is labelled "Invitation link"; the
  slug field is labelled "URL" with the `/o/` prefix in its accessible description.
- Expires: `<time dateTime>` with the exact date in `title`, and in an `sr-only` span when only the relative label
  shows (hover is not available to keyboard and screen reader users).
- Toasts `role="status"`; error Banners `role="alert"`; status is glyph plus text; one h1 per page; the checklist card
  heading is an h2. Contrast: tokens only, checked in the built Storybook.
- Layout: desktop artboards from `screens/viewports.ts` (1440x900); no new mobile layout. The top bar stays fixed; pages
  scroll. In the Invitations table, email and project names ellipsize with `title`. The checklist card sits between the
  page head and the table (on the empty page, in place of the step cards). Create-org is a single centered 560px column;
  the success view replaces the form in place.

Stories (view fixtures `@/mocks/orgs.ts`, `@/mocks/invitations.ts` and `@/mocks/onboarding.ts` (checklist); DTO
fixtures in `mocks/dto/`; MSW handlers and scenarios):

- `Components/OrgSwitch`: OneOrg, SeveralOrgs, Open, PlatformAdmin, PlatformAdminNoOrg, LongName.
- `Components/OnboardingChecklist`: NoneDone, Partial, Loading, Error.
- `Components/InvitationRow`: Pending, ExpiringSoon, ExpiredRecently, ExpiredLongAgo (exact date), Accepted, Declined,
  Revoked, ProjectScope, LongEmail, InviterDeleted.
- `Components/InviteDialog`: Default, ProjectScope, ProjectAdmin, Saving, FieldError, FormError, Created.
- `Components/InvitationCard`: Default, ProjectScope, Accepting, InviterDeleted.
- `Components/InviteLink`: Default, CopyFailed.
- `Components/TopBar`: GlobalWithOrg, GlobalWithOrgSwitch.
- `Screens/Entry`: ProjectsEmpty (changed), ProjectsEmptyNoCreate, Projects (changed), ProjectsChecklistDone,
  SignInNoInvitation.
- `Screens/Invitations` (new group): MyInvitations, MyInvitationsEmpty, MyInvitationsEmptyPlatformAdmin,
  InvitationAccept, InvitationAcceptExpired, InvitationAcceptExpiredInviterDeleted, InvitationAcceptNotAvailable,
  InvitationAcceptAccepted, OrgInvitations,
  OrgInvitationsAll, OrgInvitationsEmpty, OrgInvitationsPaged, OrgInvitationsInvite, OrgInvitationsCreated, CreateOrg,
  CreateOrgFieldErrors, CreateOrgInvitationFailed, CreateOrgCreated.
- Every approved board (listed under Prototype) has its story, registered with the board as the blocker below says.

Copy (sentence case, short plain sentences, verb buttons; provider-agnostic, "code host"; "<inviter>" is the display
name, else the handle (human); no copy states the expiry length, dates come from `expiresAt`):

- Switcher: `aria-label` "Switch organization, currently <name>" ("Switch organization" on the no-org button); menu
  label "Organizations"; item "Create organization"; no-org label "No organization".
- Projects header button "Invitations". Banner "You have N pending invitation(s)." plus "View".
- Checklist: heading "Get started"; rows "Connect a code host", "Create a project", "Add an agent", "Add a rule"; done
  label "Done"; todo button "Start"; row glyph titles "Done" / "Not done".
- Dates: "23 Nov, 14:05", with the full date "23 Nov 2026, 14:05" on hover.
- Pressed buttons: "Accepting…", "Declining…", "Creating…", "Retrying…".
- Load and form errors: title "Internal server error", "Request ID: <id>", button "Retry".
- ProjectsEmpty without create rights: "No projects yet" / "An owner or admin of this organization creates projects."
- Welcome, no org and no invitations (human): heading "You're not a member of any organization", body "No invitations
  for <email>. Ask an owner or admin to invite you.", button "Sign out". Platform admin variant: the same heading, body
  "Create an organization and invite its first owner.", buttons "Create organization" and "Sign out".
- Welcome with invitations: h1 "Invitations"; card "<Org> invited you as <Role>", an access line ("Whole organization"
  or the project names), "Invited by <inviter>, expires <date>" (inviter deleted, human: no "Invited by" part, so the
  line reads "Expires <date>"); buttons "Accept", "Decline".
- Accept page: h1 "Join <Org>"; not available "This invitation is not available" / "Check that you signed in with the
  email it was sent to, or ask the person who invited you for a new link." plus "Signed in as <email>" and "Sign out";
  expired "This invitation has expired" / "Ask <inviter> to resend it." (inviter deleted, human: "Ask an owner or admin
  of <Org> to resend it."); revoked "This invitation was revoked";
  accepted "You already joined <Org>" plus "Go to <Org>"; declined "You declined this invitation" plus "Go to
  invitations"; pending details labels "Role", "Access", "Invited by", "Expires".
- Decline confirm: "Decline invitation to <Org>?" / "You will need a new invitation to join later." / "Decline" /
  "Cancel".
- Create org: h1 "Create an organization"; fields "Name", "URL" (prefix `/o/`), "First owner email" (hint "They get the
  owner role. Send them the link that appears next."); submit "Create organization"; field errors "Enter a name.", "Use
  lowercase letters, numbers and dashes, with no dash at the start or end.", "Enter a valid email address."; slug taken
  "This URL is taken. Try another."; forbidden reuses "You don't have access" / "Ask an owner of this organization to give
  you access."; invitation failed Banner title from the problem, detail "The organization was created. Retry to create the
  owner invitation."; button "Retry"; success h2 "Organization created", body "Send this link to <email>. It works only
  for that email and expires on <date>.", "Copy link", "Done".
- OrgInvitations: h1 "Invitations"; filter group "Filter by status", chips "Pending", "Accepted", "Declined", "Revoked",
  "Expired", "All"; primary "Invite people"; columns "Email", "Role", "Access", "Status", "Expires", "Invited by",
  "Actions"; row menu "Copy link", "Resend", "Revoke"; empty states: Pending "No pending invitations" plus "Invite people"; other
  filters "No <status> invitations"; All "No invitations yet".
- Expires (human rule): "Expires in <n> days" / "Expires in <n> hours" / "Expired <n> days ago" with the exact date in
  `title`; expired more than 3 days → the exact date shown.
- InviteDialog: title "Invite people"; fields "Email", "Role", "Access" ("Whole organization" / "Some projects"); buttons
  "Cancel" and "Create invitation"; email already invited "This email already has a pending invitation."; created "Invitation created" / "Send this link to <email>. It works only for that email and
  expires on <date>." / "Copy link" / "Done".
- Toasts: "Link copied", "Could not copy. Select the link and copy it.", "Invitation renewed. It now expires on
  <date>.", "Invitation revoked", "Invitation is no longer pending" (resend refused).
- Revoke confirm: "Revoke invitation for <email>?" / "The link stops working." / "Cancel" / "Revoke".
- Sign-in `no_invitation`: Banner "No invitation found for your email" / "Ask an owner or admin of your organization to
  invite you, then sign in again."
- Two-tab refused write Toast (human): "This organization was switched in another tab. Try again."

Agent calls made while drawing the prototype (ui-ux/prototype):

- Agent call: checklist todo rows get a small "Start" button (ui-ux/prototype: the spec was silent; drawn on the
  approved boards).
- Agent call: the pending-invitations banner sits at the top of the Projects page, neutral tone with a mail icon
  (ui-ux/prototype: the spec was silent).
- Agent call: the status filter chips show no counts (ui-ux/prototype: the spec was silent).
- Agent call: the invitation card has Decline on the left and Accept (primary) on the right; the link page puts Accept
  first (ui-ux/prototype: the spec was silent on order).
- Agent call: the link page details card is labelled Role, Access, Invited by, Expires (ui-ux/prototype: the spec was
  silent).
- Agent call: dates show as "23 Nov, 14:05" with the full date on hover (ui-ux/prototype: the spec gave no date
  format).
- Agent call: pressed buttons show disabled with "Accepting…", "Declining…", "Creating…", "Retrying…"
  (ui-ux/prototype: the spec said "pending" without a label).
- Agent call: create-org field errors "Enter a name.", "Use lowercase letters, numbers and dashes, with no dash at the
  start or end.", "Enter a valid email address." (ui-ux/prototype: the spec named the errors but not their text).
- Agent call: the invite dialog email error "This email already has a pending invitation." (ui-ux/prototype: the spec
  named the error but not its text).
- Agent call: the resend-refused Toast title "Invitation is no longer pending" (ui-ux/prototype: the spec said "the
  problem title" without text).
- Agent call: load and form error titles copy `RouteError` ("Internal server error" plus the request ID)
  (ui-ux/prototype: reuses the existing error state).
- Agent call: create-org is a 560px column; the invitation-failed state shows Retry in the Banner, hides the Create
  button and makes Name and URL read-only; success is a card with "Copy link" and "Done" (ui-ux/prototype: the spec
  was silent on width and placement).
- Agent call: Toast tones green (copied, renewed, revoked) and red (copy failed, resend refused, tab switched)
  (ui-ux/prototype: the spec was silent).
- Agent call: status icons Pending empty circle, Accepted green check, Declined grey slashed circle, Revoked grey
  crossed circle, Expired orange clock (ui-ux/prototype: drawn from the tones the spec set).
- Agent call: Revoke shows in red in the row menu (ui-ux/prototype: destructive action).
- Agent call: the copy-failed popover holds an "Invitation link" field (ui-ux/prototype: the spec said "a small
  popover" without content).
- Agent call: the invite dialog's Access choices are cards; a project admin sees "Some projects" as text with
  checkboxes (ui-ux/prototype: the spec was silent).
- Agent call: the switcher menu has a check on the current org and a divider before "Create organization"; the no-org
  button's label is "Switch organization" (ui-ux/prototype: the spec was silent).
- Agent call: the revoked board uses the All filter (ui-ux/prototype: so the revoked row stays visible).
- Agent call: create-org Forbidden reuses "Ask an owner of this organization to give you access.", which reads oddly
  outside an org (ui-ux/prototype: reuses the existing `Forbidden` state as the spec says).
- Agent call: existing copy such as the Projects "GitHub" column is kept (ui-ux/prototype: prototype copy is not
  rewritten, frontend.md §8).
- Agent call: the partly done checklist board uses a new org with one project and no runs (ui-ux/prototype: the spec
  was silent).
- Agent call: the table has an "Actions" column header for the row menu, the declined state links "Go to invitations",
  the invite dialog and revoke confirm have "Cancel", and Toasts have a dismiss button (ui-ux/prototype: the spec was
  silent; drawn on the approved boards).
- Agent call: no separate boards for the switch-org failure (the existing `RouteError` covers it), the existing
  "Sign-in failed" state, or the tab-switched refusal on create-org (the same Toast as on the invite dialog)
  (ui-ux/prototype: existing or identical states).

Prototype: approved by the human at gate P2 as drawn, with no changes (68 boards): `design/prototype/project/CreateOrg.dc.html`, `design/prototype/project/CreateOrgCreated.dc.html`,
`design/prototype/project/CreateOrgError.dc.html`, `design/prototype/project/CreateOrgFieldErrors.dc.html`,
`design/prototype/project/CreateOrgForbidden.dc.html`, `design/prototype/project/CreateOrgInvitationFailed.dc.html`,
`design/prototype/project/CreateOrgRetrying.dc.html`, `design/prototype/project/CreateOrgSaving.dc.html`,
`design/prototype/project/CreateOrgSlugAuto.dc.html`, `design/prototype/project/CreateOrgSlugEdited.dc.html`,
`design/prototype/project/CreateOrgSlugTaken.dc.html`, `design/prototype/project/InvitationAccept.dc.html`,
`design/prototype/project/InvitationAcceptAccepted.dc.html`,
`design/prototype/project/InvitationAcceptAccepting.dc.html`,
`design/prototype/project/InvitationAcceptDeclineConfirm.dc.html`,
`design/prototype/project/InvitationAcceptDeclined.dc.html`,
`design/prototype/project/InvitationAcceptDeclining.dc.html`,
`design/prototype/project/InvitationAcceptError.dc.html`, `design/prototype/project/InvitationAcceptExpired.dc.html`,
`design/prototype/project/InvitationAcceptExpiredInviterDeleted.dc.html`,
`design/prototype/project/InvitationAcceptLoading.dc.html`,
`design/prototype/project/InvitationAcceptNotAvailable.dc.html`,
`design/prototype/project/InvitationAcceptRevoked.dc.html`, `design/prototype/project/MyInvitations.dc.html`,
`design/prototype/project/MyInvitationsAccepting.dc.html`, `design/prototype/project/MyInvitationsEmpty.dc.html`,
`design/prototype/project/MyInvitationsEmptyPlatformAdmin.dc.html`,
`design/prototype/project/MyInvitationsError.dc.html`, `design/prototype/project/MyInvitationsLoading.dc.html`,
`design/prototype/project/OrgInvitations.dc.html`, `design/prototype/project/OrgInvitationsAll.dc.html`,
`design/prototype/project/OrgInvitationsCopyFailed.dc.html`,
`design/prototype/project/OrgInvitationsCreated.dc.html`, `design/prototype/project/OrgInvitationsEmpty.dc.html`,
`design/prototype/project/OrgInvitationsEmptyAll.dc.html`,
`design/prototype/project/OrgInvitationsEmptyFiltered.dc.html`,
`design/prototype/project/OrgInvitationsError.dc.html`, `design/prototype/project/OrgInvitationsFiltered.dc.html`,
`design/prototype/project/OrgInvitationsForbidden.dc.html`, `design/prototype/project/OrgInvitationsInvite.dc.html`,
`design/prototype/project/OrgInvitationsInviteFieldError.dc.html`,
`design/prototype/project/OrgInvitationsInviteFormError.dc.html`,
`design/prototype/project/OrgInvitationsInviteProjectAdmin.dc.html`,
`design/prototype/project/OrgInvitationsInviteProjects.dc.html`,
`design/prototype/project/OrgInvitationsInviteSaving.dc.html`,
`design/prototype/project/OrgInvitationsInviteTabSwitched.dc.html`,
`design/prototype/project/OrgInvitationsLinkCopied.dc.html`,
`design/prototype/project/OrgInvitationsLoading.dc.html`, `design/prototype/project/OrgInvitationsPaged.dc.html`,
`design/prototype/project/OrgInvitationsRenewed.dc.html`,
`design/prototype/project/OrgInvitationsResendConflict.dc.html`,
`design/prototype/project/OrgInvitationsResending.dc.html`,
`design/prototype/project/OrgInvitationsRevokeConfirm.dc.html`,
`design/prototype/project/OrgInvitationsRevoked.dc.html`, `design/prototype/project/OrgInvitationsRowMenu.dc.html`,
`design/prototype/project/OrgInvitationsRowMenuExpired.dc.html`,
`design/prototype/project/ProjectsChecklist.dc.html`, `design/prototype/project/ProjectsChecklistDone.dc.html`,
`design/prototype/project/ProjectsChecklistError.dc.html`,
`design/prototype/project/ProjectsChecklistLoading.dc.html`,
`design/prototype/project/ProjectsEmptyChecklist.dc.html`, `design/prototype/project/ProjectsEmptyNoCreate.dc.html`,
`design/prototype/project/ProjectsMember.dc.html`, `design/prototype/project/ProjectsNoAccess.dc.html`,
`design/prototype/project/ProjectsOrgSwitchAdmin.dc.html`, `design/prototype/project/ProjectsOrgSwitchOpen.dc.html`,
`design/prototype/project/ProjectsSwitching.dc.html`, `design/prototype/project/SignInNoInvitation.dc.html`.
Not drawn as separate boards: the switch-org failure (the existing `RouteError` covers it), the existing "Sign-in
failed" state, and the tab-switched refusal on create-org (the same Toast as on the invite dialog).
The existing `Projects`, `ProjectsEmpty` and `ProjectsPaged` boards are left as they are (human); their drift (org in
the top bar, checklist, Invitations button, banner) is recorded in `design/parity-notes.md` with the reason that the new
boards next to them show the approved design (frontend.md §8).

**Blocker: Storybook first.** Before any task that implements this UI in `apps/web/src/{app,features}` or wires it to
data starts, the related Storybook stories are added or updated and reviewed: every changed or new `ds/`,
`components/` and `screens/` piece has a story for each state above (default, loading, empty, error, and the others the
spec names), fed from `@/mocks` fixtures, matching the approved prototype boards, with each new board registered in
`canvas.json`, `screens/storyIds.ts` and `scripts/parity.mjs` together. No UI implementation work begins until that is
done.

## Testing

Confirmed by the human at planning time.

Every business rule and every not-observable behaviour gets a test at the lowest layer that proves it, plus e2e
(AGENTS.md › Workflow; `testing.md` §1, §8). File names are proposals; the plan fixes them per package convention.
Abbreviations: "onb int" = `apps/api/test/onboarding.int.test.ts` (new: my invitations, accept, decline, resend,
checklist, org-mismatch table); "auth int" = `apps/api/test/auth.int.test.ts`; "inv int" = slice 1
`apps/api/test/invitations.int.test.ts`; "platform int" = slice 1 `platform.int.test.ts`; "terminal int" and "sse int" =
the existing files; "contracts" = `packages/contracts/src/*.test.ts`; "db int" =
`packages/db/test/{migrate,rls}.int.test.ts`; "web" = colocated `X.test.tsx` and `*.route.test.tsx` plus stories.

| Rule | Behaviour | Layer | Where the test lives | E2E env |
| ---- | --------- | ----- | -------------------- | ------- |
| BR-1 | No account, no invitation: sign-in refused with the no-invitation message | integration (sign-up gate kept; a refused social sign-in and a refused dev-login both end at 302 `/sign-in?error=no_invitation`, no user row); component (sign-in route test: `?error=no_invitation` shows the no-invitation message; any other `error` value shows "Sign-in failed"; the value is matched, never rendered) | inv int or auth int; sign-in route test | local + mock |
| BR-2 | Invited new person sees the invitation and is not a member until Accept | integration (not a member until accept; the sign-in hook no longer auto-accepts); component (welcome route test) | onb int; welcome route test | local |
| BR-3 | Existing user sees a notice; not auto-joined | integration (not auto-joined); component (route test: notice) | onb int; web | local |
| BR-4 | Expired or revoked invitation not listed, cannot be accepted | integration (expired by past `expires_at`, revoked: absent from `/api/me/invitations`; accept 409/404) | onb int | mock (expired part: not e2e on local) |
| BR-5 | Other email sees "not available" | integration (N-9); component (route test: "not available" with no org, role or email) | onb int; accept route test | local |
| BR-6 | Switcher lists the user's orgs, current marked | component (OrgSwitch test), stories | `OrgSwitch.test.tsx` | mock |
| BR-7 | Switch changes URL and projects; reload stays | component (route tests in `features/auth/auth.test.tsx`, org layout) | web | local |
| BR-8 | Signed-out deep link lands in that org after sign-in | component (existing redirect route tests) | web | local |
| BR-9 | One org, not platform admin: no switcher | component (OrgSwitch test), stories | `OrgSwitch.test.tsx` | mock |
| BR-10 | Loading state, no previous org data while switching | component (route test with delayed `set-active`) | web | mock |
| BR-11 | Stale tab never touches the other org; reads resync; writes refused once with the T12 message | integration (N-5 table over every org route; sse int; terminal int, N-6); contract (the client sends `x-org-id`); unit (web: a read that gets 409 calls `set-active` for the URL org and refetches; a write that gets 409 is sent once, never retried, and shows "This organization was switched in another tab. Try again."; SSE error and 4412 resync) | onb int; sse int; terminal int; contracts client test; web | local |
| BR-12 | Non-member org link: not found | component (route test) | web | mock |
| BR-13 | Owner or admin sees the four-step card | integration (each step; focus project; steps split across two projects → not complete); component (OnboardingChecklist test) | onb int; `OnboardingChecklist.test.tsx` | local |
| BR-14 | Completed step shows done after reload | integration (each step; focus project); component (OnboardingChecklist test) | onb int; `OnboardingChecklist.test.tsx` | local |
| BR-15 | Item opens the focus project's step, or the wizard | component (link to the focus project's step, wizard when none) | web | mock |
| BR-16 | Card gone once one project has all four | integration (focus project; split steps → not complete); component (OnboardingChecklist test) | onb int; `OnboardingChecklist.test.tsx` | local |
| BR-17 | No card for project admin, member, viewer | integration (checklist 403 for project admin, member, viewer); component (route test: no card) | onb int; web | mock |
| BR-18 | Resend on pending or expired: pending, new expiry, same link | integration (pending and expired → pending, `expires_at` = database `now()` + 2 days, same id); component (route test) | onb int; web | local (resend of an expired row: not e2e on local) |
| BR-19 | Final rows offer no actions; a changed row gives an error and refresh | integration (accepted, declined, revoked → 409; resend vs revoke race; resend of an expired invitation while a newer pending one exists for the email → 409); component (no actions on final rows; route test: 409 → error, refetch) | onb int; web | mock (the 409 race at the API: not e2e) |
| BR-20 | Member or viewer: no invite controls; Invitations URL shows no-access | integration (slice 1 403); component (route test: controls hidden, page no-access) | inv int; web | mock |
| BR-21 | Accept lands in the org with exactly the invited projects | integration (member plus one assignment per listed project, deleted projects skipped); component (route test) | onb int; web | local |
| BR-22 | Decline: not joined; inviter sees Declined | contract; integration (status declined, no member; db int: status) | contracts; onb int; db int | local |
| BR-23 | Accept or Decline on a changed invitation: refetch, new state, no change | integration (accept and decline on revoked or expired → 409, no change); component (route test: 409 → refetch the invitation, show its new state, no Accept or Decline) | onb int; accept route test | local (expired part: not e2e on local) |
| BR-24 | Signed-out `/invitations/<id>` → sign in → back to the invitation | component (route test: signed-out `/invitations/<id>` → `/sign-in?redirect=`) | web | local |
| BR-25 | Matching person sees org, role, scope, inviter (name, else handle), expiry | integration (`MyInvitationDto` fields per state, `invitedBy` an `InviterDto`); component (route test per state; renders `invitedBy.name` as given) | onb int; web | local + mock |
| BR-26 | Resolved invitation shows its state, no buttons | integration (`MyInvitationDto` fields per state, `invitedBy` an `InviterDto`); component (route test per state; renders `invitedBy.name` as given) | onb int; web | local + mock |
| BR-27 | Invite dialog creates a pending invitation and shows the link | contract (slice 1 schema); component (InviteDialog test); integration (slice 1) | contracts; web; inv int | local |
| BR-28 | Invite dialog field errors, nothing created | contract; integration (slice 1 BR-59); component (field errors by pointer) | contracts; inv int; web | mock |
| BR-29 | Role and scope options per inviter | component (role and scope options per access); integration (slice 1 BR-60 refusals) | web; inv int | mock |
| BR-30 | Invitations page defaults to Pending, paged | contract (`status` filter enum, default pending); integration (filter on tenant and platform lists); component (route test: search param, default pending, paged); unit (Expires label mapper, `it.each` with injected `now`: future → relative, expired up to 3 days → relative, expired over 3 days → exact date; exact date in the hover title otherwise; pinned time zone) | contracts; onb int; web | local + mock |
| BR-31 | Project admin sees only invitations on projects they administer | integration (only invitations whose every project they administer) | onb int or inv int (the plan picks) | local |
| BR-32 | Revoke shows Revoked; the link is no longer valid | integration (slice 1 revoke); component (route test) | inv int; web | local |
| BR-33 | Copy link copies and confirms | component (stubbed `navigator.clipboard`, toast) | web | mock |
| BR-34 | Platform admin with no org: welcome offers Create organization | component (route test; switcher Create organization for a platform admin) | web | local |
| BR-35 | Create-org form creates the org and shows the owner link | integration (slice 1 platform create plus invite); component (route test) | platform int; web | local |
| BR-36 | Create-org field errors, no org | contract; integration (slice 1 BR-73, 409 slug); component (field errors) | contracts; platform int; web | mock |
| BR-37 | Non-admin with no org and no invitation: welcome copy, Sign out, no Create | component (route test: heading "You're not a member of any organization", "No invitations for <email>. Ask an owner or admin to invite you.", Sign out signs out; no Create organization) | web | mock |
| BR-38 | First owner accepts and sees the checklist with nothing done | integration (owner accept → owner assignment; checklist all not done) | onb int | local |
| BR-39 | Owner invitation fails after create: Retry creates only the invitation | component (route test: the invite call fails after create → error plus Retry sends only the invitation) | web | mock |
| BR-40 | Platform admin's switcher offers Create organization | component (route test; switcher Create organization for a platform admin) | web | local |
| BR-41 | Accepting one invitation leaves the others pending | integration (accept one, others stay pending) | onb int | local |
| BR-42 | Double Accept: one membership, second ends on "already joined" | integration (`Promise.all` of two accepts → one member, one audit row; the second gets 409 and a refetch shows accepted); component (route test: second Accept → 409 → refetch → "already joined") | onb int; accept route test | local |
| BR-43 | Sign-in without a link lands in the oldest org | integration (a new session for a user in two orgs starts in the oldest) | auth int | local |
| BR-44 | No-role member sees no-access and can still switch | component (route test: 403 → Forbidden, switcher still works) | web | mock |
| BR-45 | Declining every invitation leaves an account with no org | integration (declining all leaves an account with no org; next session active org null) | onb int | local |
| BR-46 | Non-admin org creation: 403, no control | integration (slice 1 BR-70); component (route test: no control) | platform int; web | mock (the API 403: not e2e) |
| BR-47 | Each status filter shows only its rows; page count follows | contract (filter values All, Pending, Accepted, Declined, Revoked, Expired); integration (each value returns only that status, `total` follows; expired computed from `expires_at`); component (route test: the filter changes the list and page count) | contracts; onb int; web | local |
| BR-48 | After 2 days: Expired for the inviter, gone from the invitee's list, link says expired | integration (pending row with `expires_at` in the past: listed as expired to the inviter, absent from `/api/me/invitations`, `/api/me/invitations/:id` shows expired to the matching invitee); component (route test: expired state on the accept page) | onb int; web | mock (not e2e on local) |
| BR-49 | Resent expired invitation: the same link shows Accept and Decline again | integration (resend of an expired row → pending, same id; the invitee's get shows pending again and accept works) | onb int | mock (not e2e on local) |
| BR-50 | Resend of an expired invitation while another is pending: "already invited", no change | integration (409 "already invited" problem, no change); component (route test: error shown, list unchanged) | onb int; web | mock (not e2e on local) |
| BR-51 | Expires column: relative with exact date on hover; exact date once expired over 3 days | unit (Expires label mapper, `it.each` with injected `now`: pending → relative; expired up to 3 days → relative; expired over 3 days → exact date; exact date in the hover title when relative; boundary at exactly 3 days, just under and just over; pinned time zone); component (route test: Invitations page Expires column) | web | mock (over-3-days case: not e2e on local) |
| BR-52 | Inviter shown as display name, else handle | contract (`InviterDto {name, handle}`, `invitedBy: InviterDto \| null` on `MyInvitationDto`, `InvitationDto`, `PlatformInvitationDto`); integration (server fallback: name = trimmed display name; empty or whitespace name → handle; deleted inviter → null; the same on my invitations and the tenant and platform lists); component (route tests: the Invitations page "Invited by" column and the accept page render `name` as given; a null `invitedBy` shows a plain dash in the "Invited by" column, no "Invited by" line on the invitee card, and the expired message "Ask an owner or admin of <Org> to resend it.") | contracts; onb int; web | local + mock |
| — (N-1) | Every better-auth route outside the allow-list answers 404, including normalization variants | integration (table over the installed better-auth route list) | auth int | — |
| — (N-2) | Audit rows `invitation.resent`, `invitation.declined`, `invitation.accepted` plus `assignment.granted`, in the target org, same transaction | integration (`audit_log` read under `withOrg`) | onb int | — |
| — (N-3) | No invitee email at `info`; the mismatch log carries ids only | integration (`createTestApp({ logger })`, captured logger) | onb int | — |
| — (N-4) | `set-active` to a non-member org: 403, session unchanged | integration | auth int | — |
| — (N-5) | Org header absent → session org; equal → normal; different → 409 before membership, lookup or body validation, no side effect, no audit row; ignored on `user` and `platform` kinds | integration (route-discovery table) | onb int | — |
| — (N-6) | SSE `orgId` mismatch → 409 before the stream; terminal `orgId` mismatch → close 4412; terminal reauth checks the connect org, so a switch in another tab does not close it, while losing membership there still closes 4403 | integration | sse int; terminal int | — |
| — (N-7) | `declined` migration is additive (existing pending, accepted, revoked and expired rows, including 7-day pending rows, unchanged); RLS holds | integration | db int (migrate, rls) | — |
| — (N-8) | `INVITATION_EXPIRY_SECONDS` is 172800 and is the only expiry source; create sets `now()` + 2 days | contract; integration | contracts; onb int | — |
| — (N-9) | `/api/me/invitations/:id` answers the same 404 for another email's invitation as for a random id | integration | onb int | — |

E2E specs, one per surface so targeted runs stay short: `apps/web/e2e/local/onboarding.spec.ts` (invite, accept,
decline, link states, platform create-org), `apps/web/e2e/local/org-switch.spec.ts` (switcher, landing, two tabs),
`apps/web/e2e/local/checklist.spec.ts`, `apps/web/e2e/mock/onboarding.spec.ts`, `apps/web/e2e/mock/org-switch.spec.ts`,
`apps/web/e2e/mock/invitations.spec.ts`, `apps/web/e2e/mock/checklist.spec.ts`. `local` when the API, session or
membership is crossed; `mock` when the web app alone proves it (`tests-and-e2e.md` §3a).

Local e2e scenarios (stack up; the dev platform admin `admin@dev.local` from slice 1's `.env.example`; fresh
`e2e-<rand>` handles):

- BR-1: a fresh uninvited `e2e-<rand>` handle opens `/auth/dev-login?handle=e2e-<rand>` → lands on
  `/sign-in?error=no_invitation` with the no-invitation message; no session (`/auth/get-session` is null).
- BR-52: in the BR-2 flow below, the invitee's page and the inviter's "Invited by" column show the inviter as their
  handle (dev-login users are named after the handle).
- BR-34, BR-35, BR-40, BR-38: the platform admin (never a member of any org) signs in → the welcome page offers Create
  organization → creates an org with an `e2e-<rand>` owner email → the copy link shows → an owner context opens the link
  → Accept → lands on the projects page with the checklist showing nothing done.
- BR-2, BR-21, BR-25, BR-27, BR-24: an owner invites `e2e-<rand>@dev.local` on two projects through the dialog and reads
  the link from the field; a signed-out invitee context opens the link → sent to `/sign-in?redirect=/invitations/<id>`
  → dev-login with that redirect → back on the invitation (org, role, scope, inviter, expiry) → Accept → lands in the
  org, sees exactly the two projects, and the org is in the switcher.
- BR-3, BR-41: a user already in org A has invitations from orgs B and C → the notice opens the list → accepts B → C
  stays pending; B is in the switcher, C is not.
- BR-22, BR-45: a new invitee declines their only invitation → the welcome page with no org; the inviter's Invitations
  page (filter Declined) shows it; signing in again shows the same welcome page.
- BR-5: a different handle opens the link → "not available" with no org name, role or email; no membership.
- BR-23, BR-32, BR-26: the invitee opens the link; the inviter revokes; Accept → the page refetches and shows Revoked
  ("no longer valid") with no Accept or Decline, and nothing changes; the inviter's row shows Revoked.
- BR-42: the invitee opens the link in two pages; Accept in the first lands in the org; Accept in the second → the page
  refetches and shows "already joined"; one membership.
- BR-18, BR-30, BR-47: the inviter's Invitations page defaults to pending; Resend on a pending row shows a new expiry
  (about 2 days out, relative label) and the same link; each status filter (All, Pending, Accepted, Declined, Revoked)
  shows only its rows from earlier steps, and the page count follows.
- BR-31: a project admin on P1 (slice 1 grant helper) opens Invitations and sees the P1 invitation, not the org-scope
  one.
- BR-7, BR-43: a user in orgs A (joined first) and B switches with the switcher → URL, heading and projects follow;
  reload stays in B; sign out and dev-login with `redirect=/` → lands in A.
- BR-8: a signed-out deep link to `/o/<B>/projects` for a user whose session would start in A → dev-login with that
  redirect → B's projects.
- BR-11 (T12): two pages in one context (shared cookie) on A and B; page B switches to B; page A then navigates and shows
  only A's data (read resync); page A saves a rule change → "This organization was switched in another tab. Try again."
  shows, the rule is unchanged in A and in B, and exactly one write request was sent (counted with Playwright
  `page.on('request')` filtered to the rule's write route, not by timing); clicking save again applies the change to A
  only.
- BR-13, BR-14, BR-16: a new org (the BR-38 path) shows the card with nothing done; the `signInAndCreateProject` steps
  tick items after reload; once one project has all four, the card is gone, with one and with two projects.

Mock e2e scenarios (web alone):

- BR-1: the sign-in redirect lands on `/sign-in?error=no_invitation` → the no-invitation message, no session;
  `?error=other` → "Sign-in failed".
- BR-48: the Expired filter and rows (fixtures with `page.clock`): expired 1 day ago shows the relative label with the
  exact date on hover; expired 5 days ago shows the exact date directly; the matching invitee's link shows Expired with
  no Accept or Decline.
- BR-49, BR-50: Resend on an expired row → the row becomes Pending with a new expiry; Resend on an expired row whose
  email already has a pending invitation → "already invited" error, list unchanged (mockDb enforces the rule).
- BR-4: the invitee's list without expired or revoked invitations (fixtures); BR-26: the expired and declined states on
  the accept page with a fixed clock.
- BR-6, BR-9, BR-10, BR-12, BR-44: the switcher with the seed orgs, keyboard, a one-org scenario, a delayed `set-active`
  loading with no old data, `/o/unknown/projects` not found, a 403 org shows Forbidden and the switcher still switches.
- BR-15: each checklist item opens the right step (the wizard when there is no project).
- BR-17: project admin, member and viewer scenarios show no card.
- BR-19: no Resend or Revoke on final rows; a 409 on Resend shows the error and refetches.
- BR-20: member scenario: no Invite or Invitations control; the Invitations URL shows no-access.
- BR-28, BR-29: dialog field errors (invalid email, no project, already member, already invited) and role and scope
  options for an org admin and a project admin.
- BR-30: the filter control, default pending, paged.
- BR-33: Copy link shows the confirmation (clipboard stubbed with `addInitScript`).
- BR-36, BR-39: create-org field errors (empty, long, bad slug, taken slug, bad email); an invitation failure after
  create → Retry sends only the invitation (the request log shows one org create).
- BR-37: a non-admin with no org and no invitation → heading "You're not a member of any organization", "No
  invitations for <email>. Ask an owner or admin to invite you.", Sign out returns to sign-in; no Create organization.
- BR-51: the Invitations page Expires column with `page.clock`: pending shows a relative label with the exact date on
  hover; expired 1 day ago shows the relative label with hover; expired 5 days ago shows the exact date directly.
- BR-52: fixtures with an `InviterDto` whose `name` is the handle (server fallback) and one with a display name: the
  Invitations page "Invited by" column and the accept page show `name`.
- BR-46: a non-admin sees no create-org control (the API refusal is in integration).

Changed tests and bug fixes: no bug fix is in scope; BR-43's landing org is today's behaviour, so it needs no failing
test first. New behaviours are written red first (`testing.md` §6). Tests that change because rules change: slice 1's
auto-accept tests (BR-55, BR-56) become accept and decline tests; slice 1's 7-day expiry tests become 2 days; an existing
terminal test that expects 4403 after an org switch (if one exists after slice 1) changes to "stays open" (N-6).

Determinism: expiry tests use rows with `expires_at` in the past; create and resend assert `expires_at` against the
database `now()` read in the same test (within a minute of now + 172800 s); no `Date.now()` in invitation logic
(`testing.md` §5). The Expires label mapper takes `now: Date`; the 3-day boundary is tested at exactly 3 days, just under
and just over; exact dates use a pinned time zone or an injected formatter (`testing.md` §5). Relative labels in mock
e2e use a fixed clock with `page.clock` (as the session specs do with `SESSION_MOCK_NOW`); local e2e asserts the label
changed, not its exact text. Org switch tests wait for the URL and a heading of the new org; the two-tab test waits for
page B's switch (URL and heading) before acting in page A; no timeouts. Two people use separate browser contexts with
fresh `e2e-<rand>` handles and orgs per test; the shared platform admin only creates orgs and never accepts an
invitation, so "platform admin with no org" holds on a shared stack. The link is read from the visible field in e2e;
copy is asserted with a stubbed clipboard. `set-active` latency has no timing assertion (closed by analysis).
Concurrency (double accept, resend vs revoke) uses `Promise.all` and asserts the final state, not the order.

### Not provable by e2e

- Invitation expiry on the local stack (the expired part of BR-4 and BR-23, BR-18's resend of an expired invitation,
  BR-48, BR-49, BR-50): a 2-day timer the shared stack cannot skip, and there is no test-only API to age an invitation.
  Integration with `expires_at` in the past proves the server side, and mock e2e with fixtures and `page.clock` proves
  what the user sees.
- BR-51's over-3-days case on the local stack: local only creates pending rows with a 2-day expiry (no aged rows
  without a backdoor); the relative label is seen in the BR-18 local step, and the over-3-days case is proved by mock
  e2e and the mapper unit test.
- The social sign-in's `error=no_invitation` redirect: GitHub OAuth is never called in tests, so integration proves the
  social path's redirect, and local e2e proves BR-1 through dev-login.
- Unverified email: dev-login always verifies and GitHub OAuth is never called in tests; proved in integration with
  `email_verified = false`.
- BR-19's 409 race and BR-46's 403 at the API: the UI never offers the action; proved in integration (mock e2e covers
  what the user sees).
- N-1 to N-9: no user path or read route; proved by integration, db or contract tests.

### Fakes and fixtures

- No network: existing fakes cover every outside call (`testing.md` §4): dev-login (obeys slice 1's sign-up gate), the
  fake provider and `/api/connections/fake/install`, the file-backed `FakeKubeGateway`, `FakeTemporalClient`,
  `MemorySecretStore`, MSW `onUnhandledRequest: 'error'`, `FakeEventSource`, `FakeWebSocket`. Copy-link needs no mail
  sender and no mail fake (T3). No new fake class.
- API integration: reuse slice 1 helpers (`asPlatformAdmin`, `createOrg`, `grant`, and `inviteAndLogin` changed to invite
  plus dev-login plus accept); new helpers `invite`, `myInvitations`, `acceptInvite`, `declineInvite` and `resend`
  calling the real endpoints; a request helper that sets `x-org-id`. Expired (`expires_at` in the past), revoked,
  unverified and stale-pending rows only by direct database writes (`testing.md` §3).
- Local e2e: reuse slice 1 `apps/web/e2e/local/helpers.ts`; `signInAndCreateProject` keeps slice 1's API setup with the
  accept step added inside the helper, so other specs do not change; new `inviteByUi(page, email, role, scope)` (returns
  the link read from the field), `signInAs(context, handle, redirect)` and `asPlatformAdmin(context)`.
- Web: DTO fixtures in `apps/web/src/mocks/dto/` (`MyInvitationDto` in each state, `InviterDto` with a display name,
  with the handle as name, and `invitedBy: null`, org invitations in every status, `OrgChecklistDto` none, partial and
  complete) parsed with the contracts schemas (`mocks/msw/contract.test.ts`); MSW handlers for every new route, the
  `status` filter, resend, accept and decline, and the 409 `org-mismatch`; mockDb gains invitations, a platform-admin
  flag and the org check; view fixtures `@/mocks/{orgs,invitations,onboarding}.ts` (`onboarding.ts` holds the checklist
  fixtures) shared by stories and mock e2e.
- Mock scenarios, selected through sessionStorage keys like `agentdesk.mock.auth` (no app test hook): no org with
  invitations, no org without, platform admin with no org, single org, member, project admin, viewer, invitations
  error, checklist partial and complete.
- The web unit test for T12 lives next to the API error handling in `apps/web/src/features/` (the plan picks the file);
  MSW answers 409 `org-mismatch` once, and the test asserts the handler was hit once for a write and twice (after
  `set-active`) for a read.
- Stories for each new component and state (smoke plus axe).

### Security tests

- Allow-list (N-1): every installed better-auth route outside `/get-session`, `/sign-in/social`, `/callback/*`,
  `/sign-out`, `/organization/list`, `/organization/set-active`, `/ok`, `/error` answers 404 to a signed-in owner,
  including normalization variants; the test walks the plugin's route list, so a new route fails it.
- Org check (N-5, N-6): a route-discovery table over every `org`, `project`, `self` and `org-admin` route with a
  different `x-org-id` → 409 and nothing written (no row, no Temporal start, no secret, no audit); SSE 409 before any
  frame; terminal 4412 before any bytes; a header naming another org the user is not in never returns that org's data.
- Terminal reauth pinned to the connect org: a switch elsewhere keeps it open; losing membership or permission in the
  connect org still closes 4403 on reauth (AGENTS rule 7).
- Email binding (T9): another email's invitation id and a random id give the same 404 body (N-9); an unverified email
  cannot accept; accept and decline need a session (401).
- State: expired, revoked, declined and accepted invitations cannot be accepted or declined; resend only on pending or
  expired, never creating a second pending invitation for an email.
- Authz per new endpoint: resend follows slice 1 invitation rights (403 for member, viewer, and project admin outside
  their projects; 404 for another org; the platform mirror needs `platform-invitation:update`); checklist 403 for anyone
  but org owner and org admin (T11); the list filter does not widen what a project admin sees (BR-31).
- Org creation: non-platform callers get 403 and no org (BR-46; slice 1 test kept).
- `set-active` to a non-member org: 403, session unchanged (N-4).
- Cross-org: the `invitations` RLS leak test gains a declined row (N-7); lists show only the target org's rows.
- Open redirect: the `redirect` for `/invitations/<id>` keeps the existing relative-path rules (one case added to the
  existing tables).
- Sign-in `error` param: only the fixed value `no_invitation` selects the specific message; any other value (including
  HTML or a long string) shows "Sign-in failed" and is never rendered.
- Untrusted text: invitee email and org name with HTML and SQL metacharacters round-trip unchanged and render as text.
- Secrets: no new secret; N-3 log capture.
- Migration: `migrate.int.test.ts` applies the new migration on a database with pending, accepted, revoked and expired
  rows and leaves them unchanged, accepts `declined`, and still rejects an unknown status; `rls.int.test.ts` includes a
  declined row in the leak test.

### Coverage risks

- auth group 90/72 (`apps/api/src/auth/**`): the allow-list check, the org-header branches (absent, equal, different,
  ignored kinds) and the sign-in hook without auto-accept, one named test per branch.
- terminal group 90/77: the `orgId` mismatch 4412 and the pinned reauth (keeps open; closes on lost membership) each
  have a named test.
- contracts 100% lines: new routes, DTOs, `ORG_HEADER`, the 4412 close code, `INVITATION_EXPIRY_SECONDS`, the `status`
  filter and `declined`, hit by contract tests.
- api 92.8/78.8: each new endpoint's 400, 401, 403, 404 and 409 branch in onb int.
- web 95.4/88.1: route tests for the welcome page, the accept page, the Invitations page, the create-org form and the
  Projects card (loading, empty, error, success); interaction tests for OrgSwitch, InviteDialog, OnboardingChecklist and
  the resync-on-409 logic; stories do not count.
- db: the migration test covers the new migration.
- No threshold, baseline or exclude change, and no ignore comment (`testing.md` §10).

## Agent calls

- Agent call: resend has the same rights as create and revoke (business: slice 1 BR-60 uses one rule for every
  invitation action).
- Agent call: with no org in the URL, the landing org is the session's active org, starting as the oldest membership;
  the URL wins when it names an org (business, T7 not asked: keeps today's behaviour).
- Agent call: platform-level invitation screens beyond the create-org form stay in slice 5 (business: #192 owns the
  platform admin UI; T1 only asked for org creation).
- Agent call: resending an expired invitation when the same email already has another pending invitation in that org
  gives 409 "already invited" and changes nothing (business: slice 1 allows one pending invitation per email per org).
- Agent call: after Accept the person lands in the joined org's projects page, and that org becomes active (business:
  they came for it).
- Agent call: the checklist items show the progress of the furthest-along project, ties to the most recently created;
  each item opens that project's setup step, or the new-project wizard when there is no project (business: without
  this, items spread across projects could all show done while the card stays).
- Agent call: a declined invitation cannot be reopened; the inviter sends a new one (business: declined is final, like
  revoked).
- Agent call: resend writes `invitation.resent` and decline writes `invitation.declined`, in the same transaction
  (business: slice 1 audits every invitation action).
- Agent call: pending invitations stored with the 7-day expiry keep it; no stored row is rewritten (business:
  additive change; the new length applies from creation or resend. architecture: rewriting live expiries changes
  promises already given).
- Agent call: the switcher shows only with 2 or more orgs (business: epic §7.1).
- Agent call: platform admins always see the switcher, for Create organization (business: otherwise a platform admin who
  belongs to one org loses the entry).
- Agent call: new route kind `{scope:'user'}`, session only, no active org or membership, org header ignored
  (architecture: an invited new person has no membership until they accept, T2).
- Agent call: the new route paths follow slice 1's `/api/me/*` and `/api/orgs/:orgId/*` shapes, including a platform
  resend mirror with the new permission `platform-invitation:update` (architecture: slice 1 mirrors every invitation
  action on both sets through one service; platform admins invite first owners).
- Agent call: `INVITATION_EXPIRY_SECONDS = 172800` lives in contracts, the one place it lives, and services pass it to
  SQL (architecture: contracts is importable by core; T10).
- Agent call: `MyInvitationDto` gains `status` for `me.invitations.get`; `me.invitations.list` returns pending only
  (architecture: T9).
- Agent call: the invitation status enum gains `declined` in contracts and the database (architecture: no reason
  stated; business derives the final state `declined` from T2 and T10).
- Agent call: `ORG_HEADER = 'x-org-id'` (org id, not slug), problem type `org-mismatch` (409), WS close code `4412`
  (architecture: T5; the web needs a distinct signal to resync, not a 403; 4409 and 4410 are taken).
- Agent call: SSE and terminal routes accept an optional `orgId` query param (architecture: EventSource and browser
  WebSocket cannot send headers).
- Agent call: no link or token field in any DTO; the web builds `<origin>/invitations/<id>` (architecture: acceptance
  needs the verified matching email, epic §9, so the id carries no power and nothing secret is stored, AGENTS rule 5).
- Agent call: new definer `invitation_org_for_email` (architecture: T9 needs the invitee's own invitation state across
  orgs before any org is known; slice 1's function returns pending only; the id plus email match keeps it from telling
  anything to other emails; `database.md` §2).
- Agent call: no new index for the status filter (architecture: invitation rows per org are few; queries are `withOrg`
  on `org_id` with `PageQuery`, ADR-0028).
- Agent call: the checklist is computed, not stored, with a focus project and the credential as the agent signal
  (architecture: T6 "one project has finished all four steps"; agent rows are created with the project,
  `projects.service.ts:246`, so only the credential proves the step; `setup_step` is set by the client by PATCH).
- Agent call: `DISABLED_PATHS` becomes an allow-list, with a test over every better-auth endpoint (architecture: open
  plugin reads such as `list-members`, `get-full-organization`, `get-active-member` and `list-invitations` return member
  emails and bypass the permission matrix once orgs have several people; slice 1 `MemberDto` hides email; epic §13;
  AGENTS rule 7).
- Agent call: one `InviterDto {name, handle}` with the fallback applied on the server (`name` = trimmed display name,
  else the handle; `invitedBy` null only when the inviter's user row is gone) (architecture: the human's rule lives in
  one place, the API, which is the authority, and one integration test proves it; `handle` stays for
  disambiguation).
- Agent call: slice 1's `InvitationDto.invitedBy` and `PlatformInvitationDto.invitedBy` become `InviterDto | null`, fixed
  in slice 1's spec in the same PR, not migrated (architecture: one inviter shape on every invitation DTO; the
  Invitations page needs a readable name, not a user id; slice 1 is not built).
- Agent call: the sign-up gate throws `APIError('FORBIDDEN', { code: 'no_invitation' })`, the web passes
  `errorCallbackURL` = `/sign-in`, and an integration test asserts the callback redirect (architecture: the human fixed
  the value; this is the hook better-auth already turns into the query param, no new code path).
- Agent call: dev-login runs the same gate through `auth.api.signUpEmail` and answers 302 `/sign-in?error=no_invitation`
  on that code, with no user row; other failures stay 401 (architecture: local e2e covers BR-1 through an uninvited
  dev-login handle, since GitHub OAuth is never called in tests).
- Agent call: terminal `reauth` re-checks membership and permission in the org fixed at connect, not the session's
  current org (architecture: an org switch in another tab must not close a terminal the user may still use; authority
  stays session plus membership plus permission, AGENTS rule 7).
- Agent call: the resync runs once at a time per tab, a single in-flight promise next to the 401 handler (architecture:
  several queries failing at once must not send several `setActive` calls).
- Agent call: the `setActive` latency check is closed by reasoning in this spec and the new ADR, with no timing test
  (architecture: timing asserts flake, `testing.md` §5).
- Agent call: a non-admin who opens `/orgs/new` sees `Forbidden` (ui-ux: the same 403 state as every other page; the API
  refuses anyway).
- Agent call: changing the Invitations status filter resets to page 1 (ui-ux: same as the Runs filter).
- Agent call: no route for switching; switcher org items link to `/o/<slug>/projects` and `o.$org.tsx` runs `setActive`
  (ui-ux: ADR-0003 puts the switch on slug navigation; one code path).
- Agent call: create-org "Done" goes to `/` (ui-ux: the platform admin is not a member of the new org, so its pages would
  403; `/` lands in their own active org or the welcome page).
- Agent call: a second 409 after the resync falls through to the normal error states (ui-ux: the tabs cannot loop).
- Agent call: for a platform admin with no org, the OrgSwitch button reads "No organization" and its menu holds only
  "Create organization" (ui-ux: BR-40 "even if they belong to one org or none").
- Agent call: `OnboardingChecklist` is a new component, not `StartupChecklist` or `StepCardGrid` (ui-ux:
  `StartupChecklist` is the run-startup timeline with run glyphs and timestamps; `StepCardGrid` is static, with no done
  state).
- Agent call: `InviteLink` is one shared component for the invite dialog and the create-org success view (ui-ux: one copy
  control, one behaviour).
- Agent call: the `TopBar` project and run variants keep their "org / project" button (ui-ux: changing it would drift
  about 60 boards; the projects list is one click away on the logo). The human confirmed this at prototype review.
- Agent call: on `ProjectsEmpty` the live checklist replaces the static `StepCardGrid` for owners and org admins (ui-ux:
  two step lists with different steps on one page would contradict each other, and only the live one shows real
  progress).
- Agent call: a failing Projects banner query hides the banner (ui-ux: a hint, never blocks the list).
- Agent call: the Expires column shows a muted dash for accepted, declined and revoked rows (ui-ux: their expiry no
  longer matters).
- Agent call: all UI copy not marked "(human)" in "UI and Storybook" (ui-ux: none of it changes meaning; it follows the
  existing style).
- Agent call: with the inviter deleted, the invitee card's line starts with a capital, "Expires <date>" (ui-ux: the line
  now starts with it).
- Agent call: status tones pending `off`, accepted `ok`, declined `off`, revoked `off`, expired `late`; checklist done
  `succeeded`, todo `queued` (ui-ux: amber `idle` is reserved for "needs you").
- Agent call: `['session','orgs']` is also invalidated after create org (ui-ux: harmless; a platform admin who is not a
  member sees no change).
- Agent call: `['session','invitations']` sits outside `['org']` (ui-ux: it picks an org, like `orgsQuery`).
- Agent call: `['org', slug, 'access']` is ensured in the `o.$org` layout, and `['session','access']` serves pages outside
  an org (ui-ux: every page can call `can()`, and the welcome and create-org pages need `platformAdmin`).
- Agent call: the checklist query is invalidated on success of the mutations that complete a step, with no SSE (ui-ux:
  no reason stated; architecture §9 makes lists and the checklist plain queries).
- Agent call: the mutation error mapper recognises the `org-mismatch` problem type and shows the fixed T12 text instead
  of the problem title (ui-ux: no reason stated; T12 gives the exact message).
- Agent call: on create org, the user's slug edit wins over auto-fill, and clearing the slug resumes auto-fill (ui-ux: no
  reason stated).
- Agent call: form errors show on submit, then update on change (ui-ux: matches the existing `RuleForm`).
- Agent call: "Create project" and "New project" are hidden without `project:create` (ui-ux: otherwise a member would see
  a button that answers 403).
- Agent call: checklist todo rows get a small "Start" button (ui-ux/prototype: the spec was silent; drawn on the
  approved boards).
- Agent call: the pending-invitations banner sits at the top of the Projects page, neutral tone with a mail icon
  (ui-ux/prototype: the spec was silent).
- Agent call: the status filter chips show no counts (ui-ux/prototype: the spec was silent).
- Agent call: the invitation card has Decline on the left and Accept (primary) on the right; the link page puts Accept
  first (ui-ux/prototype: the spec was silent on order).
- Agent call: the link page details card is labelled Role, Access, Invited by, Expires (ui-ux/prototype: the spec was
  silent).
- Agent call: dates show as "23 Nov, 14:05" with the full date on hover (ui-ux/prototype: the spec gave no date
  format).
- Agent call: pressed buttons show disabled with "Accepting…", "Declining…", "Creating…", "Retrying…"
  (ui-ux/prototype: the spec said "pending" without a label).
- Agent call: create-org field errors "Enter a name.", "Use lowercase letters, numbers and dashes, with no dash at the
  start or end.", "Enter a valid email address." (ui-ux/prototype: the spec named the errors but not their text).
- Agent call: the invite dialog email error "This email already has a pending invitation." (ui-ux/prototype: the spec
  named the error but not its text).
- Agent call: the resend-refused Toast title "Invitation is no longer pending" (ui-ux/prototype: the spec said "the
  problem title" without text).
- Agent call: load and form error titles copy `RouteError` ("Internal server error" plus the request ID)
  (ui-ux/prototype: reuses the existing error state).
- Agent call: create-org is a 560px column; the invitation-failed state shows Retry in the Banner, hides the Create
  button and makes Name and URL read-only; success is a card with "Copy link" and "Done" (ui-ux/prototype: the spec
  was silent on width and placement).
- Agent call: Toast tones green (copied, renewed, revoked) and red (copy failed, resend refused, tab switched)
  (ui-ux/prototype: the spec was silent).
- Agent call: status icons Pending empty circle, Accepted green check, Declined grey slashed circle, Revoked grey
  crossed circle, Expired orange clock (ui-ux/prototype: drawn from the tones the spec set).
- Agent call: Revoke shows in red in the row menu (ui-ux/prototype: destructive action).
- Agent call: the copy-failed popover holds an "Invitation link" field (ui-ux/prototype: the spec said "a small
  popover" without content).
- Agent call: the invite dialog's Access choices are cards; a project admin sees "Some projects" as text with
  checkboxes (ui-ux/prototype: the spec was silent).
- Agent call: the switcher menu has a check on the current org and a divider before "Create organization"; the no-org
  button's label is "Switch organization" (ui-ux/prototype: the spec was silent).
- Agent call: the revoked board uses the All filter (ui-ux/prototype: so the revoked row stays visible).
- Agent call: create-org Forbidden reuses "Ask an owner of this organization to give you access.", which reads oddly
  outside an org (ui-ux/prototype: reuses the existing `Forbidden` state as the spec says).
- Agent call: existing copy such as the Projects "GitHub" column is kept (ui-ux/prototype: prototype copy is not
  rewritten, frontend.md §8).
- Agent call: the partly done checklist board uses a new org with one project and no runs (ui-ux/prototype: the spec
  was silent).
- Agent call: the table has an "Actions" column header for the row menu, the declined state links "Go to invitations",
  the invite dialog and revoke confirm have "Cancel", and Toasts have a dismiss button (ui-ux/prototype: the spec was
  silent; drawn on the approved boards).
- Agent call: no separate boards for the switch-org failure (the existing `RouteError` covers it), the existing
  "Sign-in failed" state, or the tab-switched refusal on create-org (the same Toast as on the invite dialog)
  (ui-ux/prototype: existing or identical states).
- Agent call: test file names are proposals; the plan fixes them per package convention (testing: `testing.md` §2).
- Agent call: e2e specs split per surface (testing: targeted runs stay short).
- Agent call: no bug fix is in scope (testing: BR-43's landing org is today's behaviour, so no failing test is needed).
- Agent call: no test-only API to age an invitation; BR-48 to BR-50 are proved by integration plus mock e2e, not local
  e2e (testing: such an API would be a new backdoor on an auth path; the 2-day timer cannot be skipped on the shared
  stack).
- Agent call: BR-1 is local e2e through dev-login refusing an uninvited handle; the social path's redirect stays in
  integration, and mock e2e keeps the other-error case (testing: proves the gate and the message together on the real
  stack).
- Agent call: view fixtures are `@/mocks/{orgs,invitations,onboarding}.ts` plus DTO fixtures in `mocks/dto/` (testing:
  ui-ux's final names; one set for stories and mock e2e).
- Agent call: BR-52's fallback is tested on the server (integration over the three DTOs); web tests assert `name` is
  shown as given (testing: one place for the rule).
- Agent call: BR-51 needs no local e2e; the over-3-days case is mock e2e plus the mapper unit test (testing: local only
  creates pending rows with a 2-day expiry, with no aged rows without a backdoor; the relative label is seen in the
  BR-18 local step).
- Agent call: mock scenarios are selected through sessionStorage keys, with no app test hook (testing: no reason
  stated beyond using keys like the existing `agentdesk.mock.auth`).
- Agent call: the BR-11 local e2e counts write requests with Playwright `page.on('request')` filtered to the rule's
  write route (testing: no flake from timers).
- Agent call: the T12 web unit test lives next to the API error handling in `apps/web/src/features/`, using MSW to answer
  409 once (testing: the plan picks the file).

## Open questions

- None.

## E2E requirements

These rules are requirements. Each is what a user can see at the UI (sign-in, welcome, invitation page, Invitations page, invite dialog, create-org form, org switcher, Projects page checklist); the feature is done when every case below passes as an e2e spec. Derived from this spec's business rules and the slice 1 spec it cites (`2026-11-20-rbac-foundation-design.md`, by way of the rules), not from the code.

### Rules

| Id    | Category         | Rule | Source |
| ----- | ---------------- | ---- | ------ |
| BR-1  | permission       | When a person with no account and no pending invitation signs in, the sign-in page shows that no invitation was found for their email, and no account is made. | spec §Business rules › Rules; Actors (slice 1 BR-54) |
| BR-2  | happy-path       | When an invited new person signs in with the matching verified email, they see the invitation (org name, role, scope) with Accept and Decline, and they are not yet a member. | spec §Business rules › Rules; States |
| BR-3  | happy-path       | When an existing user with a pending invitation signs in, they see a notice of their pending invitations that opens the list with Accept and Decline; the org is not in their switcher until they accept. | spec §Business rules › Rules; States |
| BR-4  | state-transition | When an invitation is expired or revoked, it is not in the invitee's list and cannot be accepted. | spec §Business rules › Rules; States |
| BR-5  | permission       | When a person signed in with a different verified email opens an invitation link, they see "not available" with no org name, role or email, and join nothing. | spec §Business rules › Rules; Edge cases |
| BR-6  | happy-path       | When a user who belongs to two or more orgs opens the org switcher, they see each of their orgs with the current one marked. | spec §Business rules › Rules; UI and Storybook (OrgSwitch) |
| BR-7  | navigation       | When a user picks another org in the switcher, the URL changes to that org and its projects show; a reload stays in that org. | spec §Business rules › Rules; States (Active org) |
| BR-8  | navigation       | When a signed-out user opens a link to `/o/<org>/…` and signs in, they land on that page in that org. | spec §Business rules › Rules; States (Active org) |
| BR-9  | empty-state      | When a user who is not a platform admin belongs to one org, no switcher shows. | spec §Business rules › Rules; UI and Storybook (OrgSwitch) |
| BR-10 | feedback-state   | When switching orgs, a loading state shows and no data of the previous org shows under the new URL. | spec §Business rules › Rules; UI and Storybook (Switch org) |
| BR-11 | edge             | When org A is open in one tab and the user switches to org B in another tab, the first tab's next action never reads or changes org B's data: it reloads org A's data, and a write is refused with "This organization was switched in another tab. Try again." and nothing changed. | spec §Business rules › Rules; Edge cases |
| BR-12 | permission       | When a user opens a link to an org they are not a member of, they see not found. | spec §Business rules › Rules; Edge cases |
| BR-13 | happy-path       | When an org owner or admin opens the Projects page of an org where no project has all four steps done, a checklist card shows Connect a code host, Create a project, Add an agent and Add a rule, each done or not done. | spec §Business rules › Rules; States (Checklist) |
| BR-14 | state-transition | When a step is completed (connection added, project created, agent credential set, rule added), that item shows done after a reload. | spec §Business rules › Rules; States (Checklist) |
| BR-15 | navigation       | When an owner or admin clicks a checklist item, the matching setup step of the furthest-along project opens (the new-project wizard when there is no project). | spec §Business rules › Rules; UI and Storybook (Checklist flow) |
| BR-16 | state-transition | When one project has all four steps done, the checklist card no longer shows, whether the Projects page has one project or many. | spec §Business rules › Rules; States (Checklist) |
| BR-17 | permission       | When a project admin, member or viewer opens the Projects page, no checklist card shows. | spec §Business rules › Rules; Actors |
| BR-18 | happy-path       | When an inviter clicks Resend on a pending or expired invitation, the row shows pending with a new expiry 2 days from now and the same copy link. | spec §Business rules › Rules; States |
| BR-19 | state-transition | When an invitation is accepted, declined or revoked, its row offers no Resend or Revoke; an expired row offers Resend only. If the invitation changed while the page was open, Resend or Revoke shows an error, the list refreshes and nothing changes. | spec §Business rules › Rules; States; Edge cases |
| BR-20 | permission       | When a member or viewer opens the Projects page, no Invite or Invitations control shows; opening the Invitations page URL shows the no-access state. | spec §Business rules › Rules; Actors |
| BR-21 | happy-path       | When an invitee clicks Accept, they land on the joined org's projects page, see exactly the invited projects, and the org is in their switcher. | spec §Business rules › Rules; States (Active org) |
| BR-22 | state-transition | When an invitee clicks Decline, the invitation leaves their list, they do not join, and the inviter's Invitations page shows it as Declined. | spec §Business rules › Rules; States |
| BR-23 | edge             | When an invitee clicks Accept or Decline on an invitation that was revoked, expired, accepted or declined meanwhile, the page reloads the invitation and shows its new state (revoked, expired, already joined, declined), and nothing changes. | spec §Business rules › Rules; Edge cases |
| BR-24 | navigation       | When a signed-out person opens an invitation link (`/invitations/<id>`), they are sent to sign in and then back to that invitation. | spec §Business rules › Rules; Edge cases |
| BR-25 | happy-path       | When the matching signed-in person opens a pending invitation link, they see the org name, role, scope, who invited them (display name, or handle when there is no name) and the expiry, with Accept and Decline. | spec §Business rules › Rules; UI and Storybook (Accept page) |
| BR-26 | state-transition | When the matching person opens the link of an accepted, declined, revoked or expired invitation, the page shows that state and no Accept or Decline. | spec §Business rules › Rules; Edge cases |
| BR-27 | happy-path       | When an owner or admin sends the invite dialog with an email, a role and the whole org or some projects, the copy link shows, and the Invitations page lists the invitation as pending, expiring 2 days later. | spec §Business rules › Rules; Limits and validation |
| BR-28 | validation       | When the invite dialog has an invalid or over-long email, no project chosen for a project scope, an email that is already a member, or an email already invited, the dialog shows the matching field error and nothing is created. | spec §Business rules › Rules; Limits and validation (slice 1 BR-59) |
| BR-29 | permission       | When an org admin opens the invite dialog, `owner` is not offered; when a project admin opens it, only admin, member and viewer on the projects they administer are offered, and the whole-org scope is not. | spec §Business rules › Rules; Actors (slice 1 BR-60) |
| BR-30 | happy-path       | When an owner or admin opens the Invitations page, the status filter is set to Pending and only pending invitations show, each with email, role, scope, status and expiry, paged. | spec §Business rules › Rules; Limits and validation (ADR-0028) |
| BR-31 | permission       | When a project admin opens the Invitations page, they see only invitations whose every project they administer. | spec §Business rules › Rules; Actors (slice 1 BR-60) |
| BR-32 | state-transition | When an inviter revokes a pending invitation, the row shows Revoked and the invitee's link shows it is no longer valid. | spec §Business rules › Rules; States |
| BR-33 | happy-path       | When an inviter clicks Copy link on a pending invitation, the link is copied and a confirmation shows. | spec §Business rules › Rules; UI and Storybook (Copy link) |
| BR-34 | happy-path       | When a platform admin with no org signs in, the welcome page offers Create organization. | spec §Business rules › Rules; Actors |
| BR-35 | happy-path       | When a platform admin submits the create-org form with a name, a URL slug (filled from the name, editable) and the first owner's email, the org is created and the owner invitation's copy link shows. | spec §Business rules › Rules; Limits and validation (slice 1 BR-69, BR-73) |
| BR-36 | validation       | When the create-org form has an empty or over-long name, a slug outside the slug format, a slug already taken, or an invalid owner email, the form shows the matching field error and no org is created. | spec §Business rules › Rules; Limits and validation (slice 1 BR-73) |
| BR-37 | permission       | When a user who is not a platform admin has no org and no pending invitation, the welcome page shows the heading "You're not a member of any organization", the text "No invitations for <email>. Ask an owner or admin to invite you." and a Sign out button, with no Create organization. | spec §Business rules › Rules; Actors |
| BR-38 | happy-path       | When the first owner accepts the owner invitation, they land in the new org's projects page with the checklist showing nothing done. | spec §Business rules › Rules; Actors (T1) |
| BR-39 | edge             | When the org is created but the owner invitation fails, the form shows the error with Retry, and Retry creates only the invitation, never a second org. | spec §Business rules › Rules; Edge cases |
| BR-40 | navigation       | When a platform admin opens the org switcher, it offers Create organization, even if they belong to one org or none. | spec §Business rules › Rules; UI and Storybook (OrgSwitch) |
| BR-41 | edge             | When an invitee has pending invitations from several orgs and accepts one, the others stay listed as pending. | spec §Business rules › Rules; Edge cases |
| BR-42 | edge             | When an invitee clicks Accept twice (double click or two tabs), they have one membership and the second ends on the same "already joined" state. | spec §Business rules › Rules; Edge cases |
| BR-43 | navigation       | When a user with several orgs signs in without a link, they land in the projects page of the org they joined first. | spec §Business rules › Rules; States (Active org) |
| BR-44 | permission       | When a member with no role in an org opens it from the switcher, they see the existing no-access state and can still switch to another org. | spec §Business rules › Rules; Edge cases (slice 1 BR-32, BR-63) |
| BR-45 | edge             | When a new person declines every invitation, they land on the welcome page with no org, and their next sign-in shows the same page. | spec §Business rules › Rules; Edge cases |
| BR-46 | permission       | When anyone who is not a platform admin calls org creation, they get 403 and no org is made (no control shows for them). | spec §Business rules › Rules; Tenancy and permission (slice 1 BR-70) |
| BR-47 | happy-path       | When an inviter picks a status filter (All, Pending, Accepted, Declined, Revoked, Expired) on the Invitations page, only invitations with that status show (every status for All), and the page count follows. | spec §Business rules › Rules; API (`status` semantics) |
| BR-48 | state-transition | When 2 days pass after an invitation was created or last resent without an answer, the Invitations page shows it as Expired, it leaves the invitee's list, and its link tells the invitee it has expired. | spec §Business rules › Rules; States; Limits and validation |
| BR-49 | state-transition | When an inviter resends an expired invitation, the invitee's same link shows Accept and Decline again. | spec §Business rules › Rules; States |
| BR-50 | validation       | When an inviter resends an expired invitation while that email already has another pending invitation in the org, they see an "already invited" error and nothing changes. | spec §Business rules › Rules; Edge cases |
| BR-51 | feedback-state   | When an inviter looks at the Expires column of the Invitations page, a pending or recently expired invitation shows a relative label with the exact date on hover; an invitation that expired more than 3 days ago shows the exact date directly. | spec §Business rules › Rules; UI and Storybook (Copy: Expires) |
| BR-52 | feedback-state   | When an inviter looks at the Invited by column, or an invitee looks at an invitation, the inviter shows as their display name, or their handle when there is no name. | spec §Business rules › Rules; API (`InviterDto`) |

### Test cases

Local cases run on the local stack: the dev platform admin `admin@dev.local`, fresh `e2e-<rand>` handles signed in with `/auth/dev-login?handle=<handle>` (add `&redirect=<path>` to land on a path), dev-login users are named after their handle, and each person uses their own browser context. Mock cases use the mocked web app scenario named in Given.

#### BR-1: Uninvited person refused at sign-in

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-1.1 | negative | local | Handle `e2e-<rand>` has no account and no invitation | 1. Open `/auth/dev-login?handle=e2e-<rand>` | 1. The browser lands on `/sign-in?error=no_invitation`. 2. A Banner shows "No invitation found for your email" and "Ask an owner or admin of your organization to invite you, then sign in again." 3. There is no session (`/auth/get-session` returns null). |
| TC-1.2 | negative | local | Same handle as TC-1.1, refused once | 1. Open `/auth/dev-login?handle=e2e-<rand>` again | 1. The same refusal shows again; still no session (no account was made by the first attempt). |
| TC-1.3 | positive | mock | Signed out | 1. Open `/sign-in?error=no_invitation` | 1. The Banner "No invitation found for your email" with "Ask an owner or admin of your organization to invite you, then sign in again." shows. 2. The sign-in control is still offered. |
| TC-1.4 | boundary | mock | Signed out | 1. Open `/sign-in?error=other` | 1. "Sign-in failed" shows. 2. The no-invitation Banner does not show. |
| TC-1.5 | negative | mock | Signed out | 1. Open `/sign-in?error=<b>x</b>` (HTML in the value) | 1. "Sign-in failed" shows. 2. The value is not rendered anywhere on the page. |

#### BR-2: Invited new person sees the invitation and is not yet a member

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-2.1 | positive | local | Owner of org O invited `e2e-<rand>@dev.local` as member on project P1 and P2; that person has no account | 1. Open `/auth/dev-login?handle=e2e-<rand>` as the invitee | 1. The welcome page opens with h1 "Invitations". 2. A card reads "<O name> invited you as <Role>" with an access line naming P1 and P2. 3. The buttons "Accept" and "Decline" show. |
| TC-2.2 | positive | local | Same as TC-2.1; the invitation link is known | 1. Open `/auth/dev-login?handle=e2e-<rand>&redirect=/invitations/<id>` | 1. The accept page shows h1 "Join <O name>" with Role, Access, Invited by and Expires and the buttons "Accept" and "Decline". |
| TC-2.3 | state | local | Same as TC-2.1, invitee signed in and has not pressed anything | 1. Open `/o/<O slug>/projects` | 1. The not-found state shows (the invitee is not a member). 2. No org is offered by an org switcher. |

#### BR-3: Existing user sees a notice of pending invitations

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-3.1 | positive | local | User U is a member of orgs A and D; owners of orgs B and C each invited U's email | 1. Sign in as U with dev-login (no redirect) 2. Press "View" on the pending-invitations banner | 1. After sign-in the projects page of U's first org shows a banner with the count of 2 pending invitations. 2. "View" opens the Invitations welcome page listing the invitations from B and C, each with "Accept" and "Decline". |
| TC-3.2 | negative | local | Same as TC-3.1 | 1. Sign in as U 2. Open the org switcher | 1. The switcher lists A and D only. 2. B and C are not listed. 3. Opening `/o/<B slug>/projects` shows not found (U did not join). |

#### BR-4: Expired or revoked invitation is not listed or acceptable

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-4.1 | state | mock | Mock invitee has fixtures: one pending, one expired, one revoked invitation | 1. Open `/invitations` | 1. Only the pending invitation is listed. 2. The expired and revoked ones are not. |
| TC-4.2 | state | mock | Same fixtures, fixed clock | 1. Open the link of the revoked invitation | 1. "This invitation was revoked" shows. 2. No "Accept" button. |
| TC-4.3 | state | mock | Same fixtures, fixed clock | 1. Open the link of the expired invitation | 1. "This invitation has expired" shows. 2. No "Accept" button. |

#### BR-5: Different email sees "not available"

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-5.1 | permission | local | A pending invitation to person X exists in org O; user Y (another handle with an existing account and a membership elsewhere) is signed in | 1. As Y, open `/invitations/<X's invitation id>` | 1. "This invitation is not available" and "Check that you signed in with the email it was sent to, or ask the person who invited you for a new link." show. 2. "Signed in as <Y email>" and "Sign out" show. 3. The page shows no org name, no role and no invited email. |
| TC-5.2 | permission | local | Same as TC-5.1 | 1. As Y, open `/o/<O slug>/projects` | 1. Not found shows (Y joined nothing). 2. X's invitation is still pending for X. |
| TC-5.3 | negative | local | User Y signed in | 1. Open `/invitations/<a random UUID>` | 1. The same "This invitation is not available" state as TC-5.1 shows. |

#### BR-6: Switcher lists the user's orgs with the current marked

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-6.1 | positive | mock | Mock user belongs to two seed orgs and is on the first org's Projects page | 1. Press the switcher button "Switch organization, currently <name>" | 1. A menu labelled "Organizations" opens. 2. Both orgs are listed. 3. The current org shows a check and is marked current. |
| TC-6.2 | positive | mock | Same as TC-6.1 | 1. Focus the switcher button and press ArrowDown 2. Press ArrowDown, Home, End 3. Press Escape | 1. The menu opens on ArrowDown. 2. Focus moves through the orgs. 3. Escape closes the menu and focus returns to the button. |

#### BR-7: Picking another org changes the URL and projects

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-7.1 | positive | local | User U is a member of A (joined first) and B, each with different project names, and is on A's projects page | 1. Open the switcher 2. Pick B | 1. The URL becomes `/o/<B slug>/projects`. 2. B's projects show and A's do not. |
| TC-7.2 | state | local | Same as TC-7.1, after switching to B | 1. Reload the page | 1. The URL stays `/o/<B slug>/projects`. 2. B's projects show. |

#### BR-8: Signed-out deep link lands in that org

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-8.1 | positive | local | User U is a member of A (joined first) and B; signed out | 1. Open `/o/<B slug>/projects` 2. Sign in through `/auth/dev-login?handle=<U>&redirect=/o/<B slug>/projects` | 1. Step 1 sends the browser to sign-in with a `redirect` to that path. 2. After sign-in the URL is `/o/<B slug>/projects` and B's projects show, not A's. |

#### BR-9: One org, no switcher

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-9.1 | positive | mock | Mock single-org scenario, user is not a platform admin | 1. Open the Projects page | 1. The org name shows as plain text in the top bar. 2. No switcher button shows and no menu can be opened. |

#### BR-10: Loading state while switching

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-10.1 | feedback | mock | Mock user in two orgs on org 1's Projects page; the `set-active` response is delayed | 1. Pick org 2 in the switcher 2. While `set-active` is pending, look at the page 3. Let `set-active` finish | 1. The URL names org 2 and a loading state (skeleton) shows. 2. No project name of org 1 shows under org 2's URL. 3. Then org 2's projects show. |

#### BR-11: Stale tab never touches the other org

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-11.1 | edge | local | One context (shared cookie), page A on org A's projects, page B on org B; user is in both | 1. In page B switch to B and wait for B's URL and heading 2. In page A navigate to another page of A (for example reload its projects list) | 1. Page A shows only A's data, no data of B. 2. No error is shown (the read re-syncs silently). |
| TC-11.2 | edge | local | Same as TC-11.1; page A has a rule open for editing; page B switched to B | 1. In page A change the rule and save (count requests to the rule's write route) | 1. A message "This organization was switched in another tab. Try again." shows. 2. The rule is unchanged in A and in B. 3. Exactly one write request was sent (no automatic retry). 4. The input stays in the form and the save button is enabled again. |
| TC-11.3 | edge | local | Same as TC-11.2 after the refused save | 1. Press save again in page A | 1. The change is applied to A. 2. B's rules are unchanged. |

#### BR-12: Non-member org link is not found

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-12.1 | permission | mock | Mock user is not a member of the seed org `other` | 1. Open `/o/other/projects` | 1. The not-found state shows. 2. No project or org data of `other` shows. |
| TC-12.2 | permission | mock | Mock user is signed in | 1. Open `/o/unknown/projects` | 1. The not-found state shows. |

#### BR-13: Checklist card for owner or admin

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-13.1 | positive | local | New org whose owner accepted; no connection, project, agent credential or rule | 1. As the owner open `/o/<slug>/projects` | 1. A card with heading "Get started" shows. 2. Rows "Connect a code host", "Create a project", "Add an agent", "Add a rule" each show a "Start" button and the "Not done" glyph. |
| TC-13.2 | permission | local | Same org; user granted the org admin role | 1. As the org admin open `/o/<slug>/projects` | 1. The same "Get started" card with four not-done rows shows. |
| TC-13.3 | state | local | Org with one project that has a code connection and no agent credential and no rule | 1. As the owner open the Projects page | 1. The card shows "Connect a code host" and "Create a project" as "Done". 2. "Add an agent" and "Add a rule" show "Not done". |

#### BR-14: Completed step shows done after reload

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-14.1 | state | local | New org, nothing done, owner on the Projects page | 1. Add a code host connection (fake install) 2. Reload the Projects page | 1. "Connect a code host" shows "Done". 2. The other three rows show "Not done". |
| TC-14.2 | state | local | New org with a connection, no project | 1. Create a project 2. Reload the Projects page | 1. "Create a project" shows "Done". 2. "Add an agent" and "Add a rule" show "Not done". |
| TC-14.3 | state | local | Org with a project, no agent credential | 1. Set the project's agent credential 2. Reload the Projects page | 1. "Add an agent" shows "Done". 2. "Add a rule" shows "Not done". |
| TC-14.4 | state | local | Org with a project, no rule | 1. Add a rule to the project 2. Reload the Projects page | 1. "Add a rule" shows "Done". 2. "Add an agent" shows "Not done". |

#### BR-15: Checklist item opens the matching setup step

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-15.1 | navigation | mock | Mock owner, org with no project (checklist none done) | 1. Press "Start" on "Create a project" | 1. The new-project wizard opens. |
| TC-15.2 | navigation | mock | Same as TC-15.1 | 1. Press "Start" on "Connect a code host" | 1. The new-project wizard opens (no project exists). |
| TC-15.3 | navigation | mock | Mock owner, one project with no agent credential and no rule (checklist partial) | 1. Press "Start" on "Add an agent" | 1. The agent setup step of that project opens. |
| TC-15.4 | navigation | mock | Same as TC-15.3 | 1. Press "Start" on "Add a rule" | 1. The rule setup step of that project opens. |
| TC-15.5 | navigation | mock | Mock owner, two projects: P1 with an agent credential set, P2 with nothing done | 1. Press "Start" on "Add a rule" | 1. The rule setup step of P1 (the furthest-along project) opens, not P2's. |

#### BR-16: Card gone once one project has all four

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-16.1 | state | local | Org with one project that has a connection, agent credential and a rule | 1. As the owner open the Projects page | 1. No "Get started" card shows. |
| TC-16.2 | state | local | Org with two projects: P1 has all four steps done, P2 has none | 1. As the owner open the Projects page | 1. No "Get started" card shows. |
| TC-16.3 | negative | local | Org with two projects: P1 has only an agent credential, P2 has only a rule | 1. As the owner open the Projects page | 1. The "Get started" card still shows (no single project has all four). |

#### BR-17: No checklist for project admin, member, viewer

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-17.1 | permission | mock | Mock project-admin scenario, org with no project complete | 1. Open the Projects page | 1. No "Get started" card shows. |
| TC-17.2 | permission | mock | Mock member scenario | 1. Open the Projects page | 1. No "Get started" card shows. |
| TC-17.3 | permission | mock | Mock viewer scenario | 1. Open the Projects page | 1. No "Get started" card shows. |

#### BR-18: Resend a pending invitation

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-18.1 | positive | local | Owner created a pending invitation (link L read from the invite dialog) and is on the Invitations page; clipboard stubbed | 1. Open the row menu "Actions for <email>" 2. Press "Resend" | 1. A green Toast "Invitation renewed. It now expires on <date>." shows. 2. The row shows Pending with an expiry label about 2 days out. |
| TC-18.2 | positive | local | Same as TC-18.1, after resend | 1. Open the row menu 2. Press "Copy link" | 1. The copied link equals L. |


#### BR-19: Actions on final rows and on a changed row

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-19.1 | state | mock | Mock Invitations page, filter All, rows in status accepted, declined and revoked | 1. Open each row's menu | 1. None of the three rows offers "Resend" or "Revoke". |
| TC-19.2 | state | mock | Mock Invitations page, filter Expired, one expired row | 1. Open the row menu | 1. "Resend" is offered. 2. "Revoke" is not offered. |
| TC-19.3 | negative | mock | Mock row shown as pending; the server answers 409 because the invitation was meanwhile accepted | 1. Open the row menu 2. Press "Resend" | 1. A red Toast titled "Invitation is no longer pending" shows. 2. The list refreshes and the row shows its new status. 3. Nothing else changed. |
| TC-19.4 | negative | mock | Mock row shown as pending; the server answers 409 on revoke because it changed meanwhile | 1. Open the row menu 2. Press "Revoke" 3. Press "Revoke" in the confirm dialog | 1. An error Toast shows. 2. The list refreshes and the row shows its new status. 3. Nothing else changed. |

#### BR-20: Member or viewer has no invite controls

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-20.1 | permission | mock | Mock member scenario | 1. Open the Projects page | 1. No "Invitations" button and no "Invite people" control shows. 2. No "New project" control shows. |
| TC-20.2 | permission | mock | Mock viewer scenario | 1. Open the Projects page | 1. No "Invitations" button and no "Invite people" control shows. |
| TC-20.3 | permission | mock | Mock member scenario | 1. Open `/o/<slug>/invitations` | 1. The no-access state shows ("You don't have access"). 2. No invitation rows show. |
| TC-20.4 | permission | mock | Mock viewer scenario | 1. Open `/o/<slug>/invitations` | 1. The no-access state shows. |

#### BR-21: Accept lands in the org with exactly the invited projects

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-21.1 | positive | local | Org O has projects P1, P2, P3; owner invited `e2e-<rand>@dev.local` as member on P1 and P2; invitee signed in on the accept page | 1. Press "Accept" | 1. The URL becomes `/o/<O slug>/projects`. 2. The list shows P1 and P2 only, not P3. 3. The org switcher or org name shows O. |
| TC-21.2 | positive | local | Existing user U in org A with an invitation to org O on the whole org | 1. As U accept the invitation | 1. U lands on O's projects page. 2. The switcher now lists A and O. |

#### BR-22: Decline

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-22.1 | positive | local | New invitee with their only invitation (from org O) on the accept page | 1. Press "Decline" 2. Press "Decline" in the dialog "Decline invitation to <O name>?" ("You will need a new invitation to join later.") | 1. The page shows "You declined this invitation" with a "Go to invitations" link. 2. The invitation is not in the invitee's list. 3. Opening `/o/<O slug>/projects` shows not found. |
| TC-22.2 | state | local | Same as TC-22.1, after declining | 1. As the owner open `/o/<O slug>/invitations` 2. Choose the "Declined" chip | 1. The row of the invitee shows the status Declined. |
| TC-22.3 | negative | local | Same dialog as TC-22.1 | 1. Press "Decline" 2. Press "Cancel" in the dialog | 1. The dialog closes. 2. The invitation is still pending with "Accept" and "Decline". |

#### BR-23: Accept or Decline on an invitation that changed meanwhile

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-23.1 | edge | local | Invitee has the pending accept page open; the inviter then revokes the invitation | 1. Press "Accept" | 1. The page shows "This invitation was revoked" with no "Accept" or "Decline". 2. The invitee did not join (`/o/<O slug>/projects` shows not found). |
| TC-23.2 | edge | local | Same, revoked after the page opened | 1. Press "Decline" and confirm | 1. The page shows "This invitation was revoked" with no "Accept" or "Decline". |
| TC-23.3 | edge | local | Invitee has the accept page open in two pages; page 2 already declined | 1. In page 1 press "Accept" | 1. Page 1 shows "You declined this invitation". 2. The invitee did not join. |
| TC-23.4 | edge | local | Invitee has the accept page open in two pages; page 2 already accepted | 1. In page 1 press "Decline" and confirm | 1. Page 1 shows "You already joined <O name>" with "Go to <O name>". 2. The invitee is still a member (no change). |

#### BR-24: Signed-out invitation link goes through sign-in and back

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-24.1 | positive | local | Pending invitation with id I to a new invitee; invitee context signed out | 1. Open `/invitations/<I>` 2. Sign in with dev-login using `redirect=/invitations/<I>` | 1. Step 1 sends the browser to `/sign-in?redirect=/invitations/<I>`. 2. After sign-in the browser is back on `/invitations/<I>` showing "Join <O name>" with "Accept" and "Decline". |

#### BR-25: Matching person sees the invitation details

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-25.1 | positive | local | Owner (handle H, dev-login name = handle) invited the matching person as member on P1 and P2 | 1. As the invitee open `/invitations/<id>` | 1. h1 "Join <O name>". 2. Details labelled Role (the role), Access (P1 and P2), Invited by (H) and Expires (an expiry date). 3. "Accept" first, then "Decline". |
| TC-25.2 | positive | local | Invitation on the whole org | 1. As the invitee open the link | 1. Access shows "Whole organization". |
| TC-25.3 | positive | mock | Mock invitation whose `InviterDto.name` is "Ada Lovelace" (handle `ada`) | 1. Open the invitation link as the invitee | 1. Invited by shows "Ada Lovelace". 2. Expires shows a date in the form "23 Nov, 14:05" with the full date "23 Nov 2026, 14:05" on hover. |
| TC-25.4 | positive | mock | Mock invitation whose inviter name equals the handle `ada` (server fallback) | 1. Open the link | 1. Invited by shows "ada". |

#### BR-26: Resolved invitation link shows its state

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-26.1 | state | local | Matching invitee accepted; invitation is accepted | 1. Open the link | 1. "You already joined <O name>" and "Go to <O name>" show. 2. No "Accept" or "Decline". |
| TC-26.2 | state | local | Matching invitee declined | 1. Open the link | 1. "You declined this invitation" and "Go to invitations" show. 2. No "Accept" or "Decline". |
| TC-26.3 | state | local | Owner revoked the invitation | 1. As the matching invitee open the link | 1. "This invitation was revoked" shows. 2. No "Accept" or "Decline". |
| TC-26.4 | state | mock | Mock expired invitation, fixed clock, matching invitee | 1. Open the link | 1. "This invitation has expired" and "Ask <inviter> to resend it." show. 2. No "Accept" or "Decline". |
| TC-26.5 | state | mock | Mock declined invitation, matching invitee | 1. Open the link | 1. "You declined this invitation" shows. 2. No "Accept" or "Decline". |

#### BR-27: Invite dialog creates a pending invitation

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-27.1 | positive | local | Owner of org O with projects P1, P2, P3 on `/o/<slug>/invitations` | 1. Press "Invite people" 2. Fill Email `e2e-<rand>@dev.local` 3. Choose a Role 4. Choose Access "Some projects", tick P1 and P2 5. Press "Create invitation" | 1. The dialog shows "Invitation created" and "Send this link to <email>. It works only for that email and expires on <date>." with the "Invitation link" field and "Copy link". 2. After "Done" the list shows the invitation as Pending with Access naming P1 and P2 and an expiry about 2 days out. |
| TC-27.2 | positive | local | Same owner | 1. Press "Invite people" 2. Fill an email and a role 3. Choose Access "Whole organization" 4. Press "Create invitation" 5. Press "Done" | 1. The link shows. 2. The list shows a Pending row with Access "Whole organization". |
| TC-27.3 | positive | local | Same owner | 1. Press "Invite people" 2. Press "Cancel" | 1. The dialog closes and no invitation is added. |

#### BR-28: Invite dialog validation

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-28.1 | negative | mock | Mock owner, dialog open | 1. Fill Email `not-an-email` 2. Press "Create invitation" | 1. A field error shows on Email. 2. No invitation is created (the list is unchanged). |
| TC-28.2 | boundary | mock | Mock owner, dialog open | 1. Fill Email with 255 characters (valid shape) 2. Press "Create invitation" | 1. A field error shows on Email. 2. Nothing is created. |
| TC-28.3 | boundary | mock | Mock owner, dialog open | 1. Fill Email with exactly 254 characters (valid shape) 2. Choose a Role and "Whole organization" 3. Press "Create invitation" | 1. No field error shows. 2. "Invitation created" shows. |
| TC-28.4 | negative | mock | Mock owner, dialog open | 1. Fill a valid email and a Role 2. Choose "Some projects" and tick none 3. Press "Create invitation" | 1. A field error shows on the project choice. 2. Nothing is created. |
| TC-28.5 | negative | mock | Mock org where `member@x.dev` is already a member | 1. Fill Email `member@x.dev` 2. Choose a Role and "Whole organization" 3. Press "Create invitation" | 1. A field error shows on Email. 2. Nothing is created. |
| TC-28.6 | negative | mock | Mock org with a pending invitation for `p@x.dev` | 1. Fill Email `P@X.dev` (other case) 2. Choose a Role and "Whole organization" 3. Press "Create invitation" | 1. The Email field shows "This email already has a pending invitation." 2. Nothing is created. |

#### BR-29: Role and scope options per inviter

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-29.1 | permission | mock | Mock owner scenario | 1. Open "Invite people" 2. Open the Role choices | 1. owner, admin, member and viewer are offered. 2. Access offers "Whole organization" and "Some projects". |
| TC-29.2 | permission | mock | Mock org admin scenario | 1. Open "Invite people" 2. Open the Role choices | 1. owner is not offered. 2. admin, member and viewer are. 3. Access offers "Whole organization" and "Some projects". |
| TC-29.3 | permission | mock | Mock project admin of P1 (not of P2) | 1. Open "Invite people" | 1. Role offers admin, member and viewer only. 2. "Whole organization" is not offered; "Some projects" shows as text with checkboxes. 3. Only P1 is listed, not P2. |

#### BR-30: Invitations page defaults to Pending

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-30.1 | positive | local | Org with one pending, one accepted and one revoked invitation; owner signed in | 1. Press "Invitations" in the Projects header (or open `/o/<slug>/invitations`) | 1. The URL has no `status` param. 2. The chip "Pending" is selected under "Filter by status". 3. Only the pending invitation shows, with columns Email, Role, Access, Status, Expires. |
| TC-30.2 | positive | mock | Mock org with more invitations than one page | 1. Open `/o/<slug>/invitations` 2. Go to page 2 | 1. Only pending rows show on page 1. 2. The pagination control moves to page 2 and shows the next pending rows. |
| TC-30.3 | boundary | mock | Same as TC-30.2 | 1. Open `/o/<slug>/invitations?status=bogus` | 1. The "Pending" chip is selected and pending rows show. |
| TC-30.4 | state | mock | Same as TC-30.2, on page 2 | 1. Choose the "Accepted" chip | 1. The page returns to page 1. |

#### BR-31: Project admin sees only invitations on projects they administer

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-31.1 | permission | local | Org with a pending invitation on P1 only, one on P2 only, one on P1 and P2, and one on the whole org; user is project admin of P1 only | 1. As the project admin open `/o/<slug>/invitations` | 1. The invitation on P1 only shows. 2. The P2, P1-and-P2 and whole-org invitations do not show. |

#### BR-32: Revoke

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-32.1 | positive | local | Owner with a pending invitation row; the invitee knows the link | 1. Open the row menu 2. Press "Revoke" 3. Press "Revoke" in "Revoke invitation for <email>?" ("The link stops working.") | 1. A green Toast "Invitation revoked" shows. 2. Under the "All" chip the row shows Revoked. 3. As the invitee, the link shows "This invitation was revoked". |
| TC-32.2 | negative | local | Same row | 1. Press "Revoke" in the menu 2. Press "Cancel" in the dialog | 1. The row stays Pending. |

#### BR-33: Copy link

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-33.1 | positive | mock | Mock owner, pending row, clipboard stubbed to succeed | 1. Open the row menu 2. Press "Copy link" | 1. The clipboard holds `<origin>/invitations/<id>`. 2. A green Toast "Link copied" shows. |
| TC-33.2 | negative | mock | Clipboard stubbed to fail | 1. Open the row menu 2. Press "Copy link" | 1. A red Toast "Could not copy. Select the link and copy it." shows. 2. A small popover shows the "Invitation link" field with the link. |

#### BR-34: Platform admin with no org sees Create organization

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-34.1 | positive | local | `admin@dev.local` is a platform admin and a member of no org | 1. Sign in as the platform admin | 1. The welcome page shows the heading "You're not a member of any organization" and "Create an organization and invite its first owner." 2. The buttons "Create organization" and "Sign out" show. |

#### BR-35: Create an org and get the owner link

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-35.1 | positive | local | Platform admin on the welcome page | 1. Press "Create organization" 2. Type Name `E2E Acme <rand>` 3. Read the URL field 4. Fill "First owner email" `e2e-<rand>@dev.local` 5. Press "Create organization" | 1. The form h1 is "Create an organization". 2. After step 2 the URL field (prefix `/o/`) is filled from the name. 3. The card "Organization created" shows "Send this link to <email>. It works only for that email and expires on <date>." with the link field, "Copy link" and "Done". |
| TC-35.2 | positive | local | Same form | 1. Type a Name 2. Edit the URL to `e2e-<rand>-x` 3. Fill the owner email 4. Press "Create organization" | 1. The created card shows. 2. The owner opens the link and accepts: the org's URL is `/o/e2e-<rand>-x`. |
| TC-35.3 | positive | local | Created card shown | 1. Press "Done" | 1. The browser goes to `/`. |

#### BR-36: Create-org validation

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-36.1 | negative | mock | Mock platform admin on `/orgs/new` | 1. Leave Name empty 2. Fill a valid URL and email 3. Press "Create organization" | 1. The Name field shows "Enter a name." 2. No org is created. |
| TC-36.2 | boundary | mock | Same | 1. Fill Name with 100 characters 2. Fill a valid URL and email 3. Press "Create organization" | 1. No Name error. 2. "Organization created" shows. |
| TC-36.3 | boundary | mock | Same | 1. Fill Name with 101 characters 2. Fill a valid URL and email 3. Press "Create organization" | 1. A Name field error shows. 2. No org is created. |
| TC-36.4 | negative | mock | Same | 1. Fill a valid Name 2. Type URL `Bad_Slug` 3. Press "Create organization" | 1. The URL field shows "Use lowercase letters, numbers and dashes, with no dash at the start or end." 2. No org is created. |
| TC-36.5 | negative | mock | Same | 1. Type URL `-abc` 2. Press "Create organization" | 1. The same URL error shows. |
| TC-36.6 | boundary | mock | Same | 1. Type URL of 63 characters (`a` x 63) with a valid name and email 2. Press "Create organization" | 1. No URL error. 2. "Organization created" shows. |
| TC-36.7 | boundary | mock | Same | 1. Type URL of 64 characters (`a` x 64) 2. Press "Create organization" | 1. The URL field shows the format error. 2. No org is created. |
| TC-36.8 | negative | mock | Mock seed org with slug `acme` exists | 1. Type URL `acme` with a valid name and email 2. Press "Create organization" | 1. The URL field shows "This URL is taken. Try another." 2. No org is created. Input is kept. |
| TC-36.9 | negative | mock | Same as TC-36.1 | 1. Fill a valid name and URL 2. Fill "First owner email" `nope` 3. Press "Create organization" | 1. The email field shows "Enter a valid email address." 2. No org is created. |
| TC-36.10 | boundary | mock | Same as TC-36.1 | 1. Fill "First owner email" with 255 characters (valid shape) 2. Press "Create organization" | 1. A field error shows on the email. 2. No org is created. |

#### BR-37: Non-admin with no org and no invitation

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-37.1 | permission | mock | Mock scenario "no org without invitations", user not a platform admin | 1. Open `/` | 1. The browser is on the welcome page. 2. The heading "You're not a member of any organization" shows. 3. "No invitations for <email>. Ask an owner or admin to invite you." shows. 4. A "Sign out" button shows. 5. No "Create organization" control shows. |
| TC-37.2 | positive | mock | Same | 1. Press "Sign out" | 1. The browser goes to the sign-in page. |
| TC-37.3 | permission | mock | Same | 1. Open `/orgs/new` | 1. "You don't have access" shows (Forbidden). |

#### BR-38: First owner accepts and sees an empty checklist

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-38.1 | positive | local | The platform admin created org N with owner email `e2e-<rand>@dev.local` and copied the link; the owner context is signed out | 1. In the owner context open the link 2. Sign in with dev-login (redirect to the link) 3. Press "Accept" | 1. The browser lands on `/o/<N slug>/projects`. 2. The "Get started" card shows four rows all "Not done". 3. The platform admin is not a member of N (the platform admin's switcher or welcome page does not list N). |

#### BR-39: Retry after the owner invitation failed

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-39.1 | edge | mock | Mock platform admin on `/orgs/new`; org create succeeds, the invitation create fails once then succeeds | 1. Fill a valid Name, URL and email 2. Press "Create organization" | 1. A Banner shows the problem title and "The organization was created. Retry to create the owner invitation." with "Retry". 2. The "Create organization" button is hidden. 3. Name and URL are read-only; the email is editable. |
| TC-39.2 | edge | mock | Same as TC-39.1 after the failure | 1. Press "Retry" | 1. "Organization created" shows with the owner link. 2. The request log shows exactly one org create and two invitation creates. |

#### BR-40: Platform admin's switcher offers Create organization

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-40.1 | navigation | local | Platform admin who is a member of one org O (granted by the test) on O's projects page | 1. Press the switcher button 2. Press "Create organization" | 1. The menu lists O and, after a divider, "Create organization". 2. The browser goes to `/orgs/new`. |
| TC-40.2 | navigation | local | Platform admin with no org | 1. Open the page `/` | 1. The switcher button reads "No organization". 2. Its menu holds only "Create organization". |
| TC-40.3 | permission | local | Org owner who is not a platform admin and belongs to two orgs | 1. Open the switcher | 1. The menu lists the orgs and no "Create organization". |

#### BR-41: Accepting one leaves the others pending

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-41.1 | edge | local | User U is in org A and has pending invitations from B and C | 1. Open `/invitations` 2. Press "Accept" on B's card 3. Open `/invitations` again | 1. After step 2 U lands on B's projects page and B is in the switcher. 2. Step 3 lists C's invitation (not B's) with "Accept" and "Decline". 3. C is not in the switcher. |

#### BR-42: Double Accept

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-42.1 | edge | local | Invitee has the accept page open in two pages | 1. Press "Accept" in page 1 2. Press "Accept" in page 2 | 1. Page 1 lands in the org. 2. Page 2 shows "You already joined <O name>" with "Go to <O name>". 3. The invitee appears once in the org (one membership). |
| TC-42.2 | edge | local | Invitee on the accept page | 1. Double-click "Accept" | 1. The invitee lands in the org (or on "You already joined <O name>"), never an error page. 2. One membership. |

#### BR-43: Sign-in without a link lands in the oldest org

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-43.1 | navigation | local | User U joined org A first, then B; U is in B's page | 1. Sign out 2. Open `/auth/dev-login?handle=<U>&redirect=/` | 1. The browser lands on `/o/<A slug>/projects`. 2. A's projects show. |

#### BR-44: Member with no role sees no-access and can switch

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-44.1 | permission | mock | Mock user in two orgs; in org 2 the member has no role (403 on projects) | 1. Open the switcher 2. Pick org 2 | 1. The no-access state shows ("You don't have access"). 2. The switcher is still usable. |
| TC-44.2 | navigation | mock | Same as TC-44.1 on the no-access state | 1. Open the switcher 2. Pick org 1 | 1. Org 1's projects show. |

#### BR-45: Declining every invitation

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-45.1 | edge | local | New person has pending invitations from orgs B and C and no org | 1. Sign in and open `/invitations` 2. Decline B's card and confirm 3. Decline C's card and confirm | 1. The welcome page shows the heading "You're not a member of any organization" and "No invitations for <email>. Ask an owner or admin to invite you." 2. No org is in the top bar. |
| TC-45.2 | state | local | Same, after declining all | 1. Sign out 2. Sign in again with dev-login for the same handle | 1. Sign-in works (no refusal). 2. The same welcome page shows. |

#### BR-46: Non-admin has no create-org control

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-46.1 | permission | mock | Mock org owner, not a platform admin, in two orgs | 1. Open the switcher | 1. No "Create organization" item shows. |
| TC-46.2 | permission | mock | Mock user not a platform admin, no org | 1. Open the welcome page | 1. No "Create organization" button shows. |
| TC-46.3 | permission | mock | Mock user not a platform admin | 1. Open `/orgs/new` | 1. "You don't have access" shows (Forbidden). 2. The create-org form does not show. |

#### BR-47: Status filters

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-47.1 | positive | local | Org with one pending, one accepted, one declined and one revoked invitation; owner on the Invitations page | 1. Choose "Accepted" 2. Choose "Declined" 3. Choose "Revoked" 4. Choose "Pending" | 1. Each chip shows only the rows with that status (one row each) and "?status=" follows the chip (Pending left out). 2. The page count follows the number of rows. |
| TC-47.2 | positive | local | Same | 1. Choose "All" | 1. All four rows show, each with its status text. |
| TC-47.3 | state | local | Same (no expired invitation can exist on the local stack) | 1. Choose "Expired" | 1. The empty state "No expired invitations" shows. |
| TC-47.4 | state | local | Org with a single pending invitation only | 1. Choose "Accepted" | 1. The empty state "No accepted invitations" shows. 2. Choosing "All" with no invitations at all shows "No invitations yet". |

#### BR-48: Expiry after 2 days

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-48.1 | state | mock | Mock invitation created 2 days and 1 minute before the fixed clock, never answered; owner on the Invitations page | 1. Choose "Expired" | 1. The row shows the status Expired. |
| TC-48.2 | state | mock | Same invitation, matching invitee | 1. Open `/invitations` | 1. The invitation is not listed. |
| TC-48.3 | state | mock | Same invitation, matching invitee | 1. Open the invitation link | 1. "This invitation has expired" and "Ask <inviter> to resend it." show. 2. No "Accept" or "Decline". |
| TC-48.4 | boundary | mock | Mock invitation whose expiry is 1 minute after the fixed clock | 1. As the owner, open the Invitations page (default Pending) 2. Advance the clock by 2 minutes 3. Reload | 1. Before: the row shows Pending. 2. After: the row is not under Pending and shows as Expired under "Expired". |

#### BR-49: Resend of an expired invitation revives the same link

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-49.1 | state | mock | Mock expired invitation (id I), owner on the Invitations page, filter "Expired" | 1. Open the row menu 2. Press "Resend" | 1. The Toast "Invitation renewed. It now expires on <date>." shows. 2. The row is Pending with a new expiry later than the clock. |
| TC-49.2 | state | mock | Same as TC-49.1 after resend | 1. As the matching invitee open `/invitations/<I>` | 1. "Join <Org>" shows with "Accept" and "Decline". |

#### BR-50: Resend blocked when the email already has a pending invitation

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-50.1 | negative | mock | Mock org with an expired invitation and a newer pending invitation for the same email | 1. Choose "Expired" 2. Open the expired row menu 3. Press "Resend" | 1. An "already invited" error shows. 2. The expired row stays Expired. 3. The pending invitation is unchanged. |

#### BR-51: Expires column

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-51.1 | positive | mock | Fixed clock; pending invitation expiring in 2 days | 1. Open the Invitations page 2. Hover the Expires cell | 1. The cell reads "Expires in 2 days" (or the equivalent relative label). 2. The hover shows the exact date. |
| TC-51.2 | positive | mock | Fixed clock; pending invitation expiring in 5 hours | 1. Open the Invitations page | 1. The cell reads "Expires in 5 hours". 2. The hover shows the exact date. |
| TC-51.3 | state | mock | Fixed clock; invitation expired 1 day ago | 1. Choose "Expired" 2. Hover the Expires cell | 1. The cell reads "Expired 1 days ago" (or the equivalent relative label). 2. The hover shows the exact date. |
| TC-51.4 | boundary | mock | Fixed clock; invitations expired 2 days 23 hours ago and exactly 3 days ago | 1. Choose "Expired" | 1. Both rows show a relative label with the exact date on hover. |
| TC-51.5 | boundary | mock | Fixed clock; invitation expired 3 days 1 hour ago and another 5 days ago | 1. Choose "Expired" | 1. Both rows show the exact date directly, in the form "23 Nov, 14:05" (full date on hover). 2. No relative label shows. |

#### BR-52: Inviter display name or handle

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-52.1 | positive | local | Owner with handle H (name = handle) invited a person | 1. As the owner open the Invitations page 2. As the invitee open the link | 1. The "Invited by" column shows H. 2. The accept page "Invited by" shows H. |
| TC-52.2 | positive | mock | Mock invitations: one with inviter name "Ada Lovelace" (handle `ada`), one with inviter name `bob` (handle `bob`, no display name) | 1. Open the Invitations page | 1. "Invited by" shows "Ada Lovelace" for the first and "bob" for the second. |
| TC-52.3 | positive | mock | Mock invitee card whose inviter name is "Ada Lovelace" | 1. Open `/invitations` | 1. The card reads "Invited by Ada Lovelace, expires <date>". |
| TC-52.4 | edge | mock | Mock invitation with inviter deleted (`invitedBy` null) | 1. Open the Invitations page 2. As the invitee open `/invitations` | 1. The "Invited by" column shows a plain dash. 2. The invitee card reads "Expires <date>" with no "Invited by" part. |
| TC-52.5 | edge | mock | Mock expired invitation with inviter deleted, matching invitee | 1. Open the link | 1. "This invitation has expired" and "Ask an owner or admin of <Org> to resend it." show. |

### Open questions

- Q1 (BR-28, BR-36, TC-28.1, TC-28.2, TC-28.4, TC-28.5, TC-36.3, TC-36.10): the spec gives no wording for the invite dialog errors (invalid or over-long email, no project, already a member) or for the over-long name and over-long email errors on create-org. Until answered, the cases assert that a field error shows on the named field and nothing is created.
- Q2 (BR-15, TC-15.3 to TC-15.5): no source names the URL or heading of the agent setup, rule setup and new-project wizard screens. Until answered, the cases assert that the setup step for that item opens for the named project.
- Q3 (BR-35, TC-35.1): the slug-from-name rule is "the contracts slug helper"; no example is given. Until answered, the case asserts the URL field is filled, non-empty and matches the slug format, not an exact value.
- Q4 (BR-18, BR-23): the rules' env is local, but the expired parts (resend of an expired row; Accept or Decline on an expired invitation) cannot run there (spec `### Not provable by e2e`). No local case for them; the expired resend is TC-49.1 and TC-49.2 under BR-49 (mock), and the expired link state is TC-26.4 and TC-48.3.
- Q5 (BR-19, TC-19.1, TC-19.2, TC-19.4): no source says whether "Copy link" is offered on final or expired rows, nor the title of the revoke-409 Toast. Until answered, the cases assert only that Resend and Revoke are absent (as the rule states) and that an error Toast shows.
- Q6 (BR-30, TC-30.2): no source gives the page size or the Pagination control labels. Until answered, the case asserts that a second page of pending rows is reachable and no non-pending row shows.
- Q7 (BR-3, TC-3.1): the banner copy is "You have N pending invitation(s)." with "View"; the singular and plural forms are not stated. Until answered, the case asserts the count of 2 and the "View" control.
- Q8 (BR-14, BR-16, BR-13): no source gives the labels or screens used to add a connection, set an agent credential or add a rule. Until answered, those given states are set up with the `signInAndCreateProject`-style helpers or API setup, and the cases assert only the checklist.
- Q9 (BR-11, TC-11.2): no source names the rule edit screen or its save control. Until answered, the case says "change the rule and save" without a label.
- Q10 (BR-12, TC-12.1): the not-found state has no stated copy in this spec. Until answered, the cases assert the not-found state and no org data.
