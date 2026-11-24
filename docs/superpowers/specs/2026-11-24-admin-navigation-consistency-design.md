<!-- dev-plan: kind=spec id=admin-nav-consistency rev=1 hash=6c46091af649 source=issue#274 -->
# Admin navigation consistency design

Status: draft. Sensitive path: none. Web chrome only (`apps/web`): no contract, route-access, API, RLS, migration or terminal change. One possible API change is listed separately as needs-decision (§Cross-scope access).
Source: human request (platform admins find it hard to move between platform, org and project pages, worst for people who hold several roles).

## Problem

Moving around the app uses four different things that do not match: the top bar, a context side menu, a breadcrumb (run page only) and page headers. There is no global side bar.
The platform area is a dead end and shows "where am I" in a third way. A person who is platform admin and also org or project admin gets a different bar, different tab names and different exits on each kind of page.

Verified against `main` (b4fbc49):

| # | Finding | Evidence |
| - | ------- | -------- |
| 1 | Nav is TopBar + SubNav + Breadcrumb + page headers; no global side bar | `components/TopBar.tsx:40-144`, `components/SubNav.tsx:14-36` |
| 2 | `/platform` bar is built with `NO_ORG`: the org crumb is plain "No organization", no scope switch, only the logo leads back | `app/routes/platform.tsx:38-44,80`; `components/OrgSwitch.tsx:22-28` |
| 3 | The way into `/platform` is the last item of the org popover, below the org list | `components/OrgSwitch.tsx:147-160` (the audit cited 69-76; the item is at 147-160); `features/chrome/appBar.ts:68` |
| 4 | Platform org pages have no breadcrumb or back link; their tabs live only in the side menu | `components/PlatformOrgHeader.tsx:27-49`, `components/PlatformLayout.tsx:24-41` |
| 5 | No link from a platform org into the org's own pages; `/o/$org` is not found for a non-member | `app/routes/o.$org.tsx:14-15` |
| 6 | Three "where am I" patterns: Breadcrumb on the run bar, switch buttons with an `aria-hidden` "/" on the project bar, nothing on platform; platform bar has no tabs and no bell | `TopBar.tsx:61-78`, `TopBar.tsx:119-125`, `platform.tsx:80` |
| 7 | "Settings" is org settings on the org bar and the project Desk on the project bar | `components/OrgNav.tsx:30`, `components/ProjectNav.tsx:40` |
| 8 | The org group label in the platform side menu is a plain span, added only after the org query resolves, so the menu jumps | `PlatformLayout.tsx:31-39`, `platform.tsx:57-61` |
| 9 | No `document.title` anywhere; two nav landmarks are both labelled "Main"; no skip link | `OrgNav.tsx:14`, `ProjectNav.tsx:17`; grep for `document.title` finds nothing |
| 10 | `/orgs/new` (create org) renders the plain global bar, outside the platform shell, with its own platform check | `app/routes/orgs.new.tsx:14-33`, `screens/CreateOrg.tsx:48` |
| 11 | Bell has no handler; `.subnav` is a fixed 220px with no responsive rule. Heading levels are consistent (h1 org name in `PlatformOrgHeader.tsx:30`, h2 per tab), so that part of the audit is not confirmed | `TopBar.tsx:56`, `components/Chrome.module.css:180-182` |

## Goals

- One shell: every page (platform, org, project, run) has the same top bar layout, the same breadcrumb pattern and the same way to change scope.
- The current scope (Platform, an org, or a project) is always visible.
- Moving between platform, org and project takes one or two clicks for single-role and multi-role users, with a way back from every page.

## Non-goals

- No new permission, role or route access; no change to what any role may read or do.
- No access for a platform admin to an org's own pages without membership (see needs-decision below).
- No responsive redesign, no notification feature for the bell, no new global side bar. Agent call: these were not asked for; the bell gets no new behaviour and `.subnav` width stays as is. Decided: the bell is shown on all bars, platform included.

## Target nav model

One rule for every scope: **top bar tabs are the sections of the current scope; the side menu holds the pages of one section; the breadcrumb says where you are.**

```
[logo] Scope switch ▾ / Project ▾ / Section / Page      [tabs of the scope]        [bell] [account]
```

- **Scope switch** (the first crumb, built from `OrgSwitch`). Its button shows the current scope: "Platform" in the platform area, otherwise the org name. The menu, top to bottom: a "Platform" group (platform admins only: "Platform admin" and, inside an org they can manage, "Manage this org in Platform"), the org list ("Switch organization", current one checked), "Create organization" (platform admins). Agent call: Platform moves to the top of the menu so it is found without scrolling past the org list.
- **Project crumb** (existing `ProjectSwitch`) on project and run pages.
- **Page crumbs** after the scope crumbs, on every page: e.g. `Platform / Organizations / Acme / Members`, `Acme / Settings / Members`, `Acme / Web app / Runs / Run 42`. Every crumb but the last is a link; the last has `aria-current="page"`. The project bar's `aria-hidden` "/" span goes away; all bars use `Breadcrumb`.
- **Tabs per scope** (same place, same style, own landmark name):

| Scope | Tabs | Side menu (inside a tab) |
| ----- | ---- | ------------------------ |
| Platform | Organizations, Platform admins, Audit log | Inside one org: org name (link to Overview), Overview, Projects, Members, Invitations |
| Org | Projects, Org settings | Inside Org settings: General, Members, Invitations, Audit log |
| Project | Runs, Project settings | Inside Project settings: the Desk menu (unchanged) |

  Agent call: the three platform sections move from the side menu to top bar tabs, so platform matches org and project. Agent call: tabs become "Org settings" and "Project settings" so "Settings" never means two things (decided).
- **Back and escape paths.** The breadcrumb is the back path on every page. The scope switch is the escape to any other scope. The logo goes to the user's home as today, except that a platform admin with no org membership goes to Platform > Organizations (decided). A platform org's not-found state keeps "Back to organizations".
- **Cross-scope links** (shown only when the user already has access; the target page keeps its own guard):
  - Platform org header: "Open organization" to `/o/<slug>/projects`, shown only when the org is in the user's own memberships (`orgsQuery`, session-scoped).
  - Org scope switch: "Manage this org in Platform" to `/platform/orgs/<id>`, shown only when `GET /api/me/platform` says platform admin.
  - Agent call: no per-project "Open project" link from the platform Projects tab. Project visibility is only known after switching the active org, so the link could lead to a 404.
- **Create organization** moves into the platform shell at `/platform/orgs/new`; `/orgs/new` redirects there. Agent call: the platform layout's `beforeLoad` then does the platform check, so the page's own check goes away.
- **document.title**: `<last crumb> · <scope> · Agent Desk`, set from the same crumb list the bar renders. Agent call: one source for both, so they cannot drift. Run pages use "Run N", never the ticket title (ticket text is untrusted).

## Nav per role combination

| Role(s) | Scope switch shows | Tabs | Cross-scope links | Does not see |
| ------- | ------------------ | ---- | ----------------- | ------------ |
| Platform admin only (no membership) | "Platform"; menu: Platform admin, Create organization | Platform tabs | none | org list, "Open organization", org and project tabs |
| Org admin (org-scope grant) | Org name; menu: org list | Projects, Org settings | none | Platform group, "Manage this org in Platform" |
| Project admin (project grant only) | Org name; menu: org list | Org: Projects, plus Org settings with Invitations only (the invite permission counts from a project grant, as today). Project: Runs, Project settings | none | Platform group; Org settings from a project grant |
| Platform admin + org admin + project admin | Platform or org name, by page; menu: Platform group, org list, Create | Tabs of the current scope | "Open organization" on platform orgs they belong to; "Manage this org in Platform" in their orgs | Org pages of orgs they do not belong to (not found, unchanged) |

## Access (ADR-0036)

Unchanged. No permission, role or `routeAccess` entry is added; `packages/contracts/src/access.ts` is not touched. The web app only shows or hides; the API is the authority. A platform admin opening an org page goes through the normal org guards (membership, permission, scope).

| Route or screen (change) | Permission (any/own) | Level | Tenant data touched |
| ------------------------ | -------------------- | ----- | ------------------- |
| Top bar on every page: scope switch, crumbs, tabs | Platform group: `GET /api/me/platform` (`me.platform`, scope user, no permission). Org settings tab: existing `canOpenSettings` (`org:update`, `member:read`, invite, `audit:read`, any, org grant only, `appBar.ts:12-19`). Project settings tab: existing Desk check (`rule:read`/`skill:read`, any, `features/desk/frame.ts:51-52`) | user / org / project | Caller's memberships (`orgsQuery`), caller's grants in the active org, project name already loaded. No new request |
| `/platform/*` bar and crumbs | `platform-org:read` for the org crumb (`platform.getOrg`, already loaded by the page) | platform | Org name, slug, status (metadata only) |
| `/platform/orgs/new` (moved from `/orgs/new`) | `platform-org:create` (`platform.createOrg`, unchanged) | platform | New org row, as today |
| "Open organization" link | None to render (membership from `orgsQuery`). Target: existing `/o/$org` guard plus each page's own permission | org | None read to render; target reads as today |
| "Manage this org in Platform" item | None to render (`me.platform`). Target: `platform-org:read` | platform | Org metadata, as today |
| `document.title`, skip link | None | n/a | Names already on screen; no ticket text |

The ADR-0036 route tests (allowed, 403, 404, own, cross-tenant, project scope) for every target route stay as they are; this spec adds no route or query, so it adds none. UI gating tests are in §Test plan.

### Cross-scope access (needs-decision, not in this spec)

A platform admin who is not a member cannot open `/o/<slug>` (finding 5, BR-23 of the platform dashboard spec). Letting them in, even read-only, would need a contract and `routeAccess` change and an ADR update. This spec does not assume it; links show only to members (Open question 1).

## Components

| Component | New or changed | Change | Story |
| --------- | -------------- | ------ | ----- |
| `TopBar` | changed | All variants render one `Breadcrumb` (scope crumb, project crumb, page `crumbs` prop); new `variant="platform"` with `PlatformNav`; sets `document.title` from the crumbs | update: Platform, Org, Project, Run, long names |
| `OrgSwitch` | changed | `scope: 'platform' \| 'org'` prop; button reads "Platform" in platform scope instead of "No organization"; Platform group first; optional `manageHref`. Agent call: extend it, not a new component, to keep public names | update: platform scope, dual-role, member only |
| `PlatformNav` | new | Platform tabs (Organizations, Platform admins, Audit log), like `OrgNav` | new |
| `SkipLink` | new | "Skip to main content", first focusable item; moves focus to the page's `main` | new |
| `OrgNav`, `ProjectNav` | changed | Tab names per §Tabs; landmark names "Organization sections", "Project sections" | update |
| `PlatformLayout` | changed | Only the org group; org name is a link to Overview; a fixed-height placeholder while the org loads | update: loading, ready |
| `PlatformOrgHeader` | changed | Optional `openHref` ("Open organization") | update: with and without link |
| `CreateOrg` screen | changed | Renders inside the platform frame | update |
| `useDocumentTitle` (hook, `apps/web/src/app`) | new | Sets and restores the title | n/a (unit test) |

Design tokens only; no new CSS values outside tokens.

## States

- **Loading**: crumbs whose name is not loaded yet (platform org, project) show a `Skeleton` of fixed width so the bar does not jump; the platform org group shows its placeholder (finding 8). The title uses the section name until the name arrives.
- **Empty**: a platform admin with no memberships sees no org list in the scope menu, not an empty group. A user with one org and no platform role sees the org name with Projects and Settings items only, as today.
- **Error**: a failed `me.platform` hides the Platform group (as today, `appBar.ts:53-54`). A failed platform org read keeps the existing error and not-found states; the crumb then reads "Organization". A 403 keeps `PlatformForbidden`.

## Accessibility

- Landmarks: one `banner` (top bar), `nav` "Breadcrumb", one tabs `nav` per scope with a distinct name, the side menu `nav` (existing names: "Platform admin", "Organization settings", "Desk"), one `main` per page. No two navs share a name.
- `aria-current="page"` on the active tab, the active side menu item and the last crumb; `aria-current="true"` on the current org in the switch menu (existing).
- Skip link first in tab order on every page, visible on focus.
- `document.title` on every route, including not-found and forbidden states ("Not found · Agent Desk").
- Scope button label states the scope: "Switch scope, currently Platform" or "Switch scope, currently organization Acme".

## Test plan

Unit (Vitest, Testing Library):
- `TopBar`: each variant renders one `Breadcrumb` with the expected crumbs and `aria-current`; platform variant shows `PlatformNav`; no nav named "Main".
- `OrgSwitch`: Platform group first and present only with `platformAdmin`; "Platform" label in platform scope; `manageHref` item only when given.
- `PlatformLayout`: org name is a link; placeholder while loading. `PlatformOrgHeader`: link only with `openHref`.
- `useDocumentTitle`: sets, updates and restores; never includes a ticket title.
- `appBar`: `manageHref` only for platform admins; "Open organization" only when the org id is in the memberships.

Mock Playwright (`apps/web/e2e/mock`), one behaviour each:
- `nav-shell.spec.ts` (new): breadcrumb on a platform, org, project and run page; title per page; skip link moves focus to `main`; tab names "Org settings" and "Project settings".
- `platform-shell.spec.ts` (extend): bar shows "Platform"; platform tabs; crumbs `Platform / Organizations / <org> / Members`; org name in side menu links to Overview.
- `org-switch.spec.ts` (extend): Platform group first for a platform admin; "Manage this org in Platform" opens `/platform/orgs/<id>`.
- `platform-org-detail.spec.ts` (extend): "Open organization" for a member lands on `/o/<slug>/projects`; absent for a non-member.
- `create-org.spec.ts` (extend): `/orgs/new` redirects to `/platform/orgs/new` inside the platform shell.
- Role-based (in `nav-shell.spec.ts`): an org admin and a project admin without the platform role see no Platform group and no "Manage this org in Platform"; a project admin sees the "Org settings" tab with Invitations only and none of General, Members or Audit log.

Local Playwright (`apps/web/e2e/local`, stack up), crosses API and session:
- `platform-access.spec.ts` (extend): dual-role user clicks "Open organization" and lands on the org with that org active; platform admin of org B only (member of org A) sees no "Open organization" on org B and `/o/<b-slug>` stays not found (cross-tenant).

Existing e2e that match "Settings" or the "Main" landmark are updated to the new names, not loosened.

## Rollout (PRs of about 800 lines or fewer)

1. `feat(web): skip link, page titles and distinct nav landmarks` (`SkipLink`, `useDocumentTitle`, landmark names, stories, unit, `nav-shell.spec.ts` a11y cases).
2. `feat(web): one breadcrumb on every top bar` (`TopBar` crumbs on all variants, project bar "/" span removed, call sites in `screens/*` and routes pass `crumbs`).
3. `feat(web): platform scope in the top bar` (`OrgSwitch` scope prop and Platform group first, `PlatformNav`, `platform.tsx` drops `NO_ORG`, `PlatformLayout` org group only, link and placeholder).
4. `feat(web): cross-scope links and tab names` ("Open organization", "Manage this org in Platform", "Org settings" / "Project settings", role-based e2e, local spec).
5. `feat(web): create organization inside the platform shell` (route move, redirect, `CreateOrg` frame, `create-org.spec.ts`).

## Risks

- `TopBar` is rendered by each screen, not one layout (about 15 call sites, e.g. `screens/Projects.tsx:81`, `screens/RunsPage.tsx:81`, `app/boundaries.tsx:61`). PR 2 must touch them all or bars drift again. Agent call: keep per-screen rendering and add the `crumbs` prop rather than move the bar into layout routes, to stay minimal.
- Renamed tabs and landmarks break existing e2e selectors; they must be updated in the same PR.
- "Open organization" switches the server-side active org (existing `o.$org.tsx:16-21`); a user with two tabs open may see the other tab change org (existing behaviour, now one click away).
- The `/orgs/new` move changes a URL; the redirect keeps old links working.

## Agent calls

Collected from above: Platform group first in the menu; platform sections become tabs; "Org settings" / "Project settings" (decided); extend `OrgSwitch` rather than add a component; no per-project link from platform; create org under `/platform`; title from the crumb list; per-screen `TopBar` kept; bell shown on every bar including platform, still without a handler (decided; its stories come later); `.subnav` width and responsive layout untouched (not asked for).

## Needs approval

None. No new dependency; uses the existing TanStack Router, React Query and design system.

## Decisions

1. Platform admins who are not members of an org do not open that org's pages; "Open organization" shows to members only. Read-only platform access is a later ADR.
2. Tabs are "Org settings" and "Project settings".
3. The bell stays on every bar, platform included, with no handler for now; its stories come later.
4. A project admin keeps today's behaviour: the "Org settings" tab shows with Invitations only. No permission changes; the role table was corrected to match the access table.
