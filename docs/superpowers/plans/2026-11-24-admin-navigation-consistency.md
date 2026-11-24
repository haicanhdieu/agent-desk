<!-- dev-plan: kind=plan id=admin-nav-consistency rev=1 hash=9103e35b5348 spec=docs/superpowers/specs/2026-11-24-admin-navigation-consistency-design.md spec-hash=6c46091af649 -->
# Admin Navigation Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every page (platform, org, project, run) gets the same scope-aware top bar: a skip link, one `Breadcrumb` led by the scope switch, the tabs of the current scope, the bell and the account menu, plus a `document.title` built from the same crumbs, cross-scope links for people who already have access, and Create organization inside the platform shell.

**Architecture:** Web chrome only (`apps/web`). `TopBar` stays rendered per screen (18 call sites in 16 files) and gets a required `crumbs` prop; a source-scanning Vitest test pins the call-site list so a new bar cannot skip crumbs. `OrgSwitch` gains a `scope` and becomes the scope switch; the platform shell drops its fake `NO_ORG` crumb and gets `PlatformNav` tabs. Five PRs follow the spec's rollout, each about 800 lines or fewer.

**Tech Stack:** React 19, TanStack Router and Query, CSS Modules with design tokens, Storybook, Vitest + Testing Library + MSW, Playwright (mock and local).

**Spec:** `docs/superpowers/specs/2026-11-24-admin-navigation-consistency-design.md` (all questions decided; see its Decisions). Visual source of truth: `design/prototype/interactive/` (README "Navigation: one scope-aware shell", `js/chrome.js`) and the 19 `design/prototype/project/*Shell*.dc.html` boards. Read both with this plan; labels below are copied from them.

## Global Constraints

- No contract, `routeAccess`, API, RLS, migration or terminal change. `packages/contracts/src/access.ts` is not touched (verified: every link and tab is gated by data the web already loads: `orgsQuery`, `platformAdminQuery` (`GET /api/me/platform`), `orgAccessQuery`/`sessionAccessQuery`, `platformOrgQuery`).
- No new dependency. `## Needs approval` is None.
- Layout copy, character for character: `[logo] Scope switch ▾ / Project ▾ / Section / Page      [tabs of the scope]      [bell] [account]`.
- Scope button: text "Platform" in the platform area, else the org name; `aria-label` "Switch scope, currently Platform" / "Switch scope, currently organization <name>" / "Switch scope, currently no organization" (platform admin with no org). A person with no org and no platform role keeps plain "No organization" text. The popover dialog label is "Scope".
- Scope menu order: "Platform" group (platform admins only: "Platform admin"; on org and project pages also "Manage this org in Platform"), the current org's group (heading org name, "Projects", "Org settings" when allowed), "Switch organization" (memberships only, never an empty group), "Create organization" (platform admins).
- Tabs and landmark names: Platform `Organizations`, `Platform admins`, `Audit log` in `<nav aria-label="Platform sections">`; Org `Projects`, `Org settings` in `Organization sections`; Project `Runs`, `Project settings` in `Project sections`. No nav is named "Main". Side menus keep "Platform admin", "Organization settings", "Desk".
- Crumbs: every crumb but the last is a link; the last has `aria-current="page"`; all in one `<nav aria-label="Breadcrumb">`; no `aria-hidden` "/" span outside `Breadcrumb`. Labels: `Projects`, `Projects / New project`, `Needs you`, `Org settings / <General|Members|Invitations|Audit log>`, `Runs`, `Runs / Run <N>`, `Project settings / <Skills|Routing rules|Workspace setup|Agent & settings|Members|Audit log>`, `Invitations` (my invitations), `Invitation` (accept), `Organizations`, `Organizations / <org>`, `Organizations / <org> / <Projects|Members|Invitations>`, `Organizations / Not found`, `Organizations / Create organization`, `Platform admins`, `Audit log`.
- Title: `<last crumb> · <scope> · Agent Desk`; scope is "Platform", the org name on org pages, the project name on project and run pages. "Not found · Agent Desk", "You don't have access · Agent Desk". Run pages use "Run N", never ticket text.
- Skip link "Skip to main content": first focusable item, visible on focus, Enter moves focus to `main`.
- "Open organization": on a platform org page after "View audit log", link with the `external` icon, only when the org id is in `orgsQuery`; target `/o/<slug>/projects`. "Manage this org in Platform": target `/platform/orgs/<id>`, only when `platformAdmin` is true.
- Create organization at `/platform/orgs/new` (Organizations tab active, no side menu); `/orgs/new` redirects there.
- Bell on every bar (platform and run included), no handler.
- A non-member platform admin opening `/o/<slug>` still gets "Not found" (Decision 1; the prototype draws the same: no org pages for a non-member).
- Tokens only (`var(--…)`, `--fs-*`, `--radius-*`, spacing copied from the boards); every new or changed `components/` export has stories (default, loading, error, long text where they apply); strict TS; `getByRole` queries; no network in tests; never weaken, skip or delete an access test; renamed selectors are updated, never loosened.
- Before every commit: `devbox run fix` until it prints `fix: clean.`; never `pnpm format`. Commits `feat(web): …` / `test(web): …`.
- Per PR before done: `pnpm --filter @agentdesk/web typecheck`, `pnpm --filter @agentdesk/web test`, and the PR's targeted e2e (commands in each task). Mock e2e needs one build first: `pnpm --filter @agentdesk/web exec vite build --mode mock`.

## Review Focus

1. A run whose ticket title holds markup or a long sentence: the tab title still reads "Run 62 · invoicer-api · Agent Desk": Task 4 (`pageTitle` test) and Task 5 (`RunDetail` test).
2. Moving from a run back to Runs, or from a not-found page to a real one: the title follows the new page, never the previous one (restore on unmount): Task 2 (hook test) and Task 6 (e2e navigates twice).
3. A very long org or project name (`orgSwitchFixtures.longName`, 60+ characters) in the scope button and crumbs: ellipsis with `title`, tabs still visible: Task 4 (TopBar test + `LongNames` story).
4. `GET /api/me/platform` fails for a platform admin: no Platform group, no "Manage this org in Platform", no crash (board ProjectsShellScopeMenuPlatformError): Task 11 (appBar route test).
5. A platform org id that does not exist, or whose read fails: crumbs `Organizations / Not found` and no side menu, or crumb and side menu group "Organization"; title "Not found · Agent Desk": Task 8 (`platformCrumbs` test and shell route test).

## Access and tenant data (ADR-0036)

No permission, role or route is added. The web only shows or hides; each target keeps its own guard (org membership, permission, scope).

| Surface (task) | Permission (any/own) | Level | Tenant data touched |
| --- | --- | --- | --- |
| Skip link, `document.title`, landmark names (Tasks 1-3) | none | n/a | names already on screen; never ticket text |
| Top bar crumbs on every page (Tasks 4-6) | none to render; each page's existing route guard | org / project / platform | org name and project name already loaded; platform org name from `platform.getOrg` (`platform-org:read`, already loaded by the page) |
| Scope switch Platform group (Task 7) | `GET /api/me/platform` (`me.platform`, scope user, no permission) | user | caller's own platform flag |
| Platform tabs, side menu, crumbs (Tasks 7-8) | `/platform` layout `beforeLoad` (`platformAdminQuery`); child reads `platform-org:read` | platform | org metadata (name, slug, status) |
| "Org settings" tab and menu item (Task 10) | existing `canOpenSettings`: `org:update`, `member:read`, invite, `audit:read` (any; the first three org grant only, invite also from a project grant) | org | caller's grants in the active org |
| "Project settings" tab (Task 10) | existing Desk check `rule:read`/`skill:read` (any) | project | caller's grants on the project |
| "Open organization" (Task 11) | none to render (`orgsQuery`, session-scoped memberships); target `/o/$org` guard plus page permission | org | none read to render |
| "Manage this org in Platform" (Task 11) | none to render (`me.platform`); target `platform-org:read` | platform | org id from the caller's memberships |
| `/platform/orgs/new`, `/orgs/new` redirect (Task 13) | `platform-org:create` (unchanged); the platform layout's `beforeLoad` replaces the page's own check | platform | new org row, as today |

ADR-0036 route tests for the target routes are unchanged (this plan adds no route or query). UI gating is tested per task, through the real `renderRoute` + MSW handlers; the access check is never mocked. Role-based e2e: Task 12.

## Needs approval

None. No new package, library, service, image, CI action or workspace package.

## Agent calls

- Agent call: the hook lives at `apps/web/src/components/useDocumentTitle.ts`, not `src/app` as the spec lists, because `TopBar` (components layer) calls it and components never import from `app/`.
- Agent call: `pageTitle()` uses the last crumb that is not loading, so a page whose own name is loading falls back to the section name (spec §States "the title uses the section name until the name arrives").
- Agent call: `SkipLink` is rendered once in `app/root.tsx` `RootLayout` and focuses the first `main` on activation (`tabIndex=-1` added if missing), so no screen's `main` needs an id.
- Agent call: the scope button label ("Switch scope, currently organization …") and the dialog name "Scope" land in PR 1 with the landmark names (one accessibility-names concern); PR 3 adds the platform form. This keeps PR 3 under the size limit (the label touches about 40 test files).
- Agent call: crumbs use the final labels "Org settings" and "Project settings" from PR 2; the tabs follow in PR 4 as the spec's rollout says.
- Agent call: `crumbs` is a required `TopBar` prop; an intentionally empty list must use the exported `NO_PAGE_CRUMBS` constant, so the drift test can forbid a literal `crumbs={[]}`.
- Agent call: the bell is added to the run bar (prototype "On every bar, platform and run included"; Decision 3). The existing `Chrome.test.tsx` case "no tabs and no bell (BR-46)" changes to "no tabs, one bell": a product change from the approved prototype, not a loosened test.
- Agent call: in platform scope `OrgSwitch` ignores `current` (no org group, no check mark), and in org scope the "Switch organization" group shows only with two or more memberships, as `chrome.orgMenu` draws it.
- Agent call: the 19 `*Shell` boards are registered (`canvas.json`, `screens/storyIds.ts`, `scripts/parity.mjs`, count 322 → 341 in `coverage.test.ts`) in the PR whose code they show: RunIdleShell in PR 2; 8 platform boards in PR 3; 9 boards with renamed tabs or cross-scope links in PR 4; CreateOrgPlatformShell in PR 5. Stories go in a new `screens/shell.stories.tsx` (title `Screens/Shell`).
- Agent call: the 322 older boards keep their drawn bars; `design/parity-notes.md` gets one entry in PR 2 saying their bar region differs by design and the `*Shell` boards are the bar reference.
- Agent call: the design files (prototype changes and the 19 boards) are committed with the spec and this plan before PR 1; no implementation PR edits the prototype except the regeneration step.
- Agent call: Create organization's Done opens `/platform/orgs/<new id>` (prototype README), so the screen's `created` state gains `orgId`; the `CreateOrgForbidden` board's `forbidden` state stays in the screen type (the board exists) though the route no longer produces it.
- Decided (human): the logo of a platform admin with no org membership goes to Platform > Organizations (`/platform/orgs`), as the prototype shows; every other user keeps today's target. Build it in PR 3 (Task 7, platform scope): find where the logo target is chosen (`grep -rn "/invitations" apps/web/src --include=*.ts* | grep -v test`), add the branch, and add a unit test and an assertion in the PR 3 e2e (Task 9).
- Agent call: if PR 4 exceeds about 850 lines, its board registration (Task 11 Step 5) moves to a follow-up `test(web): navigation shell boards` PR.

---

## PR 1: `feat(web): skip link, page titles and distinct nav landmarks` (est. ~480 lines)

### Task 1: `SkipLink`

**Depends on:** none

**Files:**
- Create: `apps/web/src/components/SkipLink.tsx`, `SkipLink.module.css`, `SkipLink.stories.tsx`, `SkipLink.test.tsx`
- Modify: `apps/web/src/components/index.ts`, `apps/web/src/app/root.tsx`

**Interfaces:**
- Produces: `export function SkipLink(): JSX.Element` (an `<a href="#main">` reading "Skip to main content").

- [x] **Step 1: Write the failing tests** in `SkipLink.test.tsx`:
  - `it('is a link named "Skip to main content"')`.
  - `it('moves focus to main on activation')`: render `<><SkipLink /><main><h1>x</h1></main></>`, `await user.tab()`, expect the link focused, `await user.keyboard('{Enter}')`, expect `screen.getByRole('main')` to have focus and `tabIndex === -1`.
  - `it('does nothing when the page has no main')`: no throw, focus stays.
  - `apps/web/src/app/shell.test.tsx` (existing): `it('the skip link is the first focusable element')`: render a route, `user.tab()`, active element name "Skip to main content".
- [x] **Step 2: Run** `pnpm --filter @agentdesk/web exec vitest run src/components/SkipLink.test.tsx src/app/shell.test.tsx`. Expected: FAIL (no module).
- [x] **Step 3: Implement** `SkipLink` (click handler `preventDefault`, find `document.querySelector('main')`, set `tabIndex = -1` if absent, `focus()`); CSS: off-screen until `:focus-visible`, then a token-styled pill at the top left (`var(--surface)`, `var(--text)`, `var(--radius-6)`, `--fs-13`; offsets copied from board ProjectsShellSkipLink). Render it first in `RootLayout`. Stories: `Default`, `Focused` (play function focuses it).
- [x] **Step 4: Run** Step 2's command plus `pnpm --filter @agentdesk/web exec vitest run src/test/stories.smoke.test.tsx`. Expected: PASS.
- [x] **Step 5: Commit** `feat(web): skip to main content link`.

### Task 2: `useDocumentTitle` and `pageTitle`, titles on not-found and forbidden pages

**Depends on:** none

**Files:**
- Create: `apps/web/src/components/pageTitle.ts`, `pageTitle.test.ts`, `useDocumentTitle.ts`, `useDocumentTitle.test.tsx`
- Modify: `apps/web/src/components/index.ts`, `apps/web/src/app/boundaries.tsx` (`NotFound` and `Forbidden` keep their markup and call the hook)

**Interfaces:**
- Produces (used by Tasks 4, 5, 8):

```ts
export interface PageCrumb { label: string; href?: string; loading?: boolean; /** "organization", "project": skeleton aria-label "Loading <what>" */ what?: string }
export type PageState = 'notFound' | 'forbidden';
export const NO_PAGE_CRUMBS: readonly PageCrumb[];
export const ORG_SETTINGS_CRUMB: Record<OrgSettingsTabKey, string>; // General, Members, Invitations, Audit log
export const DESK_CRUMB: Record<'skills' | 'rules' | 'setup' | 'agent' | 'members' | 'audit', string>; // Skills, Routing rules, Workspace setup, Agent & settings, Members, Audit log
export function pageTitle(input: { crumbs: readonly PageCrumb[]; scope?: string; state?: PageState }): string;
export function useDocumentTitle(title: string): void; // sets on change, restores the previous title on unmount
```

- [x] **Step 1: Write the failing tests.**
  - `pageTitle.test.ts`: `[{label:'Organizations',href:'/x'},{label:'Harbor Labs',href:'/y'},{label:'Members'}]`, scope `'Platform'` → `'Members · Platform · Agent Desk'`; `[{label:'Projects'}]`, `'Harbor Labs'` → `'Projects · Harbor Labs · Agent Desk'`; `[{label:'Runs',href:'/r'},{label:'Run 62'}]`, `'invoicer-api'` → `'Run 62 · invoicer-api · Agent Desk'`; last crumb loading → uses the previous label (`'Organizations · Platform · Agent Desk'`); `state:'notFound'` → `'Not found · Agent Desk'`; `state:'forbidden'` → `"You don't have access · Agent Desk"`; no crumbs and no scope → `'Agent Desk'`.
  - `useDocumentTitle.test.tsx`: sets `document.title`; a rerender with a new title updates it; unmount restores the title from before mount.
  - `apps/web/src/app/orgRoute.test.tsx` (existing file): `it('an unknown route sets the title "Not found · Agent Desk"')`.
- [x] **Step 2: Run** `pnpm --filter @agentdesk/web exec vitest run src/components/pageTitle.test.ts src/components/useDocumentTitle.test.tsx src/app/orgRoute.test.tsx`. Expected: FAIL.
- [x] **Step 3: Implement** both in the files above (`useEffect` with the previous title captured on mount); call `useDocumentTitle(pageTitle({ crumbs: NO_PAGE_CRUMBS, state }))` in `NotFound` (notFound) and `Forbidden` (forbidden). Agent call: `RouteError` gets no title (the spec names only not found and forbidden).
- [x] **Step 4: Run** Step 2's command. Expected: PASS.
- [x] **Step 5: Commit** `feat(web): page title helper and titles on not-found and forbidden pages`.

### Task 3: Distinct landmark names and the scope button label, plus e2e

**Depends on:** Tasks 1, 2

**Files:**
- Modify: `apps/web/src/components/OrgNav.tsx` (`aria-label="Organization sections"`), `ProjectNav.tsx` (default `label = 'Project sections'`), `OrgSwitch.tsx` (button labels, Popover `label="Scope"`), `OrgSwitch.stories.tsx`, `OrgSwitch.test.tsx`, `OrgNav.test.tsx`, `Chrome.test.tsx`
- Modify (selector updates only; enumerate with the commands in Step 3): unit, route and e2e files that query `name: 'Main'`, `/^(Switch organization|Organization menu)/` or dialog `'Organizations'`
- Create: `apps/web/e2e/mock/nav-shell.spec.ts`

**Interfaces:**
- Consumes: Tasks 1, 2.
- Produces: button names `Switch scope, currently organization <name>` (org shown, whether or not the person can switch), `Switch scope, currently no organization` (no org shown, platform admin); dialog `Scope`; navs `Organization sections`, `Project sections`.

- [x] **Step 1: Write the failing tests.**
  - `OrgSwitch.test.tsx`: `it('names the button "Switch scope, currently organization Harbor Labs"')` for `oneOrg` and for `twoOrgs`; `it('names the menu dialog "Scope"')`; `it('a platform admin with no org gets "Switch scope, currently no organization"')`.
  - `Chrome.test.tsx`: `it('no nav is named "Main" on any bar')` (org, project and run variants: `queryByRole('navigation', { name: 'Main' })` null); `it('the org tabs nav is "Organization sections" and the project tabs nav "Project sections"')`.
  - `e2e/mock/nav-shell.spec.ts` (`test.describe('accessibility')`, scenario `seedOnboarding(page, 'owner')`): `test('the first Tab focuses "Skip to main content" and Enter focuses main')`; `test('the org page has one banner, one main and no two navs with the same name')` (collect `aria-label` of every `nav`, expect unique and no "Main"); `test('an unknown route is titled "Not found · Agent Desk"')`.
- [x] **Step 2: Run** `pnpm --filter @agentdesk/web exec vitest run src/components/OrgSwitch.test.tsx src/components/Chrome.test.tsx src/components/OrgNav.test.tsx`. Expected: FAIL.
- [x] **Step 3: Implement** the labels, then update every selector found by:

```bash
grep -rlnE "name: 'Main'|\"Main\"" apps/web/src apps/web/e2e
grep -rlnE "Switch organization|Organization menu|name: 'Organizations'" apps/web/src apps/web/e2e
```

Replace with the new names (regex helpers become `/^Switch scope/`; the dialog becomes `'Scope'`). Keep the "Switch organization" group label inside the menu (it is still that group's name). Do not touch assertions other than the names.
- [x] **Step 4: Run** `pnpm --filter @agentdesk/web test` (the whole web unit suite, since selectors moved), then

```bash
pnpm --filter @agentdesk/web exec vite build --mode mock
pnpm --filter @agentdesk/web exec playwright test e2e/mock/nav-shell.spec.ts
pnpm --filter @agentdesk/web exec playwright test $(git diff --name-only main -- apps/web/e2e/mock | sed 's#apps/web/##')
```

Expected: PASS. Local specs whose selectors changed: run them with the stack up (`devbox run dev`): `pnpm --filter @agentdesk/web exec playwright test $(git diff --name-only main -- apps/web/e2e/local | grep spec | sed 's#apps/web/##')`.
- [x] **Step 5: Commit** `feat(web): distinct nav landmarks and a scope-named org switch`.

---

## PR 2: `feat(web): one breadcrumb on every top bar` (est. ~750 lines)

### Task 4: `TopBar` renders one `Breadcrumb` with page crumbs and sets the title

**Depends on:** Task 3

**Files:**
- Modify: `apps/web/src/components/TopBar.tsx`, `Breadcrumb.tsx` (loading crumb), `Chrome.module.css` (`.crumbSkeleton` fixed width from board PlatformOrgMembersShellLoading), `TopBar.stories.tsx`, `Breadcrumb.stories.tsx`, `Chrome.test.tsx`

**Interfaces:**
- Consumes: `PageCrumb`, `PageState`, `NO_PAGE_CRUMBS`, `pageTitle`, `useDocumentTitle` (Task 2).
- Produces (Tasks 5, 7, 8 rely on it):

```ts
export interface TopBarProps {
  variant: 'global' | 'project' | 'run';
  user: Actor;
  /** Page crumbs after the scope and project crumbs; NO_PAGE_CRUMBS when the page has none. */
  crumbs: readonly PageCrumb[];
  /** Fixed titles for not-found and forbidden pages. */
  state?: PageState;
  org?: OrgSwitchProps; tabs?: 'org' | 'project' | 'none'; active?: 'projects' | 'settings' | 'runs' | 'desk';
  project?: { name: string; repoUrl?: string }; projectMenu?: ProjectSwitchMenu; needsYou?: number;
  children?: ReactNode; actions?: ReactNode; links?: { projects?: string; runs?: string; desk?: string };
}
// `run` is removed: the run bar passes crumbs [{ label: 'Runs', href }, { label: 'Run N' }].
export type BreadcrumbItem = { label: ReactNode; href?: string } | { control: ReactNode } | { loading: string };
```

- [x] **Step 1: Write the failing tests** in `Chrome.test.tsx`:
  - `it('every variant renders exactly one Breadcrumb nav')` (global with org, project, run).
  - `it('the project bar has no slash outside the Breadcrumb')` (no `aria-hidden` "/" sibling of the org crumb).
  - `it('page crumbs follow the scope and project crumbs; only the last has aria-current="page"')`: project variant, crumbs `[{label:'Project settings',href:'/d'},{label:'Skills'}]` → link "Project settings", `b[aria-current=page]` "Skills".
  - `it('a loading crumb is a status named "Loading organization" with no text')`.
  - `it('sets the title from the crumbs and the scope')`: global with org "Harbor Labs", crumbs `[{label:'Projects'}]` → `document.title === 'Projects · Harbor Labs · Agent Desk'`; project variant uses the project name; `state='forbidden'` → `"You don't have access · Agent Desk"`.
  - `it('the run bar has no tabs and one bell')` (replaces the BR-46 "no bell" case; Agent call above).
  - `it('a 60-character org and project name keep ellipsis and title')`.
  - `// @ts-expect-error crumbs is required` on a `<TopBar variant="global" user={u} />` line inside a test.
- [x] **Step 2: Run** `pnpm --filter @agentdesk/web exec vitest run src/components/Chrome.test.tsx`. Expected: FAIL.
- [x] **Step 3: Implement**: build `items = [orgCrumb?, projectCrumb?, ...crumbs.map(toItem)]`, render `<Breadcrumb>` when non-empty on every variant; scope for the title is `project.name` on project/run variants, `org.current?.name` on global; bell in the run branch before `actions`. Stories: update every existing story with `crumbs`; add `RunLevelCrumbs`, `LoadingCrumb`, `LongNames`, `ForbiddenPage`.
- [x] **Step 4: Run** Step 2's command plus `src/test/stories.smoke.test.tsx`. Expected: PASS (typecheck fails at call sites until Task 5; do Task 5 before the commit if `devbox run fix` blocks, and commit both together).
- [x] **Step 5: Commit** (with Task 5) `feat(web): top bar renders one breadcrumb with page crumbs`.

### Task 5: Every call site passes crumbs, guarded by a call-site inventory test

**Depends on:** Task 4

The drift risk: screens and routes draw their own `TopBar`. Enumerate the call sites with exactly this command (excludes `TopBarSeparator`, stories and tests):

```bash
grep -rnE '<TopBar([[:space:]]|$|>)' apps/web/src --include='*.tsx' | grep -vE '\.(stories|test)\.tsx:'
```

On `main` (b4fbc49) it prints 18 lines in 16 files. Each gets these crumbs:

| File (count) | Crumbs / state |
| --- | --- |
| `app/boundaries.tsx` (2: `PlatformForbidden`, `SuspendedOrgPage`) | `NO_PAGE_CRUMBS`, `state="forbidden"` for `PlatformForbidden`; `NO_PAGE_CRUMBS` for suspended |
| `app/routes/o.$org.settings.tsx` (1) | `[{Org settings, href settings}, {ORG_SETTINGS_CRUMB[active]}]`; no tabs → `NO_PAGE_CRUMBS` + `state="forbidden"` |
| `app/routes/platform.tsx` (1) | from `platformCrumbs()` (Task 5 Step 3, below) |
| `app/routes/o.$org.projects.index.tsx` (1, `ProjectsForbidden`) | `[{Projects}]`, `state="forbidden"` |
| `screens/Projects.tsx` (1), `screens/ProjectsEmpty.tsx` (2) | `[{Projects}]` |
| `screens/RunsPage.tsx` (1) | `[{Runs}]` |
| `screens/RunDetail.tsx` (1) | `[{Runs, href links.runs}, {`Run ${run.id}`}]` |
| `screens/DeskFrame.tsx` (1) | `[{Project settings, href links.desk}, {DESK_CRUMB[active]}]` |
| `screens/NeedsYou.tsx` (1) | `[{Needs you}]` |
| `screens/MyInvitations.tsx` (1) | `[{Invitations}]` |
| `screens/InvitationAccept.tsx` (1) | `[{Invitation}]` |
| `screens/CreateOrg.tsx` (1) | `[{Create organization}]` (moves in Task 13) |
| `screens/orgSettingsFrame.tsx` (1), `screens/platformFrame.tsx` (1) | same as their routes (stories frames) |
| `components/SetupLayout.tsx` (1) | `[{Projects, href projectsHref}, {New project}]` |

**Files:**
- Modify: the 16 files above; `apps/web/src/screens/storyIds.ts`, `design/prototype/project/canvas.json`, `apps/web/scripts/parity.mjs`, `apps/web/src/test/coverage.test.ts` (322 → 323); `design/parity-notes.md`
- Create: `apps/web/src/test/topBarCallSites.test.ts`, `apps/web/src/features/platform/crumbs.ts`, `crumbs.test.ts`, `apps/web/src/screens/shell.stories.tsx`
- Modify (selector or prop updates found by `tsc`): the existing screen and route tests of those files

**Interfaces:**
- Consumes: Task 4.
- Produces:

```ts
// features/platform/crumbs.ts
export type PlatformOrgCrumb =
  | { state: 'none' } | { state: 'loading' } | { state: 'notFound' }
  | { state: 'ready'; id: string; name: string } | { state: 'error'; id: string };
export function platformCrumbs(pathname: string, org: PlatformOrgCrumb): {
  crumbs: PageCrumb[]; state?: PageState; tab: 'orgs' | 'admins' | 'audit';
};
// test/topBarCallSites.test.ts
export const TOP_BAR_CALL_SITES: Record<string, number>; // path under src → count, the 16 files above
```

- [x] **Step 1: Write the failing tests.**
  - `topBarCallSites.test.ts` (reads files with `readdirSync(src, { recursive: true })` + `readFileSync`, like `coverage.test.ts`; skips `*.stories.tsx`, `*.test.tsx`; pattern `/<TopBar(?=[\s>])/g`):
    - `it('TopBar is rendered exactly at the listed call sites')`: map of file → count equals `TOP_BAR_CALL_SITES`. A new bar fails here until it is added to the list, which a reviewer sees.
    - `it('every call site passes crumbs and none passes a literal empty list')`: for each match take the JSX element text (from the match to the first `/>` at the element's own indentation, or the end of a one-line element), expect `/\bcrumbs=\{/` and not `/crumbs=\{\[\]\}/`.
  - `crumbs.test.ts`: `/platform/orgs` → `[Organizations]`, tab orgs; `/platform/orgs/abc` ready "Harbor Labs" → `[Organizations(href /platform/orgs), Harbor Labs]`; `/platform/orgs/abc/members` → `[Organizations, Harbor Labs(href /platform/orgs/abc), Members]`; loading → middle crumb `{loading:true, what:'organization'}`; error → label "Organization"; notFound → `[Organizations(href), Not found]`, `state:'notFound'`; `/platform/admins` → `[Platform admins]`, tab admins; `/platform/audit` → `[Audit log]`, tab audit; `/platform/orgs/new` → `[Organizations(href), Create organization]`, tab orgs.
  - `screens/runDetail.test.tsx`: `it('the bar reads Runs / Run 62 and the title never holds the ticket title')` (fixture ticket title with `<b>` markup).
  - `features/orgSettings/layout.route.test.tsx`: crumbs `Org settings / Members` on `/o/alice/settings/members`.
- [x] **Step 2: Run** `pnpm --filter @agentdesk/web exec vitest run src/test/topBarCallSites.test.ts src/features/platform/crumbs.test.ts src/screens/runDetail.test.tsx src/features/orgSettings/layout.route.test.tsx`. Expected: FAIL.
- [x] **Step 3: Implement**: pass crumbs at each call site per the table; in `platform.tsx` build `PlatformOrgCrumb` from the existing `useOrgGroup` query (`isPending` → loading, `ApiError` 404 → notFound, other error → error) and pass `platformCrumbs(pathname, org)`; the bar keeps `NO_ORG` until Task 8. Boundary components that now render a `TopBar` with `state` drop their own `useDocumentTitle` call (one title source per page). Register board `RunIdleShell` (story export `RunIdleShell` in `screens/shell.stories.tsx`, layout fullscreen, board viewport). Add the parity-notes entry (Agent call). Regenerate the interactive prototype: `node design/prototype/interactive/_tools/build-boards.mjs && node design/prototype/interactive/_checks/nav-check.mjs` (expect no diff beyond what the design commit already has).
- [x] **Step 4: Run** `pnpm --filter @agentdesk/web typecheck && pnpm --filter @agentdesk/web test`. Expected: PASS. Re-run the grep above: still 18 lines in 16 files.
- [x] **Step 5: Commit** `feat(web): every top bar passes its page crumbs` (with Task 4 if not committed).

### Task 6: e2e for crumbs and titles

**Depends on:** Task 5

**Files:**
- Modify: `apps/web/e2e/mock/nav-shell.spec.ts`; `apps/web/e2e/mock/top-bar.spec.ts` and `run-detail-layout.spec.ts` only where they asserted the old project-bar slash or no run bell

- [x] **Step 1: Write the tests** in `nav-shell.spec.ts` (`test.describe('breadcrumb and title')`, scenario `owner` for org/project/run, `platformAdminOrgs` via `seedPlatform` for platform):
  - `test('the org Projects page reads Projects and is titled "Projects · Alice · Agent Desk"')` (org name from the scenario).
  - `test('a run page reads Runs / Run N with Runs linking to the project runs')`; then click "Runs": title becomes `Runs · <project> · Agent Desk` (Review Focus 2).
  - `test('a Desk page reads Project settings / Skills')`.
  - `test('a platform org members page reads Organizations / <org> / Members and every crumb but the last is a link')`.
- [x] **Step 2: Run** `pnpm --filter @agentdesk/web exec vite build --mode mock && pnpm --filter @agentdesk/web exec playwright test e2e/mock/nav-shell.spec.ts e2e/mock/top-bar.spec.ts e2e/mock/run-detail-layout.spec.ts`. Expected: PASS.
- [x] **Step 3: Commit** `test(web): breadcrumb and title e2e on org, project, run and platform pages`.

---

## PR 3: `feat(web): platform scope in the top bar` (est. ~780 lines)

### Task 7: `OrgSwitch` scope and Platform group first, `PlatformNav`, `TopBar` platform variant

**Depends on:** Task 5

**Files:**
- Create: `apps/web/src/components/PlatformNav.tsx`, `PlatformNav.stories.tsx`, `PlatformNav.test.tsx`
- Modify: `OrgSwitch.tsx`, `OrgSwitch.module.css`, `OrgSwitch.stories.tsx`, `OrgSwitch.test.tsx`, `TopBar.tsx`, `TopBar.stories.tsx`, `Chrome.test.tsx`, `components/index.ts`, `mocks` org-switch fixtures if a platform-scope fixture is missing

**Interfaces:**
- Produces:

```ts
export interface PlatformNavProps { active?: 'orgs' | 'admins' | 'audit'; links: { orgs: string; admins: string; audit: string } }
export function PlatformNav(props: PlatformNavProps): JSX.Element; // nav "Platform sections", icons grid / lock / clock
OrgSwitchProps: + scope?: 'org' | 'platform' // default 'org'
TopBarProps: variant + 'platform'; + platformTabs?: PlatformNavProps // rendered on the platform variant; scope for the title "Platform"
```

- [x] **Step 1: Write the failing tests.**
  - `PlatformNav.test.tsx`: three links in order; `active` sets `aria-current="page"` and class `on`; nav name "Platform sections".
  - `OrgSwitch.test.tsx`: `it('in platform scope the button reads "Platform" and is named "Switch scope, currently Platform"')`; `it('the Platform group is the first group and holds "Platform admin"')` (index of "Platform admin" < first org item < "Create organization"); `it('in platform scope "Platform admin" has aria-current="true" and no org is checked')`; `it('a platform admin with no membership sees no "Switch organization" group')`; `it('without platformAdmin and platformHref there is no Platform group')`; `it('in org scope with one membership there is no "Switch organization" group')`.
  - `Chrome.test.tsx`: `it('the platform bar has the scope crumb, page crumbs, Platform sections tabs and the bell')`.
- [x] **Step 2: Run** `pnpm --filter @agentdesk/web exec vitest run src/components/PlatformNav.test.tsx src/components/OrgSwitch.test.tsx src/components/Chrome.test.tsx`. Expected: FAIL.
- [x] **Step 3: Implement**: reorder `OrgSwitchMenu` groups to Platform (heading "Platform", role group named "Platform"), current org, Switch organization, Create; `PlatformNav` mirrors `OrgNav`. Stories: `PlatformNav` Default/AdminsActive; `OrgSwitch` PlatformScope, PlatformScopeNoMembership, DualRole, MemberOnly; `TopBar` PlatformLevel, PlatformOrgLoading.
- [x] **Step 4: Run** Step 2's command plus `src/test/stories.smoke.test.tsx`. Expected: PASS.
- [x] **Step 5: Commit** `feat(web): platform scope in the scope switch and platform tabs`.

### Task 8: Platform shell uses the platform bar; side menu holds only the org group

**Depends on:** Task 7

**Files:**
- Modify: `apps/web/src/app/routes/platform.tsx` (drop `NO_ORG` and `LINKS` side items; `TopBar variant="platform"` with `org={{ ...bar.org, scope: 'platform' }}`, `platformTabs`, crumbs from Task 5), `components/PlatformLayout.tsx`, `PlatformLayout.module.css`, `PlatformLayout.stories.tsx`, `PlatformLayout.test.tsx`, `screens/platformFrame.tsx`, `screens/platform.stories.tsx` (frame props), `features/platform/shell.route.test.tsx`, `orgDetail.route.test.tsx`, `orgs.route.test.tsx`
- Modify (registration of 8 boards): `screens/shell.stories.tsx`, `screens/storyIds.ts`, `design/prototype/project/canvas.json`, `scripts/parity.mjs`, `test/coverage.test.ts` (→ 331): PlatformOrgsShell, PlatformAdminsShell, PlatformAuditShell, PlatformOrgsShellScopeMenu, PlatformOrgMembersShellLoading, PlatformOrgMembersShellError, PlatformOrgMembersShellNonMember, PlatformOrgOverviewShellNotFound
- Modify (selectors: side-menu links "Organizations", "Platform admins", "Audit log" now in nav "Platform sections"): files found by `grep -rlnE "name: 'Platform admin' \}\)\.getByRole\('link'|Platform admin'.*(Organizations|Platform admins|Audit log)" apps/web/src apps/web/e2e`, and any failing selector the Step 4 runs show

**Interfaces:**
- Consumes: Task 5 (`platformCrumbs`, `PlatformOrgCrumb`), Task 7.
- Produces:

```ts
export type PlatformOrgGroup =
  | { state: 'loading' }
  | { state: 'ready' | 'error'; name: string; links: { overview: string; projects?: string; members?: string; invitations?: string } };
export interface PlatformLayoutProps {
  active?: 'overview' | 'projects' | 'members' | 'invitations';
  /** Absent: no side menu (directory, admins, audit, not found, create). */
  org?: PlatformOrgGroup;
  children: ReactNode;
}
```

- [x] **Step 1: Write the failing tests.**
  - `PlatformLayout.test.tsx`: no org → no `navigation` named "Platform admin"; ready → the org name is a link to `links.overview`, then Overview, Projects, Members, Invitations; loading → two statuses named "Loading organization" and the group's height equals the ready group's (`getComputedStyle` min-height class present); error → name "Organization".
  - `shell.route.test.tsx`: `it('the platform bar reads Platform with tabs and no "No organization"')`; `it('an unknown org id shows Organizations / Not found, no side menu, title "Not found · Agent Desk"')` (MSW `platform.getOrg` 404); `it('a failed org read labels the crumb and side menu "Organization"')` (500); `it('a non-admin still gets "You don\'t have access" and no platform request')` (unchanged access case, must keep passing).
- [x] **Step 2: Run** `pnpm --filter @agentdesk/web exec vitest run src/components/PlatformLayout.test.tsx src/features/platform`. Expected: FAIL.
- [x] **Step 3: Implement**: `useOrgGroup` returns `PlatformOrgGroup | undefined` (links built from the URL `orgId`, so the error state still links); `PlatformLayout` renders `SubNav` only with `org`; loading placeholder uses `Skeleton` in fixed-height rows copied from board PlatformOrgMembersShellLoading. Register the 8 boards; regenerate the interactive prototype (command in Task 5).
- [x] **Step 4: Run** `pnpm --filter @agentdesk/web typecheck && pnpm --filter @agentdesk/web test`. Expected: PASS.
- [x] **Step 5: Commit** `feat(web): platform shell with the platform bar and an org-only side menu`.

### Task 9: e2e for the platform scope

**Depends on:** Task 8

**Files:**
- Modify: `apps/web/e2e/mock/platform-shell.spec.ts`, `apps/web/e2e/mock/org-switch.spec.ts`; selector updates in other `e2e/mock/platform-*.spec.ts` and `e2e/local/platform-*.spec.ts` that click side-menu sections

- [x] **Step 1: Write the tests.**
  - `platform-shell.spec.ts` (`platformAdminOrgs`): `test('the platform bar reads Platform and shows the Organizations, Platform admins and Audit log tabs')`; `test('a platform org members page reads Platform / Organizations / <org> / Members')`; `test('the org name in the side menu opens Overview')`; `test('a platform admin with no membership sees no "Switch organization" group')` (`platformAdminNoOrg`).
  - `org-switch.spec.ts`: `test('a platform admin sees the Platform group first in the scope menu')` (box y of "Platform admin" < first org link).
- [x] **Step 2: Run** `pnpm --filter @agentdesk/web exec vite build --mode mock && pnpm --filter @agentdesk/web exec playwright test e2e/mock/platform-shell.spec.ts e2e/mock/org-switch.spec.ts $(git diff --name-only main -- apps/web/e2e/mock | sed 's#apps/web/##')`; with the stack up, the changed local specs: `pnpm --filter @agentdesk/web exec playwright test $(git diff --name-only main -- apps/web/e2e/local | grep spec | sed 's#apps/web/##')`. Expected: PASS.
- [x] **Step 3: Commit** `test(web): platform scope e2e`.

---

## PR 4: `feat(web): cross-scope links and tab names` (est. ~820 lines)

### Task 10: Tabs and menu item read "Org settings" and "Project settings"

**Depends on:** Task 8

**Files:**
- Modify: `components/OrgNav.tsx`, `ProjectNav.tsx`, `OrgSwitch.tsx` (item "Org settings"), their tests and stories, `Chrome.test.tsx`
- Modify (selectors): files from `grep -rlnE "name: 'Settings'|name: /\^?Settings/|'Settings' \}" apps/web/src apps/web/e2e` (34 files on `main`); replace with `'Org settings'` or `'Project settings'` by context, never with a looser regex

- [x] **Step 1: Write the failing tests**: `OrgNav.test.tsx` `it('the settings tab reads "Org settings"')`; `Chrome.test.tsx` `it('the project settings tab reads "Project settings"')`; `OrgSwitch.test.tsx` `it('the current org group lists "Projects" and "Org settings"')`.
- [x] **Step 2: Run** `pnpm --filter @agentdesk/web exec vitest run src/components/OrgNav.test.tsx src/components/Chrome.test.tsx src/components/OrgSwitch.test.tsx`. Expected: FAIL.
- [x] **Step 3: Implement** the three labels; update selectors from the grep.
- [x] **Step 4: Run** `pnpm --filter @agentdesk/web test`. Expected: PASS.
- [x] **Step 5: Commit** `feat(web): Org settings and Project settings tab names`.

### Task 11: "Open organization" and "Manage this org in Platform"

**Depends on:** Task 10

**Files:**
- Modify: `components/PlatformOrgHeader.tsx` (+ `openHref?: string`, link after "View audit log" with `external` icon), its stories and test; `OrgSwitch.tsx` (+ `manageHref?: string`), stories, test; `features/chrome/appBar.ts`, `appBar.test.tsx`, `appBar.route.test.tsx`; `app/routes/platform.orgs.$orgId.tsx` (pass `openHref`); `screens/PlatformOrgDetail.tsx` (thread `openHref` to the header)
- Modify (registration of 9 boards, → 340): PlatformOrgMembersShell, PlatformOrgOverviewShell, ProjectsShell, ProjectsShellScopeMenu, ProjectsShellScopeMenuPlatformError, ProjectsShellSkipLink, RunsShell, DeskSkillsShell, OrgMembersShell (same four registry files plus `shell.stories.tsx`)

**Interfaces:**
- Produces:

```ts
// features/chrome/appBar.ts
export function openOrgHref(memberships: ReadonlyArray<{ id: string; slug: string }>, orgId: string): string | undefined; // `/o/<slug>/projects`
// useAppBar: org.manageHref = `/platform/orgs/<current org id>` only when platformAdmin is true and the page has an org
OrgSwitchProps: + manageHref?: string // "Manage this org in Platform" in the Platform group, org scope only
PlatformOrgHeaderProps: + openHref?: string
```

- [x] **Step 1: Write the failing tests.**
  - `appBar.test.tsx`: `openOrgHref` returns the href for a membership id and `undefined` for another id; ids are matched, never slugs.
  - `appBar.route.test.tsx`: `it('a platform admin gets manageHref for the current org')`; `it('an org admin without the platform role gets no manageHref')`; `it('a failed GET /api/me/platform gives no Platform group and no manageHref')` (MSW 500; Review Focus 4).
  - `OrgSwitch.test.tsx`: the item shows only with `manageHref` and only in org scope.
  - `PlatformOrgHeader.test.tsx`: link "Open organization" only with `openHref`, after "View audit log".
  - `features/platform/orgDetail.route.test.tsx`: member org shows the link to `/o/alice/projects`; non-member org shows none.
- [x] **Step 2: Run** `pnpm --filter @agentdesk/web exec vitest run src/features/chrome src/components/OrgSwitch.test.tsx src/components/PlatformOrgHeader.test.tsx src/features/platform/orgDetail.route.test.tsx`. Expected: FAIL.
- [x] **Step 3: Implement**: the route reads `useSuspenseQuery(orgsQuery)` (already ensured by the platform `beforeLoad`) and passes `openOrgHref(orgs, orgId)`. Stories: header WithOpenLink / WithoutOpenLink; OrgSwitch DualRoleManage. The 9-board registration is deferred to the follow-up `test(web): navigation shell boards` PR (Agent call, unit over about 850 lines).
- [x] **Step 4: Run** `pnpm --filter @agentdesk/web typecheck && pnpm --filter @agentdesk/web test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): Open organization and Manage this org in Platform links`.

### Task 12: e2e for cross-scope links, tab names and roles

**Depends on:** Task 11

**Files:**
- Modify: `apps/web/e2e/mock/nav-shell.spec.ts`, `platform-org-detail.spec.ts`, `org-switch.spec.ts`; `apps/web/e2e/local/platform-access.spec.ts`

- [x] **Step 1: Write the tests.**
  - `nav-shell.spec.ts` (`test.describe('tab names')`, `owner`): `test('the org tabs read Projects and Org settings, the project tabs Runs and Project settings')`.
  - `nav-shell.spec.ts` (`test.describe('roles')`, the role-based case): `test('an org admin without the platform role sees no Platform group and no "Manage this org in Platform"')` (`seedOnboarding(page, 'orgAdmin')`); `test('a project admin sees no Platform group and the Org settings tab opens Invitations only')` (`'projectAdmin'`: tab "Org settings" visible; side menu `Organization settings` holds "Invitations" and none of "General", "Members", "Audit log").
  - `platform-org-detail.spec.ts` (`platformAdminOrgs`): `test('"Open organization" on a member org lands on /o/<slug>/projects')`; `test('a non-member org has no "Open organization"')`. Agent call: if the scenario has no platform org the admin is not a member of, add one to `platformScenarios.ts` in this task.
  - `org-switch.spec.ts`: `test('"Manage this org in Platform" opens /platform/orgs/<id>')`.
  - `platform-access.spec.ts` (local): `test('a dual-role user clicks "Open organization" and lands on the org with it active')` (fresh user via `freshUser`, `grantPlatformAdmin(pa, …)`, owner of org A via `signInAndCreateProject`; open `/platform/orgs/<A id>`, click, expect `/o/<A slug>/projects` and the scope button names org A); `test('a platform admin who is a member of org A sees no "Open organization" on org B and /o/<b-slug> stays not found')` (org B via `createOrg(pa, …)`; cross-tenant).
- [x] **Step 2: Run**

```bash
pnpm --filter @agentdesk/web exec vite build --mode mock
pnpm --filter @agentdesk/web exec playwright test e2e/mock/nav-shell.spec.ts e2e/mock/platform-org-detail.spec.ts e2e/mock/org-switch.spec.ts
# stack up (devbox run dev):
pnpm --filter @agentdesk/web exec playwright test e2e/local/platform-access.spec.ts -g "Open organization"
```

Plus the changed specs from Task 10's selector updates (`git diff --name-only main -- apps/web/e2e`). Expected: PASS. If the stack cannot start, say so in the PR and list the local tests as written but not run.
- [x] **Step 3: Commit** `test(web): cross-scope links, tab names and role e2e`.

---

## PR 5: `feat(web): create organization inside the platform shell` (est. ~300 lines)

### Task 13: `/platform/orgs/new` with a redirect from `/orgs/new`

**Depends on:** Task 11

**Files:**
- Create: `apps/web/src/app/routes/platform.orgs.new.tsx`
- Modify: `app/routes/orgs.new.tsx` (only `beforeLoad: () => { throw redirect({ to: '/platform/orgs/new' }) }`), `screens/CreateOrg.tsx` (drops `user`, `org` and its `TopBar`; renders the `main` only), `screens/invitations.stories.tsx` (CreateOrg boards wrap the screen in `PlatformFrame`), `features/orgs/createOrg.ts` (`created` state + `orgId: string`), `features/orgs/createOrg.route.test.tsx`, `features/chrome/appBar.ts`, `app/routes/platform.orgs.index.tsx`, `app/routes/invitations.index.tsx`, story frames using `createHref: '/orgs/new'` (all → `/platform/orgs/new`), `features/platform/crumbs.ts` (already maps the path, Task 5)
- Modify: `test/topBarCallSites.test.ts` (`screens/CreateOrg.tsx` leaves the list); board CreateOrgPlatformShell registration (→ 341)

**Interfaces:**
- Consumes: Task 5 `platformCrumbs` (`/platform/orgs/new`), Task 8 `PlatformLayout` without `org`.
- Produces: `CreateOrgProps` without `user`/`org`; `CreateOrgState` `created` adds `orgId: string`.

- [ ] **Step 1: Write the failing tests** in `createOrg.route.test.tsx`: `it('/orgs/new redirects to /platform/orgs/new')`; `it('the page renders inside the platform shell: Platform bar, crumbs Organizations / Create organization, Organizations tab current')`; `it('a non-admin gets the platform forbidden state and no create request')` (the layout check replaces the page check; keeps the denied case); `it('Done opens the new org platform page')`; `it('/platform/orgs/new is not read as an org id')` (no `platform.getOrg` request).
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/web exec vitest run src/features/orgs/createOrg.route.test.tsx src/test/topBarCallSites.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the route (no own platform check; loader ensures session and orgs as today), the redirect, the screen change, `onDone` → `navigate({ to: '/platform/orgs/$orgId', params: { orgId } })`. Register the board; regenerate the interactive prototype.
- [ ] **Step 4: Run** `pnpm --filter @agentdesk/web typecheck && pnpm --filter @agentdesk/web test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): create organization inside the platform shell`.

### Task 14: e2e for the moved create page

**Depends on:** Task 13

**Files:**
- Modify: `apps/web/e2e/mock/create-org.spec.ts` (existing tests open `/platform/orgs/new`; add the redirect case); `apps/web/e2e/local/onboarding-platform.spec.ts` only if it opens `/orgs/new` and asserts the URL

- [ ] **Step 1: Write the tests**: `test('/orgs/new redirects to /platform/orgs/new inside the platform shell')` (URL, scope button "Platform", tab "Organizations" current, crumb "Create organization").
- [ ] **Step 2: Run** `pnpm --filter @agentdesk/web exec vite build --mode mock && pnpm --filter @agentdesk/web exec playwright test e2e/mock/create-org.spec.ts`; if the local spec changed, run it with the stack up. Expected: PASS.
- [ ] **Step 3: Commit** `test(web): create organization e2e in the platform shell`.

---

## Task graph

| Wave | Task | Depends on |
| --- | --- | --- |
| 1 | Task 1: SkipLink (PR 1) | none |
| 1 | Task 2: useDocumentTitle and pageTitle (PR 1) | none |
| 2 | Task 3: landmark names, scope button label, e2e (PR 1) | Task 1, Task 2 |
| 3 | Task 4: TopBar breadcrumb and title (PR 2) | Task 3 |
| 4 | Task 5: call sites, inventory test, platform crumbs (PR 2) | Task 4 |
| 5 | Task 6: crumbs and title e2e (PR 2) | Task 5 |
| 5 | Task 7: OrgSwitch scope, PlatformNav (PR 3) | Task 5 |
| 6 | Task 8: platform shell bar and side menu (PR 3) | Task 7 |
| 7 | Task 9: platform scope e2e (PR 3) | Task 8 |
| 7 | Task 10: tab names (PR 4) | Task 8 |
| 8 | Task 11: cross-scope links (PR 4) | Task 10 |
| 9 | Task 12: cross-scope, tab and role e2e (PR 4) | Task 11 |
| 9 | Task 13: create org in the platform shell (PR 5) | Task 11 |
| 10 | Task 14: create org e2e (PR 5) | Task 13 |

Spec coverage: findings 1-2, 4, 6, 8 (Tasks 4-8), 3 (Task 7), 5 (Task 11), 7 (Task 10), 9 (Tasks 1-3), 10 (Task 13), 11 bell (Task 4); every Test plan item maps to Tasks 1-14; Risks: call-site drift (Task 5 grep and inventory test), renamed selectors (Tasks 3, 8, 10), `/orgs/new` redirect (Task 13).
