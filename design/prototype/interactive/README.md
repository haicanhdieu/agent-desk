# Agent Desk: interactive prototype

One clickable prototype of the whole web app, built from the design boards in `design/prototype/project/*.dc.html`. It is for a UI designer to explore. It is not production code and it talks to no server.

## How to open

Double-click `index.html`, or open it in any current browser (checked in headless Chrome). It runs from `file://`: plain HTML, CSS and JavaScript, no build, no server, no npm, no CDN, no libraries.

- Entry file: `design/prototype/interactive/index.html`
- Start screen: Sign in. Click "Sign in with GitHub" to enter as the default role (Org owner).
- The URL hash is the router: `#/o/harbor-labs/settings/members`. Links, the back button and reloading a URL work. State (members, invitations, audit) lives in memory and resets on reload.
- Fonts are not loaded (the boards link none), so the browser falls back to its system font. Text widths can differ slightly from the boards.

## Prototype controls (outside the app)

A dashed panel at the bottom right, collapsible (it remembers its state in the browser). It is not part of the app.

| Control | What it does |
| --- | --- |
| Signed in as (role) | Switches the signed-in person: Org owner (Kim Hale), Org admin (Jordan Wu), Project admin (Lee Park), Member (Mira Chen), Viewer (Theo Brandt), Platform admin (Morgan Avery, no membership), Platform admin + org admin + project admin (Priya Natarajan), New user with invitations (Dana Ortiz), Visitor with no invitation (Jo Marsh). Only roles that appear in the boards and specs are offered. |
| Scenario / state of this screen | Live (the working screen), Loading, Empty, Error, Forbidden, Page crash, plus every board of that screen family as a static snapshot. The choice is stored in the URL as `?s=`. |
| Fail the next action with | Makes the next save, role change, remove, invite, resend, revoke or accept fail with 500, 403, 404 (removed meanwhile), 409 (last owner, no longer pending; on the Environment tab: entry limit on add, 256 KiB size on edit), "Too large (409)" (Environment tab: 256 KiB size) or "clipboard blocked". On the Environment tab, 404 on Edit, Replace or Remove acts as if another admin removed the entry meanwhile. |
| Reset | Restores all fake data and signs out. |
| Logout, Screen map, Copy link | Log out; a modal list of every route; copy the current URL. |
| Proposals to review | Two checkboxes, both off by default, for the open questions of the Option A navigation proposal (see "Navigation"): "Keep a Settings button on the Projects page header" and "Show the org-wide 'needs you' count on the Projects tab". Reset turns both off. |

## Roles and what they see (per spec)

| Role | Scope switch (first crumb) and its menu | Org settings tab and menu item | Org settings side menu | Notes |
| --- | --- | --- | --- | --- |
| Org owner (Kim Hale) | Org name; menu: this org (Projects, Org settings), Switch organization (3 orgs) | yes | General, Members, Invitations, Audit log | Owner card in Change access; can act on owner rows; step-down warning on own row; cannot remove self |
| Org admin (Jordan Wu) | Org name; menu: this org only (one org) | yes | General, Members, Invitations, Audit log | No Owner card; no actions on owner rows |
| Project admin (Lee Park) | Org name; menu: this org only | yes | Invitations only | Sees and invites only for projects they administer; other tabs show "You don't have access" inside the layout; sees only their projects. Project scope: Runs, Project settings |
| Member, Viewer | Org name; menu: Projects (+ org list for Mira) | no | none | A typed Settings URL shows "You don't have access" under the same bar |
| Platform admin, no membership (Morgan Avery) | "Platform"; menu: Platform group (Platform admin), Create organization; no org list | n/a | n/a | Lands on Platform > Organizations. Platform tabs. No "Open organization" on any platform org page; every `/o/<org>` URL is "Not found" (Decision 1, unchanged) |
| Platform admin + org admin + project admin (Priya Natarajan) | "Platform" on platform pages, the org name elsewhere; menu: Platform group (Platform admin, and on org pages "Manage this org in Platform"), this org, Switch organization (Harbor Labs, Northwind), Create organization | Harbor Labs: yes (org admin). Northwind: yes, Invitations only (project grant on forecast-service, no org role) | per org, as the rows above | "Open organization" on the platform pages of Harbor Labs and Northwind only. Use this persona for the Platform <-> Org <-> Project walk-through |

Every other role sees the platform area (`#/platform/...`) as "You don't have access" under their own bar.

## Side menu shell (new, under `#/side/`)

From `docs/superpowers/specs/2026-11-25-sidebar-navigation-shell-design.md`. Open `index.html#/side/signin`. **Side mode** is every route under `#/side/...`: the same live screen, role rules and fake data, drawn in the new shell (a top bar with switchers and crumbs, a side menu for the scope, one page header). The routes without `/side` keep the tabs shell described under "Navigation", so the two can be compared; change the "Navigation" control to switch the current page. Links, sign-in and role switches stay in the mode you are in. The code is `screens/sidenav.js`; it only wraps the helpers of the other files. The menus, icons, repository block, key row and preview text are copied at run time from the new boards.

Open the panel section "Side menu shell: width and data states" (closed at first).

| Control (section "Side menu shell") | Choices |
| --- | --- |
| Navigation | Side menu (new), Top tabs (current) |
| Window width | Follow this window, 1024px and up, Below 1024px (drawer), Phone 390px. Only two steps exist: below 1024px and below 640px |
| Side menu data | Loaded, Loading, Error with Retry (organization, project and platform menus) |
| Organization list | Loaded, Loading, Error with Retry. While it is loading or has failed, the page waits or shows the error, and an organization or project menu keeps only Projects or Runs, plus Retry after a failure. Platform menus stay. Open the first crumb to see the switcher state |
| Project list | Loaded, Loading, Error with Retry, Empty. Open the project crumb to see it |
| Repository block | From the project, Connected, Warning, Error, No default branch |

"Scenario / state of this screen" lists all 117 new boards: "this screen" first, then the others. A new board is drawn as it is (a 390px or 1024px board in a frame of that width); choose "Default" or "Live" to return to the live screen.

| What to try (role) | How |
| --- | --- |
| Menus by role | Org owner: full organization menu. Project admin: Projects and Invitations; full project menu on invoicer-api only. Member (Mira Chen, project invoicer-web): project menu is Runs plus the repository block. Platform admin + org admin + project admin: "Manage in Platform" at the foot of the organization menu |
| Collapse | Collapse menu, then open other pages: they share the choice. Every run page opens collapsed; expanding it changes no other page |
| Redirects and Not found | `#/side/o/harbor-labs/p/invoicer-api` and `.../desk` go to Runs (replace). `.../invoicer-api/needs-you` is Not found in the project menu. Project admin on `.../p/invoicer-web/runs`: Not found with the organization menu |
| Wizard (Org owner) | Setup step 3: Preview, Close. Exit setup, then "Resume setup" on the reports-service row of Projects returns to the step you left |
| Platform (Platform admin) | Organizations, open one: the menu is replaced; back link "Organizations" |
| Below 1024px | Menu button, drawer, pick a page. Escape, the close button or the scrim close it |
| Phone run (width Phone) | Run 62: Terminal and Details; the key row shows under a live terminal only (Run 62 and Run 61) and a key shows a toast |

Multi-agent screens in side mode: Agent & settings (all four tabs), Routing rules and setup step 2 are the live screens of `screens/deskagent.js`, moved into the shell with their own pinned title, tabs, pager, footers and scroll areas, so the window does not scroll. Below 1024px the add, edit and rule panes take the place of the list; at 390px agent rows stack and the tab strip scrolls sideways if it does not fit. Routing rules opens with a rule pane at 1024px and up (as in the tabs shell) and with the list below 1024px. "Manage installation on GitHub" and "Send test ping" are hidden; "Check now" stays in polling mode. Setup step 4 "Change" opens `?tab=limits`. In side mode only, the menu keeps a gap at its foot so the collapsed "Prototype controls" button does not cover it. The multi-agent boards themselves are not redrawn: opened under `#/side/`, they are rearranged at display time.

Some new boards are drawn already scrolled, to show what is further down (DeskRulesSideMenu and DeskRulesSideMenuSetupWarning: the rule pane; DeskRulesPromptPhone: the pane; Setup2AgentPickedPhone, Setup2AgentRejectedPhone and Setup4Phone: the step). A drawing cannot be scrolled back up; the live screen can.

What is faked in side mode: the terminal keys send nothing; the Preview dialog shows the code-build sample text for every template (only its title follows the template); the live pages are rearranged from the old drawn pages (page header, cards and stacked columns are made at display time), so spacing can differ by a few pixels from the new boards, which are the reference. Focus handling covers the drawer, the collapse button, the run view switch and the skill preview only; arrow keys in the switchers and terminal tabs are not built.

## Navigation: one scope-aware shell

From the approved navigation-consistency spec (`docs/superpowers/specs/2026-11-24-admin-navigation-consistency-design.md`), on top of Option A. One rule on every page: **top bar tabs are the sections of the current scope; the side menu holds the pages of one section; the breadcrumb says where you are.**

```
Platform page  [logo] | Platform v / Organizations / Harbor Labs / Members   Organizations  Platform admins  Audit log   bell (PN)
Org page       [logo] | Harbor Labs v / Org settings / Members              Projects  Org settings                     bell (PN)
Project page   [logo] | Harbor Labs v / invoicer-api v / Runs               Runs 1  Project settings   Repo on GitHub  bell (PN)
Run page       [logo] | Harbor Labs v / invoicer-api v / Runs 1 / Run 62    status, actions                            bell (PN)
Create org     [logo] | Platform v / Organizations / Create organization    Organizations  Platform admins  Audit log   bell (PN)
No org (Dana)  [logo] | No organization / Invitations                                                                  bell (DO)
```

| Part | What it does |
| --- | --- |
| Skip link | "Skip to main content": the first focusable item on every page (press Tab once); visible on focus; Enter moves focus to `main` |
| Logo | The person's home: the org's Projects on org pages; elsewhere the first org's Projects, or Platform > Organizations for a platform admin with no membership |
| Scope switch (first crumb) | Shows the scope: "Platform" in the platform area, otherwise the org name (`aria-label` "Switch scope, currently Platform" / "... currently organization Harbor Labs"). Menu, top to bottom: **Platform** group (platform admins only: "Platform admin", and on org and project pages "Manage this org in Platform"), this org's Projects and Org settings, "Switch organization" (memberships only; none for a platform admin without membership, not an empty group), "Create organization" (platform admins) |
| Project crumb | Project switcher on project and run pages (unchanged) |
| Page crumbs | After the scope crumbs on every page: `Organizations / Harbor Labs / Members`, `Org settings / Members`, `Project settings / Routing rules`, `Runs / Run 62`. Every crumb but the last is a link; the last has `aria-current="page"`. All crumbs sit in one `<nav aria-label="Breadcrumb">` (the old `aria-hidden` "/" span on the project bar is gone) |
| Tabs | Platform: Organizations, Platform admins, Audit log (`<nav aria-label="Platform sections">`). Org: Projects, Org settings (`Organization sections`). Project: Runs, Project settings (`Project sections`). No nav is named "Main" any more; no two navs share a name |
| Platform side menu | Only inside one org: the org name (a link to Overview), Overview, Projects, Members, Invitations (`<nav aria-label="Platform admin">`). The directory, Platform admins and Audit log have no side menu. While the org loads the group keeps its size (fixed-height placeholders) and the crumb shows a fixed-width skeleton, so nothing jumps |
| "Open organization" | On a platform org page (after "View audit log"), only when the org is one of the signed-in person's memberships. Opens `/o/<slug>/projects` with that org active |
| "Manage this org in Platform" | In the scope menu on org and project pages, platform admins only. Opens `/platform/orgs/<id>` |
| Create organization | `#/platform/orgs/new` inside the platform shell (Organizations tab active); `#/orgs/new` redirects there. Done opens the new org's platform page (the creator is not a member) |
| Bell | On every bar, platform and run included. No behaviour yet (a click shows the prototype's "Not wired" toast) |
| Page title | `<last crumb> · <scope> · Agent Desk` from the same crumb list: "Members · Platform · Agent Desk", "Projects · Harbor Labs · Agent Desk", "Run 62 · invoicer-api · Agent Desk" (never the ticket title). Not found and forbidden: "Not found · Agent Desk", "You don't have access · Agent Desk" |
| Account menu (avatar) | Name, email, "Logout" (unchanged) |

Clicks for the combined role: Org -> Platform: scope switch, "Manage this org in Platform" (2). Platform -> Org: "Open organization" (1), or scope switch, org (2). Project or run -> Platform: scope switch, "Platform admin" (2). Back: the crumbs and the browser back button on every page.

States drawn for the changed screens: loading (crumb skeleton, side menu placeholder: `?s=loading` on a platform org page, board PlatformOrgMembersShellLoading), error (the org crumb and side menu group read "Organization": `?s=error`, PlatformOrgMembersShellError), not found (crumbs `Organizations / Not found`, "Back to organizations": an unknown org id, PlatformOrgOverviewShellNotFound), empty (no org list in the scope menu for a platform admin without membership: PlatformOrgsShellScopeMenu), platform check failed (no Platform group: ProjectsShellScopeMenuPlatformError).

### Option A (kept from the earlier proposal)

The Option A rules still hold: one bar on every page, the org crumb is always a button, Settings is a tab (now "Org settings" / "Project settings"), the run page bar has no tabs, the account menu holds no Settings.

### What changed from the first prototype

- Three different bars (global, project, run) became one bar with two crumb depths (`chrome.bar`, `chrome.orgCrumb`, `chrome.projCrumb`, `chrome.orgTabs`, `chrome.projTabs` in `js/chrome.js`; the shell added `chrome.scope`, `chrome.pageCrumbs`, `chrome.breadcrumb`, `chrome.platformTabs` and `chrome.title`).
- The org switcher is now on every org, project and run page, and is a real menu also for single-org people.
- Settings is a tab (org pages) and an org-menu item (every page). The Settings button on the Projects page header is gone by default (a proposal toggle brings it back). The avatar-menu Settings item and its toggle are dropped.
- The run page crumb "invoicer-api" no longer leads to the all-projects list; the crumbs are now the org and project switchers followed by "Runs" (the project's Runs list).
- The needs-you page has the bar. My invitations is reached from sign-in, not from the account menu. "Sign out" is now "Logout" everywhere (the code uses "Logout").
- The static boards are still drawn inside the live bar: the bar of each board's header strip is replaced by the live one (198 org-level, 95 project-level, 34 run-level). Boards drawn without a bar and now given one: the needs-you explainer (org bar) and the page-crash and loading boards (bar of the current area). Boards that stay barless: Main (index), the two sign-in boards, Pagination and RunTranscriptStates (explainers). The check script counts the bars of every board: exactly one, never two.
- Board text changes done at display time (the boards stay untouched): "This list is one click away on the logo." reads "... on the Projects tab." on Projects boards, and the Settings or Invitations button in the head of the Projects boards is hidden unless the first proposal toggle is on.

### Proposals to review

The navigation-consistency spec's three decisions are drawn as decided, with no toggle: (1) "Open organization" only for members, a platform admin who is not a member gets no org pages; (2) the tabs are "Org settings" and "Project settings"; (3) the bell is on every bar, platform included, with no behaviour. The two toggles below are the still-open questions 2 and 3 of the earlier Option A proposal (not decided):

| Toggle (Prototype controls) | Default | What it does |
| --- | --- | --- |
| Keep a Settings button on the Projects page header | off | Shows the "Settings" button (only for roles who may open Settings) next to "New project", as the spec had it. Static Projects boards that were drawn with a Settings or Invitations button keep it while this is on. |
| Show the org-wide "needs you" count on the Projects tab | off | Adds the amber "N needs you" badge (same style as on the Runs tab) to the Projects tab on every org page, summed over the projects the person can see. |

The proposal's question 1 (is "Settings two clicks from inside a project" acceptable) is not a toggle: the prototype draws Option A as proposed, so Settings from a project is the org menu, then Settings.

## Screen map (route to source boards)

| Route | Screen | Source boards |
| --- | --- | --- |
| `#/signin` | Sign in (also the refused case with `?s=SignInNoInvitation`) | SignIn, SignInNoInvitation |
| `#/invitations` | My invitations (accept and decline work) | MyInvitations* |
| `#/invitations/<token>` | Accept an invitation | InvitationAccept* |
| `#/platform/orgs/new` | Create organization (platform admin) inside the platform shell; the old `#/orgs/new` redirects here | CreateOrg*, CreateOrgPlatformShell |
| `#/platform` | Redirects to the Organizations directory (platform admin only) | n/a |
| (every page) | The one scope-aware shell: scope switch, crumbs, tabs per scope, skip link, page title (see "Navigation") | *Shell boards |
| `#/platform/orgs` | Platform > Organizations tab: search and status filter in the URL (`?q=`, `?status=`), Create organization. No side menu | PlatformOrgs*, PlatformOrgsShell* |
| `#/platform/orgs/<orgId>` | Organization detail > Overview: status, Edit organization (name and URL, URL-change confirm; also on a suspended org), Suspend / Reactivate with a reason, View audit log. After a URL change the old `/o/<old-slug>` shows not found. Crumbs `Organizations / <org> / Overview`; "Open organization" for members; side menu with the org group only | PlatformOrgOverview*, PlatformOrgEdit*, PlatformOrgOverviewShell* |
| `#/platform/orgs/<orgId>/projects` | Organization detail > Projects (id and name only) | PlatformOrgProjects* |
| `#/platform/orgs/<orgId>/members` | Organization detail > Members: roles with scopes; row menu Add assignment, Remove one assignment | PlatformOrgMembers*, PlatformOrgMembersShell* |
| `#/platform/orgs/<orgId>/invitations` | Organization detail > Invitations (same actions as Settings > Invitations; Owner may be invited) | PlatformOrgInvitations* |
| `#/platform/admins` | Platform admins tab: add (404 / 422 field errors), revoke, revoke yourself, last working admin | PlatformAdmins*, PlatformAdminsShell |
| `#/platform/audit` | Platform Audit log tab: Action select (`?action=`), org chip (`?org=<orgId>`) | PlatformAudit*, PlatformAuditShell |
| `#/o/<suspended org>/...` | Every URL of a suspended org shows "This organization is suspended"; the switcher marks it "Suspended" | OrgSuspended* |
| `#/o/<org>/projects` | Projects list, banners, checklist, scope switch | Projects*, ProjectsShell* |
| `#/o/<org>/projects/new/1..4`, `ready`, `workspace` | New project setup. Step 2 is the live "Add agent" step (provider picker, nothing preselected); the other steps are board snapshots. The stepper reads "Add agent" on every step, and after step 2 it names the agent you set up ("<provider>, <model>") | Setup* |
| `#/o/<org>/needs-you` | Needs you outside the run page (under the org bar) | NeedsYou* |
| `#/o/<org>/p/<project>/runs` | Runs (grouped, flat, problems, linked) | Runs*, RunsShell |
| `#/o/<org>/p/<project>/runs/<n>` | Run page (starting, running, idle, stopped, failed, ...) | Run* |
| `#/o/<org>/p/<project>/runs?s=RunsUsage` | Run token usage and estimated cost (run-token-usage-cost spec): the Runs list with the Usage column; click Run 60, 55, 57 or 61 to open the run page with its Usage section (Runs crumb returns to this list). The detail note ends with its "Prices as of" date (a date range on RunSucceededUsagePriceRange, none when there is no cost) before "Your provider bill may differ." On every run usage board, Show / Hide on the Usage section and on its Models table collapses and expands them. Scenario group "Token usage and cost" on the Runs and Run screens lists every state | RunsUsage, RunsPageLoadingUsage, RunSucceededUsage* (incl. RunSucceededUsagePriceRange), RunRunningUsage* |
| `#/o/<org>/p/<project>/desk/rules\|skills` | Desk (routing rules, skills). Routing rules now opens on DeskRulesAgentWarning (agent names on every rule, one rule whose agent has no credential); click the /triage rule to open its pane (DeskRulesAgent): the "With agent" picker lists Project default first, then agents by name, and picking another agent resets Model to Default model | DeskRules*, DeskRulesAgent*, DeskSkill* |
| `#/o/<org>/p/<project>/desk/agent` | Desk > Agent & settings, several agents per project (multi-agent-configs spec): a live tab strip Agents, GitHub connection, Limits, Danger zone (`?tab=github\|limits\|danger`, nothing for Agents; an unknown tab, or Danger zone without project delete, falls back to Agents). Agents tab: paged list (`?page=`), Add agent and Edit in a side pane (`?agent=new\|<id>`), row menu (Test connection, Set as default, Delete), delete dialog, in memory. A project admin gets three tabs, no Danger zone; a member or viewer gets "You don't have access". Scenario group "Agent & settings states": more than one page, read-only role | DeskAgent* (the earlier one-page boards stay in their own group), see "Agent & settings (multi-agent)" below |
| `#/o/<org>/p/<project>/desk/members` | Project Settings > Members (project admin space): project roles, Add member, Invite people, Change role, Remove. Member and viewer get the Forbidden page. Reached from the Desk side menu's "Access" group (Members, Audit log), drawn on every Desk board and shown only to org owner, org admin and the admin of that project | DeskMembers* |
| `#/o/<org>/p/<project>/desk/audit` | Project Settings > Audit log (project admin space). Member and viewer get the Forbidden page | DeskAudit* |
| `#/o/<org>/p/<project>/desk/setup` | Desk > Workspace setup, Setup script tab (drawn board with the live "Setup script \| Environment" tab strip) | DeskSetup, DeskSetupPaged, DeskSetupTest, DeskSetupVersions* |
| `#/o/<org>/p/<project>/desk/setup?tab=environment` | Desk > Workspace setup, Environment tab (live: variables and secrets in memory) | DeskSetupEnvironment* |
| `#/o/<org>/settings` | Redirects to the first tab the role may open | n/a |
| `#/o/<org>/settings/general` | General (rename, URL change) | OrgGeneral* |
| `#/o/<org>/settings/members` | Members (change role, remove) | OrgMembers*, OrgMembersShell |
| `#/o/<org>/settings/invitations` | Invitations (invite, revoke, resend, copy link) | OrgInvitationsSettings, OrgInvitations* |
| `#/o/<org>/settings/audit` | Audit log | OrgAudit* |
| `#/o/<org>/invitations` | Old URL; redirects to Settings > Invitations | n/a |
| `#/index` | Index of all boards | Main |
| `#/gallery/pagination` | Pagination and route loading/error boards | Pagination, RouteLoading, RouteError |
| `#/side/...` (every route below) | The side menu shell (see "Side menu shell"): same screen, new shell. Boards: `*SideMenu*`, `*Side*`, `*Phone*`, `*ExitSetup` and the others listed at the end of the coverage table | 117 new boards |
| `#/side/signin` | Sign in with the footer "Proof of concept." | SignInProofOfConcept, SignInPhone |
| `#/side/o/<org>/projects` | Organization menu; new intro line; "Resume setup" row | ProjectsSideMenu*, ProjectsMemberSideMenu, ProjectsResumeSetup, ProjectsPhone*, ProjectsSide* |
| `#/side/o/<org>/settings/<general\|members\|invitations\|audit>` | Organization menu, shared page header | OrgMembersSideMenu*, OrgInvitationsSettings*SideMenu*, OrgAuditForbiddenSideMenu, Org*Phone |
| `#/side/o/<org>/projects/new/<step>` | Wizard: stepper in the menu place, "Exit setup", Preview dialog on step 3 | Setup*ExitSetup, Setup3PreviewDialog*, Setup*Phone, Setup3PhoneDrawer |
| `#/side/o/<org>/p/<project>` and `.../desk` | Redirect (replace) to Runs; no screen of its own | n/a |
| `#/side/o/<org>/p/<project>/needs-you` | Removed page: Not found in the project menu | RunsNeedsYouNotFound |
| `#/side/o/<org>/p/<project>/runs` (`?filter=ignored`) | Project menu and repository block | RunsSideMenu*, RunsSideProjectSwitcher*, RunsNotFoundSideMenu, RunsPhone* |
| `#/side/o/<org>/p/<project>/runs/<n>` | Run page: menu collapsed on entry, status and actions in the page header; below 1024px "Terminal \| Details" and the key row | RunIdleSide*, RunIdle1024, RunRunning*SideMenu, Run*Phone* |
| `#/side/o/<org>/p/<project>/desk/<tab>` | Project menu; h1 "Skills" and "Workspace setup"; unfinished links hidden | Desk*SideMenu*, Desk*Phone |
| `#/side/platform/...` | Platform menu, or the one-organization menu | PlatformOrgsSideMenu, CreateOrgSideMenu, PlatformOrg*SideMenu*, Platform*Phone, CreateOrgPhone |
| `#/side/invitations`, `.../<token>` | "My invitations" from the account menu; the active organization's menu, else none | MyInvitations*, InvitationAccept*SideMenu / NoMenu / Phone |
| errors and suspended (scenario boards) | 403, 404, 5xx, crash, loading and suspended in the new shell | RouteError*, RouteLoadingSideMenu, OrgSuspended*, PlatformAdminsForbiddenNoMenu |

Orgs in the data: `harbor-labs` (Harbor Labs, main one), `northwind` (Northwind Analytics, empty, with a getting-started checklist), `riverside` (long name, Kim Hale is only a member). The platform directory also lists `acme-rockets` (no owner yet) and `bluefin-health` (suspended); those two exist only in the platform area. In Add platform admin, `jo.marsh@example.com` has no account (404) and `new.hire@agentdesk.example` is not verified (422); any persona or member email works. Projects: invoicer-api, invoicer-web, docs-site, billing-jobs. Priya Natarajan (the combined role) is a platform admin, an Admin of Harbor Labs (plus Admin on invoicer-api) and, in Northwind, Admin of forecast-service with no org role.

## What is real and what is faked

Real (works and changes what you see):
- Sign-in as the chosen role, the top bar (org and project switchers, tabs by role, account menu), org switching (with a short loading state), hash routing, back button.
- Projects list with per-role visibility, checklist, pending-invitation banner, "Switch to polling".
- Settings: General (validation, slug-taken, slug-change confirmation, rename updates the switcher), Members (paging, access chips per scope, row menus, Change access with role cards and a Project access section to add, change and remove project grants, Owner note, step-down warning, last-owner conflict, Remove), Invitations (filters, paging, invite dialog with whole-org or some-projects, created dialog, revoke, resend, copy link), Audit log (new entries appear at the top for every change above).
- Accepting and declining invitations; creating an organization as platform admin.
- Desk > Workspace setup: the "Setup script | Environment" tab strip (`?tab=environment`) and the Environment tab: add a variable or secret (name format, reserved names, a name that already exists in either list, a secret under 6 characters, entry limit, 256 KiB size), edit a variable in place (name read-only), Replace a secret (empty "New value", Save disabled while empty), Remove with a confirm dialog, the "Added NAME" toast, paging per list (`varsPage`, `secretsPage`; the other list and an open form stay), the "This entry no longer exists" row message, Show value, Enter submits and Escape cancels a row form. Secret values are never kept after a save and never drawn. Member and viewer get "You don't have access" on this page (no `setup:read`); owner, admin and the project admin of that project get every control.
- Desk > Agent & settings (several agents per project): the tab strip with the tab in the URL; the Agents tab (add in three steps: create, save the credential, test, with the step shown on the footer button; name taken and empty-model field errors; edit with provider fixed; Replace credential and "Credential needed again" when the API address or the credential type changes; Test connection; Set as default with its toast; Delete with the confirm dialog and the refusals for the default agent, a routing rule that names it and an open run; paging; read-only role); the GitHub connection tab (Webhook or Polling, check interval, Check now, Send test ping); the Limits tab (seven project-wide limits, field errors, save); Danger zone (button not wired). Failure injection: 403 on any write; 500 on Save agent with a credential fails the credential step (the agent is kept and the pane says so); 500 elsewhere is a server error; 409 on Save agent is a name already used; 409 on Delete says the agent has open runs; 404 on Save, Test or Delete says the agent was deleted meanwhile. To see the test result words, type a credential that contains `reject`, `unreach` or `odd`; an OpenCode credentials file, or an OpenCode agent with no credential, always answers Not checkable (it cannot be probed). OpenCode works without signing in: nothing is picked by default and an empty credential is valid (the row reads "OpenCode . No sign-in" with the neutral status "No credential"). Its Authentication control has two choices, "Credentials file" and "API endpoint and key"; the endpoint field shows only with the second, together with the key (typing one without the other is refused), and the model becomes required (the plain id the endpoint serves). With a file or nothing the model is optional and starts on "OpenCode default". Changing the choice clears the typed key, endpoint and model.
- Setup step 2 "Add agent" (new-project wizard): pick Claude Code, OpenAI Codex or OpenCode (nothing is preselected; Continue with none shows "Pick an agent to continue."); the credential type choice, token or key (write-only, with a show button), API address (Claude, or OpenCode with "API endpoint and key" only), default model and Concurrent runs follow the pick (OpenCode shows two radio cards, "Credentials file" and "API endpoint and key", with none picked; Continue works with an empty OpenCode credential, while Claude Code and Codex keep "Paste the token to continue."); Continue shows Saving agent, Saving credential, Testing connection on the button; Credential rejected or Can't reach address stays on the step with "Continue anyway"; any other result moves on to step 3. Coming back to the step shows the agent that was set up, with the provider fixed. Steps 3 to ready are boards: after step 2 their stepper and the rule's agent field name the agent you set up. The Scenario control on step 2 jumps to each state.
- Agents tab with one agent (Scenario "Agents: only one agent"): its "..." menu shows "Delete (a project needs at least one agent)", disabled. A project never reaches zero agents.
- Dialogs, toasts, busy states (about 0.7 s of fake latency), field errors, form banners, failure injection.

Faked or static:
- Runs, Run page, Desk (except the Workspace setup tab strip and its Environment tab, and Agent & settings), Setup and Needs-you are the boards drawn as static snapshots inside the live bar, with sample data for invoicer-api in every project. Their links navigate between boards, but their buttons mostly do nothing; a click on an unwired control shows the toast "Not wired in this prototype".
- The terminal, transcript and editors are pictures.
- There is no real GitHub, clipboard guarantee, email, or persistence. The clock is fixed at 22 Nov 2026, about 11:00.
- Filler members (12 invented names) and audit rows exist so paging has something to page.

## Coverage of every board

There are 527 boards in `design/prototype/project/` (322 before the navigation-consistency boards, plus 19 `*Shell` boards, 15 token usage boards, 117 side menu shell boards and 54 multi-agent boards: the agent tab strip, the add and edit pane, the Limits and GitHub connection tabs, the routing-rule agent picker and and the setup step 2 agent picker with its two extra boards). Every one is reproduced: each is reachable through the route in the table and also from the Scenario selector on its screen. "Live screen" means the default route is the working, stateful screen. "Board snapshot" means the route shows the board as drawn inside the live header and navigation. Where a board's states can be produced live, the last column says how. Routes assume `harbor-labs` and `invoicer-api`; the Screen map and the Scenario selector build them for the current org and project.

Three default routes depend on the role: CreateOrg (Platform admin; others see CreateOrgForbidden), MyInvitations (New user with invitations; others see the empty board) and InvitationAccept (New user with invitations; others see "not available"). Their other boards are reachable with `?s=`.

Boards not reproduced: none. Closest to not reproduced: `OrgInvitationsInviteTabSwitched` (a moment of switching tabs while a dialog is open) and `RouteLoading` (a skeleton) are static snapshots only.


## Gaps and choices

- Org slug: the boards use `harbor-labs`; some plans and boards' sample text mention `acme`. The prototype uses `harbor-labs` throughout.
- Navigation follows Option A of the approved proposal (see "Navigation"). The avatar-menu Settings proposal is dropped; the account menu has name, email and Logout. The boards had no account menu, so this menu itself is new.
- Navigation-consistency agent calls (not in the spec): the org settings crumb reads "Org settings" (the spec example says "Settings"); the page title of a project or run page uses the project as the scope ("Runs · invoicer-api · Agent Desk"); "Open organization" is a link with the external-link icon after "View audit log"; Create organization's Done opens the new org's platform page; the scope menu keeps the current org's Projects and Org settings between the Platform group and the org list; a platform admin with no membership lands on Platform > Organizations; the old Platform* boards keep their drawn side menu when shown as snapshots (the live screens and the *Shell boards show the new one).
- Agent calls in the bar (Option A), for the designer to review: (1) the Projects tab icon is a new four-square icon in the same stroke style as the others (Settings reuses the sliders icon of the side menu); (2) My invitations and the invitation-accept page show the org tabs with none active, so the way back is one click (Create organization shows no tabs, as the proposal says); (3) on the run page the project crumb is a project switcher, and "Runs" is the crumb that goes to the project (the proposal drew "invoicer-api" as the link); (4) the needs-you page shows no active tab; (5) a long org name is cut with an ellipsis in the bar (full name on hover and in the menu); (6) the run bar now has the bell too (navigation-consistency Decision 3).
- The needs-you explainer board still draws the old "In the app" panel (the board is not changed here). The proposal asks to redraw it with the count on the Projects tab.
- Member persona: Mira Chen is used for Member because the boards name her. Viewer is Theo Brandt, who exists in the member list.
- Platform admin: the platform role gives no org list and no org pages (navigation-consistency Decision 1). Morgan Avery (no membership) sees "Platform" in the scope switch, lands on Platform > Organizations, and every `/o/<org>` URL is "Not found" for them, as for any non-member. The orgs they create appear only in the platform directory.
- Project admin and "Org settings": the spec's role table says a project grant does not show Org settings, but its access table reuses the existing `canOpenSettings`, which counts the invite permission from a project grant (`canInvite` holds `assignment:create` anywhere). The prototype keeps today's behaviour (Lee Park, and Priya in Northwind, see Org settings with Invitations only).
- Project admin: invitations are limited to projects they administer (rows and the project picker). The spec does not say whether they can also invite to the whole organization; the prototype does not allow it.
- Run, Desk, Setup and Needs-you show sample invoicer-api data for every project, because the boards draw one project only. Project scope is still enforced: a project the role cannot see gives "Not found".
- Pages with no board for loading, empty, error or forbidden use generic placeholders built from the board markup (Not found, loading skeleton, "Internal server error" banner, "You don't have access"). They are not designed screens.
- Old boards still say "Invitations" as the Projects button; they are hidden by default (see Proposals to review), and the old `/o/<org>/invitations` URL redirects.
- OrgInvitations* boards (without Settings layout) are older drafts; they are kept as snapshots, and the live screen follows OrgInvitationsSettings.
- Name length limit is 100 characters, URL rules and the 20-per-page pager follow the boards; other limits (invite email format) are my reading of the boards.
- Last-owner and no-self-remove rules follow the spec as drawn: the last owner cannot step down or be removed (409 banner or toast); nobody removes themselves.
- A removed member who is the signed-in persona loses the org on the next screen change (redirects to "No organization").
- Clipboard: Copy link uses the browser clipboard; where the browser blocks it (some headless or insecure contexts) the "Could not copy" dialog appears, as in OrgInvitationsCopyFailed.
- The boards link no web font; the prototype does the same.
- Build step: `design/prototype/interactive/_tools/build-boards.mjs` (Node, no packages) regenerates `data/boards.js` and `board-styles.css` from the boards. Run it after changing a board: `node design/prototype/interactive/_tools/build-boards.mjs`. Do not edit the two generated files by hand.
- Environment tab (Desk > Workspace setup): the Scenario selector adds "Workspace setup states (live, clickable)": more than one page (23 variables, 22 secrets), both lists loading, no entries yet, variables or secrets failed to load, read-only role (`setup:read` only; no persona holds it, so it is a scenario), secrets read-only (no `secret:update`), and a setup test running (both tabs). The standard Loading, Empty and Error states map to both lists on the Environment tab and to the version-history boards on the Setup script tab. Each data set (seed, more than one page, empty) is kept per project in memory; invoicer-api starts with 3 variables and 2 secrets, every other project with none. Messages the spec leaves to the server (name exists, reserved, limit, size, invalid name) use the wording drawn on the DeskSetupEnvironment* boards, chosen for the prototype because the spec does not give it.
- **Keep the boards and this prototype in sync.** The boards in `design/prototype/project/` are the source and the contract (Storybook parity is checked against them); this prototype is generated from them. Whoever changes or adds a board re-runs the build step above, then `node design/prototype/interactive/_checks/nav-check.mjs`, and commits `data/boards.js` and `board-styles.css` with the board change. A screen that is new in the app also needs its live screen added under `screens/` and a row in the screen map. A board that changes the top bar changes `js/chrome.js` as well.
- The build step sorts each board's bar into `global` (org level), `project` (has the project switcher) or `run` (breadcrumb only). It does not use the tabs for this, because org pages have tabs too (Option A). The `*Shell` boards have a Breadcrumb on every bar, so they mark it: `<header class="top" data-bar="platform|org|project|run">`. On a run board the scope crumbs sit between `<!--scope-->` and `<!--/scope-->` so the live bar can replace them.

### Agent & settings (multi-agent)

Choices the multi-agent-configs spec leaves open (also listed in the planning reply), for the designer to review:
- The old one-page `DeskAgent` board stays untouched, so the new Agents tab default is the board `DeskAgentList`; `DeskAgent` and its variants (`DeskAgentAddressChanged`, `DeskAgentAutoResume*`, `DeskAgentCustomModel`, `DeskAgentProjectAdmin`) are listed as "Earlier boards" in the Scenario selector. `DeskRules*` and `Setup2` also stay; their new versions are `DeskRulesAgent*` and `Setup2DefaultAgent`, and Routing rules and setup step 2 open on the new ones.
- Provider logos are the providers' own marks, one colour (`currentColor`) inline in `screens/deskagent-view.js`, fetched on 24 Nov 2026. Official one-colour SVG: OpenCode (opencode.ai/brand), Google Antigravity (antigravity.google/press; kept only for its Coming-soon chip, the human confirms its mark or the chip shows a monogram), Cline (cline.bot/brand), Aider (the repo's icon, github.com/Aider-AI/aider). LobeHub icon set (MIT, lobehub.com/icons; marks stay the vendors' trademarks) for Claude Code, OpenAI Codex, Gemini CLI, GitHub Copilot CLI, Cursor, Amp, Goose, Qwen Code and Kiro, where the vendor offers no one-colour SVG. The human confirms source and usage terms before merge.
- OpenCode replaces Antigravity (human change after approval; UI design sections A and B, round 15). Choices of mine: there is no Model provider and no per-provider credential type; OpenCode works without signing in, so nothing is picked by default, the line "OpenCode works without signing in. Leave the credential empty to use it that way, or add one of these." shows under the control (also in the wizard), and the status for no credential is the neutral "No credential" (off tone) with the row subline "OpenCode . No sign-in". The sample OpenCode row is "OpenCode . API endpoint and key" as the spec says, as a text-only change on the 23 row boards: its model line (openai/gpt-5) and status (Not checkable) are the earlier ones, so on those boards the row is not a faithful endpoint agent; the board DeskAgentEditOpenCode draws a credentials-file agent instead. Picking "API endpoint and key" and leaving both fields empty saves with no credential and no model rule; typing one field without the other shows "Enter the API key for this endpoint." or "Enter the API endpoint for this key.". With an endpoint the model is typed or picked as a plain id (the list after saving shows three sample ids) and an empty one shows "Enter the model your endpoint serves.". The pane has no reveal button for any credential field (the wizard has one, labelled "Show credentials file" for the file). The Coming-soon chip reads "Antigravity" (the spec's chip list), not "Google Antigravity".
- Setup step 2 (human change after the spec): the picker follows the Add agent pane (logos, Coming soon chips); the section W copy is used as written. Choices of mine: the card text under the two credential types ("Uses your Claude subscription.", "The file Codex CLI writes when you sign in.", "Billed per token."); the line "This agent is set up. To add another one, use Agent & settings." when you come back to the step; the Back button; the wizard keeps the name, account label, max turns and the default checkbox out (edit them later on Agent & settings). The Concurrent runs field is kept. After step 2, steps 3 to ready are the earlier static boards: they carry the chosen agent only in the stepper detail and in Setup4's agent field. The Setup4 help line under the locked agent field now reads "Runs use the project default agent." (the old "One agent per project in the PoC." no longer holds). The rule sentence on Setup4 still reads "with agent Claude". The Main index link "2. Agent" now opens Setup2DefaultAgent, not the earlier Setup2. Not drawn as boards (live states only): Claude picked, OpenCode picked, saving, field errors, nothing chosen, coming back.
- Agents tab, the project's only agent: no board shows it. The disabled menu item "Delete (a project needs at least one agent)" is in the shared menu markup and shows in the live prototype (Scenario "Agents: only one agent", or delete the others).
- Layout: on the new boards and the live screen every column and pane scrolls inside itself (list, pane body, tab panel, rules list, rule pane) while its header and footer stay in place (list heading, pager, pane title and Save/Cancel row, Limits Save). Every new board is one 1440 x 900 screen; the live screen is exactly as tall as the window and the page never scrolls. A scroll area keeps its position across re-renders. The collapsed Prototype controls panel is now a small pill at the bottom left, under the side navigation, so it never covers a footer (Save, Continue, the pager); toasts sit just above it.
- Wording the spec does not give: the empty list text, the load error text, the fixed message under each test result, the delete refusal titles and details, "Fixed after creation" on the read-only provider, the GitHub tab copy outside the polling states (taken from the existing Storybook copy), the Max turns field shown on Edit only (Claude Code only).
- Run boards, the Projects list and the old Routing rules boards still link to the one-page `DeskAgent` board; in the prototype those links open the Agents tab, not the GitHub connection or Limits tab the spec asks for. Only the new boards link to the right tab.
- The Danger zone tab has no board (the spec does not draw it); its button shows the prototype's "Not wired" toast.
- `canvas.json` is untouched, so the new boards are not on the canvas yet.

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | Entry; loads the CSS and scripts in order |
| `board-styles.css` | Union of the boards' shared CSS (generated) |
| `styles.css` | Prototype-only styles: sticky bar, name truncation in the bar, menus, toasts, controls panel, screen map (tokens only) |
| `data/boards.js` | The 527 boards' markup (generated) |
| `js/core.js` | Fake data, roles, permission rules, fake API |
| `js/router.js` | Hash router |
| `js/boards.js` | Board lookup, board-to-route mapping, generic states |
| `js/chrome.js` | The top bar (org and project crumbs, tabs, run bar), account, org and project menus, dialogs, toasts, pager |
| `js/controls.js` | Prototype controls panel and screen map |
| `js/main.js` | Render pipeline, click and input handlers |
| `screens/sidenav.js` | The side menu shell (`#/side/...`): new top bar, side menus, drawer, wizard frame, phone layouts and the new boards. Loads after `js/main.js` |
| `screens/*.js` | Settings, invitations, projects, sign-in and invitation screens, board-backed screens; `screens/platform.js` is the platform admin area and the suspended-org page; `screens/desksetup.js` is the live Desk > Workspace setup (tab strip and Environment tab); `screens/deskagent-view.js` is the markup of Desk > Agent & settings (one source for the live screen and for the DeskAgent* boards) and `screens/deskagent.js` the live screen, the routing-rule agent picker and the setup step 2 copy swap |
| `_checks/` | Screenshots from the headless Chrome run (not needed to use the prototype). `_checks/nav-check.mjs` re-runs the navigation checks (Option A and the one shell: dual-role flow, crumbs, titles, landmarks, skip link, loading/error/not found, and that every `*Shell` board is reachable) and writes `_checks/nav/*.png`; it needs playwright-core and a headless Chromium (read-only use of the repo's `node_modules`). |

## Coverage table

"Live header and navigation" now means the one scope-aware shell. The navigation-consistency update moved Create organization to `#/platform/orgs/new` (the rows below say so) and added the 19 `*Shell` boards (rows marked "new").

| Board | Route (after sign-in as the Org owner) | How shown | How to reach it / note |
| --- | --- | --- | --- |
| `CreateOrg` | `#/platform/orgs/new` | Snapshot (the default route shows CreateOrgForbidden for Org owner; see note) | Live: persona Platform admin > scope switch > Create organization, or Platform > Organizations > Create organization (as another role: CreateOrgForbidden) |
| `CreateOrgCreated` | `#/platform/orgs/new?s=CreateOrgCreated` | Board snapshot, live header and navigation | Live: submit the form |
| `CreateOrgError` | `#/platform/orgs/new?s=CreateOrgError` | Board snapshot, live header and navigation | Board snapshot (static) |
| `CreateOrgFieldErrors` | `#/platform/orgs/new?s=CreateOrgFieldErrors` | Board snapshot, live header and navigation | Live: submit an empty form |
| `CreateOrgForbidden` | `#/platform/orgs/new?s=CreateOrgForbidden` | Board snapshot, live header and navigation | Live: open #/platform/orgs/new (or the old #/orgs/new) as any non-platform role |
| `CreateOrgInvitationFailed` | `#/platform/orgs/new?s=CreateOrgInvitationFailed` | Board snapshot, live header and navigation | Live: Fail next = Conflict, then submit |
| `CreateOrgPlatformShell` | `#/platform/orgs/new?s=CreateOrgPlatformShell` | Board snapshot, live header and navigation (new) | Live: Priya or Morgan > scope switch > Create organization |
| `CreateOrgRetrying` | `#/platform/orgs/new?s=CreateOrgRetrying` | Board snapshot, live header and navigation | Live: Retry on the invitation-failed view |
| `CreateOrgSaving` | `#/platform/orgs/new?s=CreateOrgSaving` | Board snapshot, live header and navigation | Live: submit (0.7 s) |
| `CreateOrgSlugAuto` | `#/platform/orgs/new?s=CreateOrgSlugAuto` | Board snapshot, live header and navigation | Live: type a name; the URL fills in |
| `CreateOrgSlugEdited` | `#/platform/orgs/new?s=CreateOrgSlugEdited` | Board snapshot, live header and navigation | Live: edit the URL |
| `CreateOrgSlugTaken` | `#/platform/orgs/new?s=CreateOrgSlugTaken` | Board snapshot, live header and navigation | Live: use northwind as URL |
| `DeskAgent` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgent` | Board snapshot, live header and navigation | Earlier one-page board, before the tab strip (static); the default route now shows the live Agents tab |
| `DeskAgentAdd` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentAdd` | Board snapshot, live header and navigation (new) | Live: Add agent |
| `DeskAgentAddOpenCode` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentAddOpenCode` | Board snapshot, live header and navigation (new; renamed from DeskAgentAddAntigravity) | Live: Add agent > pick OpenCode (nothing picked, works without signing in; pick "API endpoint and key" for the endpoint, key and a required model, or "Credentials file" for the pasted file) |
| `DeskAgentAddCodex` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentAddCodex` | Board snapshot, live header and navigation (new) | Live: Add agent > pick OpenAI Codex (sign-in file or API key, no address) |
| `DeskAgentAddFieldErrors` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentAddFieldErrors` | Board snapshot, live header and navigation (new) | Live: Save agent with a name already used, or Other model... left empty |
| `DeskAgentAddForm` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentAddForm` | Board snapshot, live header and navigation (new) | Live: Add agent > pick Claude Code |
| `DeskAgentAddPartial` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentAddPartial` | Board snapshot, live header and navigation (new) | Live: Fail next = Server error, then Save agent with a credential |
| `DeskAgentAddSaving` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentAddSaving` | Board snapshot, live header and navigation (new) | Live: Save agent (the footer shows each step) |
| `DeskAgentAddressChanged` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentAddressChanged` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskAgentAutoResume` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentAutoResume` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskAgentAutoResumeChanged` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentAutoResumeChanged` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskAgentAutoResumeError` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentAutoResumeError` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskAgentCustomModel` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentCustomModel` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskAgentDefaultChanged` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentDefaultChanged` | Board snapshot, live header and navigation (new) | Live: row menu > Set as default |
| `DeskAgentDelete` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentDelete` | Board snapshot, live header and navigation (new) | Live: row menu > Delete |
| `DeskAgentDeleteBlocked` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentDeleteBlocked` | Board snapshot, live header and navigation (new) | Live: Delete Claude - Work (the /code-review rule names it) |
| `DeskAgentDeleteBlockedRuns` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentDeleteBlockedRuns` | Board snapshot, live header and navigation (new) | Live: Delete Claude - Legacy key (run 58 is paused) |
| `DeskAgentDeleteError` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentDeleteError` | Board snapshot, live header and navigation (new) | Live: Fail next = Server error, then Delete agent |
| `DeskAgentDeleting` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentDeleting` | Board snapshot, live header and navigation (new) | Live: Delete agent (0.7 s) |
| `DeskAgentEdit` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentEdit` | Board snapshot, live header and navigation (new) | Live: Edit on the default agent |
| `DeskAgentEditAddressChanged` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentEditAddressChanged` | Board snapshot, live header and navigation (new) | Live: Edit > change the API address |
| `DeskAgentEditCodex` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentEditCodex` | Board snapshot, live header and navigation (new) | Live: Edit on the Codex agent |
| `DeskAgentEditOpenCode` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentEditOpenCode` | Board snapshot, live header and navigation (new) | Live: Edit on the OpenCode agent > Replace > pick the other choice (Credential needed again; the endpoint field is inside the Replace panel next to the key). The board draws an agent that holds a credentials file; the live sample agent holds an endpoint and key |
| `DeskAgentEditGone` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentEditGone` | Board snapshot, live header and navigation (new) | Live: Fail next = Not found, then Save agent or Test connection |
| `DeskAgentEditModelFallback` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentEditModelFallback` | Board snapshot, live header and navigation (new) | Static board (the model list could not load, a typed model) |
| `DeskAgentEditModelLoading` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentEditModelLoading` | Board snapshot, live header and navigation (new) | Static board (the model list loading) |
| `DeskAgentEditNoCredential` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentEditNoCredential` | Board snapshot, live header and navigation (new) | Live: Edit on Claude - Staging |
| `DeskAgentEditReplace` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentEditReplace` | Board snapshot, live header and navigation (new) | Live: Edit > Replace |
| `DeskAgentEditSaving` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentEditSaving` | Board snapshot, live header and navigation (new) | Live: Edit > Save agent (0.7 s) |
| `DeskAgentEditWork` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentEditWork` | Board snapshot, live header and navigation (new) | Live: Edit on a second Claude agent |
| `DeskAgentGitHub` | `#/o/harbor-labs/p/invoicer-api/desk/agent?tab=github` | Live screen (new) | Live: GitHub connection tab |
| `DeskAgentGitHubCheckRefused` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentGitHubCheckRefused` | Board snapshot, live header and navigation (new) | Live: Polling, Fail next = any, then Check now |
| `DeskAgentGitHubCheckingNow` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentGitHubCheckingNow` | Board snapshot, live header and navigation (new) | Live: Polling > Check now (0.8 s) |
| `DeskAgentGitHubError` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentGitHubError` | Board snapshot, live header and navigation (new) | Live: Scenario Error on the GitHub connection tab |
| `DeskAgentGitHubLoading` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentGitHubLoading` | Board snapshot, live header and navigation (new) | Live: Scenario Loading on the GitHub connection tab |
| `DeskAgentGitHubPolling` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentGitHubPolling` | Board snapshot, live header and navigation (new) | Live: Trigger mode > Polling |
| `DeskAgentGitHubTriggerError` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentGitHubTriggerError` | Board snapshot, live header and navigation (new) | Live: Fail next = Server error, then change the trigger mode |
| `DeskAgentLimits` | `#/o/harbor-labs/p/invoicer-api/desk/agent?tab=limits` | Live screen (new) | Live: Limits tab |
| `DeskAgentLimitsError` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentLimitsError` | Board snapshot, live header and navigation (new) | Live: Fail next = Server error, then Save limits |
| `DeskAgentLimitsFieldErrors` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentLimitsFieldErrors` | Board snapshot, live header and navigation (new) | Live: type 12 in Automatic resumes, Save limits |
| `DeskAgentLimitsReadOnly` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentLimitsReadOnly` | Board snapshot, live header and navigation (new) | Live: Scenario "Read-only role", Limits tab |
| `DeskAgentLimitsSaving` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentLimitsSaving` | Board snapshot, live header and navigation (new) | Live: Save limits (0.65 s) |
| `DeskAgentList` | `#/o/harbor-labs/p/invoicer-api/desk/agent` | Live screen (new) | Live: the default view of Agent & settings (the Agents tab) |
| `DeskAgentListEmpty` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentListEmpty` | Board snapshot, live header and navigation (new) | Live: Scenario Empty |
| `DeskAgentListError` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentListError` | Board snapshot, live header and navigation (new) | Live: Scenario Error (with retry); the other tabs still load |
| `DeskAgentListLoading` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentListLoading` | Board snapshot, live header and navigation (new) | Live: Scenario Loading on the Agents tab |
| `DeskAgentListPaged` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentListPaged` | Board snapshot, live header and navigation (new) | Live: persona any admin, Scenario "Agents: more than one page" |
| `DeskAgentListProjectAdmin` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentListProjectAdmin` | Board snapshot, live header and navigation (new) | Live: Project admin persona (three tabs, no Danger zone) |
| `DeskAgentListReadOnly` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentListReadOnly` | Board snapshot, live header and navigation (new) | Live: Scenario "Read-only role", open a row (View) |
| `DeskAgentListTesting` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentListTesting` | Board snapshot, live header and navigation (new) | Live: row menu > Test connection (0.9 s) |
| `DeskAgentProjectAdmin` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentProjectAdmin` | Board snapshot, live header and navigation | Earlier one-page board (static); the live version is the Project admin persona on the tab strip |
| `DeskAgentRowMenu` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentRowMenu` | Board snapshot, live header and navigation (new) | Live: the "..." button of a row |
| `DeskAgentTestFailed` | `#/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentTestFailed` | Board snapshot, live header and navigation (new) | Live: Edit on Claude - Legacy key, or Replace with a credential that contains "reject" |
| `DeskAudit` | `#/o/harbor-labs/p/invoicer-api/desk/audit` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskAuditEmpty` | `#/o/harbor-labs/p/invoicer-api/desk/audit?s=DeskAuditEmpty` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskAuditError` | `#/o/harbor-labs/p/invoicer-api/desk/audit?s=DeskAuditError` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskAuditInvitationExpired` | `#/o/harbor-labs/p/invoicer-api/desk/audit?s=DeskAuditInvitationExpired` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskAuditInvitationNoEmail` | `#/o/harbor-labs/p/invoicer-api/desk/audit?s=DeskAuditInvitationNoEmail` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskAuditLoading` | `#/o/harbor-labs/p/invoicer-api/desk/audit?s=DeskAuditLoading` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskAuditPaged` | `#/o/harbor-labs/p/invoicer-api/desk/audit?s=DeskAuditPaged` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembers` | `#/o/harbor-labs/p/invoicer-api/desk/members` | Board snapshot, live header and navigation | Static board (not stateful in this prototype); member or viewer persona: DeskMembersForbidden |
| `DeskMembersAdd` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersAdd` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersAddAllAdded` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersAddAllAdded` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersAddAlreadyOnProject` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersAddAlreadyOnProject` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersAddFieldErrors` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersAddFieldErrors` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersAddFormError` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersAddFormError` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersAddNoMatch` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersAddNoMatch` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersAddSaving` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersAddSaving` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersAddSearch` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersAddSearch` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersAdded` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersAdded` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersBusy` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersBusy` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersChangeRole` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersChangeRole` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersChangeRoleError` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersChangeRoleError` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersChangeRoleSaving` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersChangeRoleSaving` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersEmpty` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersEmpty` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersError` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersError` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersForbidden` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersForbidden` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersGone` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersGone` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersInvite` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersInvite` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersInviteCreated` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersInviteCreated` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersLoading` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersLoading` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersPaged` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersPaged` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersRemoveConfirm` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersRemoveConfirm` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersRemoved` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersRemoved` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersRemoving` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersRemoving` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersRoleChanged` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersRoleChanged` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskMembersRowMenu` | `#/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersRowMenu` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskRules` | `#/o/harbor-labs/p/invoicer-api/desk/rules?s=DeskRules` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskRulesAgent` | `#/o/harbor-labs/p/invoicer-api/desk/rules?s=DeskRulesAgent` | Board snapshot, live header and navigation (new) | Live: click the /triage rule; the With agent picker resets Model |
| `DeskRulesAgentGone` | `#/o/harbor-labs/p/invoicer-api/desk/rules?s=DeskRulesAgentGone` | Board snapshot, live header and navigation (new) | Static board (the agent of the rule was deleted: shown as unavailable) |
| `DeskRulesAgentLoading` | `#/o/harbor-labs/p/invoicer-api/desk/rules?s=DeskRulesAgentLoading` | Board snapshot, live header and navigation (new) | Static board (agent list loading: the select shows the current agent, disabled) |
| `DeskRulesAgentLocked` | `#/o/harbor-labs/p/invoicer-api/desk/rules?s=DeskRulesAgentLocked` | Board snapshot, live header and navigation (new) | Static board (no permission to list agents: locked select) |
| `DeskRulesAgentWarning` | `#/o/harbor-labs/p/invoicer-api/desk/rules` | Live screen (new) | Live: the default view of Routing rules; click the /triage rule |
| `DeskRulesEmpty` | `#/o/harbor-labs/p/invoicer-api/desk/rules?s=DeskRulesEmpty` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskRulesPaged` | `#/o/harbor-labs/p/invoicer-api/desk/rules?s=DeskRulesPaged` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskRulesPrompt` | `#/o/harbor-labs/p/invoicer-api/desk/rules?s=DeskRulesPrompt` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskRulesPromptError` | `#/o/harbor-labs/p/invoicer-api/desk/rules?s=DeskRulesPromptError` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskRulesPromptNew` | `#/o/harbor-labs/p/invoicer-api/desk/rules?s=DeskRulesPromptNew` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskSetup` | `#/o/harbor-labs/p/invoicer-api/desk/setup` | Live screen (the board with a live tab strip) | Default route; the tab strip switches to `?tab=environment` |
| `DeskSetupEnvironment` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupEnvironment` | Board snapshot, live header and navigation | Live: `desk/setup?tab=environment`, or the Environment tab |
| `DeskSetupEnvironmentAddSecret` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupEnvironmentAddSecret` | Board snapshot, live header and navigation | Live: Add secret |
| `DeskSetupEnvironmentAdded` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupEnvironmentAdded` | Board snapshot, live header and navigation | Live: scenario "more than one page", Next on variables, then add AWS_REGION |
| `DeskSetupEnvironmentAdding` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupEnvironmentAdding` | Board snapshot, live header and navigation | Live: Add variable |
| `DeskSetupEnvironmentEditing` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupEnvironmentEditing` | Board snapshot, live header and navigation | Live: Edit on a variable |
| `DeskSetupEnvironmentEmpty` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupEnvironmentEmpty` | Board snapshot, live header and navigation | Live: scenario Empty or "no entries yet", or any project but invoicer-api |
| `DeskSetupEnvironmentError` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupEnvironmentError` | Board snapshot, live header and navigation | Live: scenario "variables failed to load" (also "secrets failed to load", Error for both) |
| `DeskSetupEnvironmentFieldErrors` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupEnvironmentFieldErrors` | Board snapshot, live header and navigation | Live: Add secret with name GITHUB_TOKEN and a value under 6 characters |
| `DeskSetupEnvironmentGone` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupEnvironmentGone` | Board snapshot, live header and navigation | Live: Fail next = 404, then Save an edit or Replace (or confirm a Remove) |
| `DeskSetupEnvironmentLimit` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupEnvironmentLimit` | Board snapshot, live header and navigation | Live: Fail next = 409, then add |
| `DeskSetupEnvironmentLoading` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupEnvironmentLoading` | Board snapshot, live header and navigation | Live: scenario Loading or "both lists loading" |
| `DeskSetupEnvironmentNameTaken` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupEnvironmentNameTaken` | Board snapshot, live header and navigation | Live: Add variable named DB_HOST (or NPM_TOKEN) |
| `DeskSetupEnvironmentPaged` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupEnvironmentPaged` | Board snapshot, live header and navigation | Live: scenario "more than one page", Next on each list |
| `DeskSetupEnvironmentReadOnly` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupEnvironmentReadOnly` | Board snapshot, live header and navigation | Live: scenario "read-only role" |
| `DeskSetupEnvironmentRemove` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupEnvironmentRemove` | Board snapshot, live header and navigation | Live: Remove on a row |
| `DeskSetupEnvironmentSaveError` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupEnvironmentSaveError` | Board snapshot, live header and navigation | Live: Fail next = 500, then Add secret |
| `DeskSetupEnvironmentSaving` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupEnvironmentSaving` | Board snapshot, live header and navigation | Live: Save an edit (about 0.6 s) |
| `DeskSetupEnvironmentSecretReplace` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupEnvironmentSecretReplace` | Board snapshot, live header and navigation | Live: Replace on a secret |
| `DeskSetupEnvironmentSecretsReadOnly` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupEnvironmentSecretsReadOnly` | Board snapshot, live header and navigation | Live: scenario "secrets read-only" |
| `DeskSetupEnvironmentTesting` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupEnvironmentTesting` | Board snapshot, live header and navigation | Live: scenario "A setup test is running", Environment tab |
| `DeskSetupPaged` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupPaged` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskSetupTest` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupTest` | Board snapshot, live header and navigation | Live: scenario "A setup test is running", Setup script tab (board with the live tab strip) |
| `DeskSetupVersionsEmpty` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupVersionsEmpty` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskSetupVersionsError` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupVersionsError` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskSetupVersionsLoading` | `#/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupVersionsLoading` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskSkillDelete` | `#/o/harbor-labs/p/invoicer-api/desk/skills?s=DeskSkillDelete` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskSkills` | `#/o/harbor-labs/p/invoicer-api/desk/skills` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskSkillsEmpty` | `#/o/harbor-labs/p/invoicer-api/desk/skills?s=DeskSkillsEmpty` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskSkillsPaged` | `#/o/harbor-labs/p/invoicer-api/desk/skills?s=DeskSkillsPaged` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `DeskSkillsShell` | `#/o/harbor-labs/p/invoicer-api/desk/skills?s=DeskSkillsShell` | Board snapshot, live header and navigation (new) | Live: any project > Project settings tab |
| `InvitationAccept` | `#/invitations/7f3c2a9e-41d8-4b6e-9c0a-2e5b8d1f6a43` | Snapshot (the default route shows InvitationAcceptNotAvailable for Org owner; see note) | Live: New user with invitations, open the sample link (from Screen map) |
| `InvitationAcceptAccepted` | `#/invitations/7f3c2a9e-41d8-4b6e-9c0a-2e5b8d1f6a43?s=InvitationAcceptAccepted` | Board snapshot, live header and navigation | Live: Accept on the link page |
| `InvitationAcceptAccepting` | `#/invitations/7f3c2a9e-41d8-4b6e-9c0a-2e5b8d1f6a43?s=InvitationAcceptAccepting` | Board snapshot, live header and navigation | Board snapshot (static) |
| `InvitationAcceptDeclineConfirm` | `#/invitations/7f3c2a9e-41d8-4b6e-9c0a-2e5b8d1f6a43?s=InvitationAcceptDeclineConfirm` | Board snapshot, live header and navigation | Live: Decline on the link page |
| `InvitationAcceptDeclined` | `#/invitations/7f3c2a9e-41d8-4b6e-9c0a-2e5b8d1f6a43?s=InvitationAcceptDeclined` | Board snapshot, live header and navigation | Live: confirm Decline |
| `InvitationAcceptDeclining` | `#/invitations/7f3c2a9e-41d8-4b6e-9c0a-2e5b8d1f6a43?s=InvitationAcceptDeclining` | Board snapshot, live header and navigation | Board snapshot (static) |
| `InvitationAcceptError` | `#/invitations/7f3c2a9e-41d8-4b6e-9c0a-2e5b8d1f6a43?s=InvitationAcceptError` | Board snapshot, live header and navigation | Board snapshot (static) |
| `InvitationAcceptExpired` | `#/invitations/7f3c2a9e-41d8-4b6e-9c0a-2e5b8d1f6a43?s=InvitationAcceptExpired` | Board snapshot, live header and navigation | Board snapshot (static) |
| `InvitationAcceptExpiredInviterDeleted` | `#/invitations/7f3c2a9e-41d8-4b6e-9c0a-2e5b8d1f6a43?s=InvitationAcceptExpiredInviterDeleted` | Board snapshot, live header and navigation | Board snapshot (static) |
| `InvitationAcceptLoading` | `#/invitations/7f3c2a9e-41d8-4b6e-9c0a-2e5b8d1f6a43?s=InvitationAcceptLoading` | Board snapshot, live header and navigation | Board snapshot (static) |
| `InvitationAcceptNotAvailable` | `#/invitations/7f3c2a9e-41d8-4b6e-9c0a-2e5b8d1f6a43?s=InvitationAcceptNotAvailable` | Board snapshot, live header and navigation | Live: open the sample link as anyone but the invitee |
| `InvitationAcceptRevoked` | `#/invitations/7f3c2a9e-41d8-4b6e-9c0a-2e5b8d1f6a43?s=InvitationAcceptRevoked` | Board snapshot, live header and navigation | Board snapshot (static) |
| `Main` | `#/index` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `MyInvitations` | `#/invitations` | Snapshot (the default route shows MyInvitationsEmpty for Org owner; see note) | Live: persona New user with invitations, Sign in |
| `MyInvitationsAccepting` | `#/invitations?s=MyInvitationsAccepting` | Board snapshot, live header and navigation | Live: Accept (0.7 s) |
| `MyInvitationsEmpty` | `#/invitations?s=MyInvitationsEmpty` | Board snapshot, live header and navigation | Live: persona Org owner, open #/invitations |
| `MyInvitationsEmptyPlatformAdmin` | `#/invitations?s=MyInvitationsEmptyPlatformAdmin` | Board snapshot, live header and navigation | Live: persona Platform admin, open #/invitations |
| `MyInvitationsEmptyPlatformAdminMenu` | `#/invitations?s=MyInvitationsEmptyPlatformAdminMenu` | Board snapshot, live header and navigation | Live: as Platform admin open #/invitations and the "No organization" menu |
| `MyInvitationsError` | `#/invitations?s=MyInvitationsError` | Board snapshot, live header and navigation | Board snapshot (static) |
| `MyInvitationsLoading` | `#/invitations?s=MyInvitationsLoading` | Board snapshot, live header and navigation | Board snapshot (static) |
| `NeedsYou` | `#/o/harbor-labs/needs-you` | Board snapshot, under the live org bar (new) | Static board (not stateful in this prototype) |
| `NeedsYouEmpty` | `#/o/harbor-labs/needs-you?s=NeedsYouEmpty` | Board snapshot, under the live org bar (new) | Static board (not stateful in this prototype) |
| `NeedsYouPaged` | `#/o/harbor-labs/needs-you?s=NeedsYouPaged` | Board snapshot, under the live org bar (new) | Static board (not stateful in this prototype) |
| `OrgAudit` | `#/o/harbor-labs/settings/audit` | Live screen | Live: Settings > Audit log |
| `OrgAuditEmpty` | `#/o/harbor-labs/settings/audit?s=OrgAuditEmpty` | Board snapshot, live header and navigation | Live: switch to Northwind (empty audit) |
| `OrgAuditError` | `#/o/harbor-labs/settings/audit?s=OrgAuditError` | Board snapshot, live header and navigation | Scenario selector: Error |
| `OrgAuditForbidden` | `#/o/harbor-labs/settings/audit?s=OrgAuditForbidden` | Board snapshot, live header and navigation | Live: sign in as Member/Viewer and open the URL |
| `OrgAuditInvitationNoEmail` | `#/o/harbor-labs/settings/audit?s=OrgAuditInvitationNoEmail` | Board snapshot, live header and navigation | Board snapshot (static): invitation sentences name the listed projects (rbac-project-admin-space spec); the live Audit log still draws the old sentences |
| `OrgAuditInvitationProjects` | `#/o/harbor-labs/settings/audit?s=OrgAuditInvitationProjects` | Board snapshot, live header and navigation | Board snapshot (static): invitation sentences name the listed projects (rbac-project-admin-space spec); the live Audit log still draws the old sentences |
| `OrgAuditLoading` | `#/o/harbor-labs/settings/audit?s=OrgAuditLoading` | Board snapshot, live header and navigation | Scenario selector: Loading |
| `OrgAuditPaged` | `#/o/harbor-labs/settings/audit?s=OrgAuditPaged` | Board snapshot, live header and navigation | Live: 25 entries, page size 20, page 2 |
| `OrgAuditPlatformEdit` | `#/o/harbor-labs/settings/audit?s=OrgAuditPlatformEdit` | Board snapshot, live header and navigation | Live: as Platform admin edit Harbor Labs, then Settings > Audit log as Org owner (at the new URL) |
| `OrgAuditPlatformSuspend` | `#/o/harbor-labs/settings/audit?s=OrgAuditPlatformSuspend` | Board snapshot, live header and navigation | Live: suspend and reactivate Harbor Labs as Platform admin, then Settings > Audit log as Org owner |
| `OrgGeneral` | `#/o/harbor-labs/settings/general` | Live screen | Live: Settings > General |
| `OrgGeneralFieldErrors` | `#/o/harbor-labs/settings/general?s=OrgGeneralFieldErrors` | Board snapshot, live header and navigation | Live: clear the name, enter a bad URL, Save |
| `OrgGeneralForbidden` | `#/o/harbor-labs/settings/general?s=OrgGeneralForbidden` | Board snapshot, live header and navigation | Live: sign in as Member/Viewer and open the URL; project admin gets it inside the Settings layout |
| `OrgGeneralFormError` | `#/o/harbor-labs/settings/general?s=OrgGeneralFormError` | Board snapshot, live header and navigation | Live: Fail next = Server error, then Save |
| `OrgGeneralNameTooLong` | `#/o/harbor-labs/settings/general?s=OrgGeneralNameTooLong` | Board snapshot, live header and navigation | Live: enter a name over 100 characters, Save |
| `OrgGeneralSaved` | `#/o/harbor-labs/settings/general?s=OrgGeneralSaved` | Board snapshot, live header and navigation | Live: change the name, Save (toast) |
| `OrgGeneralSaving` | `#/o/harbor-labs/settings/general?s=OrgGeneralSaving` | Board snapshot, live header and navigation | Live: Save (0.7 s Saving...) |
| `OrgGeneralSlugConfirm` | `#/o/harbor-labs/settings/general?s=OrgGeneralSlugConfirm` | Board snapshot, live header and navigation | Live: change the URL, Save |
| `OrgGeneralSlugTaken` | `#/o/harbor-labs/settings/general?s=OrgGeneralSlugTaken` | Board snapshot, live header and navigation | Live: enter northwind as URL, Save |
| `OrgInvitations` | `#/o/harbor-labs/settings/invitations?s=OrgInvitations` | Board snapshot, live header and navigation | Live: Invitations (older board, no Settings layout) |
| `OrgInvitationsAll` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsAll` | Board snapshot, live header and navigation | Live: filter chip All |
| `OrgInvitationsCopyFailed` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsCopyFailed` | Board snapshot, live header and navigation | Live: Fail next = Clipboard blocked, row menu > Copy link |
| `OrgInvitationsCreated` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsCreated` | Board snapshot, live header and navigation | Live: Invite people > Create invitation |
| `OrgInvitationsEmpty` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsEmpty` | Board snapshot, live header and navigation | Live: switch to Northwind (no invitations), or scenario Empty |
| `OrgInvitationsEmptyAll` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsEmptyAll` | Board snapshot, live header and navigation | Live: Northwind, filter All |
| `OrgInvitationsEmptyFiltered` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsEmptyFiltered` | Board snapshot, live header and navigation | Live: Northwind, filter chip Pending/Accepted/etc. |
| `OrgInvitationsError` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsError` | Board snapshot, live header and navigation | Scenario selector: Error |
| `OrgInvitationsFiltered` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsFiltered` | Board snapshot, live header and navigation | Live: any filter chip |
| `OrgInvitationsForbidden` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsForbidden` | Board snapshot, live header and navigation | Live: sign in as Member/Viewer and open the URL |
| `OrgInvitationsInvite` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsInvite` | Board snapshot, live header and navigation | Live: Invite people |
| `OrgInvitationsInviteFieldError` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsInviteFieldError` | Board snapshot, live header and navigation | Live: invite an email that already has a pending invitation |
| `OrgInvitationsInviteFormError` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsInviteFormError` | Board snapshot, live header and navigation | Live: Fail next = Server error, then Create invitation |
| `OrgInvitationsInviteProjectAdmin` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsInviteProjectAdmin` | Board snapshot, live header and navigation | Live: Project admin > Invite people |
| `OrgInvitationsInviteProjects` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsInviteProjects` | Board snapshot, live header and navigation | Live: Invite people > Some projects |
| `OrgInvitationsInviteSaving` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsInviteSaving` | Board snapshot, live header and navigation | Live: Create invitation (0.7 s) |
| `OrgInvitationsInviteTabSwitched` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsInviteTabSwitched` | Board snapshot, live header and navigation | Not reproduced live (tab-switch moment); snapshot only |
| `OrgInvitationsLinkCopied` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsLinkCopied` | Board snapshot, live header and navigation | Live: row menu > Copy link (where the browser allows the clipboard) |
| `OrgInvitationsLoading` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsLoading` | Board snapshot, live header and navigation | Scenario selector: Loading |
| `OrgInvitationsPaged` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsPaged` | Board snapshot, live header and navigation | Snapshot (the live list has fewer than 21 rows) |
| `OrgInvitationsRenewed` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsRenewed` | Board snapshot, live header and navigation | Live: row menu > Resend (toast) |
| `OrgInvitationsResendConflict` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsResendConflict` | Board snapshot, live header and navigation | Live: Fail next = Conflict, then Resend |
| `OrgInvitationsResending` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsResending` | Board snapshot, live header and navigation | Live: Resend (0.7 s) |
| `OrgInvitationsRevokeConfirm` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsRevokeConfirm` | Board snapshot, live header and navigation | Live: row menu > Revoke |
| `OrgInvitationsRevoked` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsRevoked` | Board snapshot, live header and navigation | Live: confirm Revoke (toast) |
| `OrgInvitationsRowMenu` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsRowMenu` | Board snapshot, live header and navigation | Live: row menu on a pending row |
| `OrgInvitationsRowMenuExpired` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsRowMenuExpired` | Board snapshot, live header and navigation | Live: row menu on an expired row (filter Expired) |
| `OrgInvitationsSettings` | `#/o/harbor-labs/settings/invitations` | Live screen | Live: Settings > Invitations |
| `OrgInvitationsSettingsProjectAdmin` | `#/o/harbor-labs/settings/invitations?s=OrgInvitationsSettingsProjectAdmin` | Board snapshot, live header and navigation | Live: sign in as Project admin |
| `OrgMembers` | `#/o/harbor-labs/settings/members` | Live screen | Live: Settings > Members (any owner/admin) |
| `OrgMembersAdmin` | `#/o/harbor-labs/settings/members?s=OrgMembersAdmin` | Board snapshot, live header and navigation | Live: sign in as Org admin; no actions on owner rows |
| `OrgMembersBusy` | `#/o/harbor-labs/settings/members?s=OrgMembersBusy` | Board snapshot, live header and navigation | Live for ~0.7 s while a role change or removal is saving (row dimmed) |
| `OrgMembersChangeAccessEmpty` | `#/o/harbor-labs/settings/members?s=OrgMembersChangeAccessEmpty` | Board snapshot, live header and navigation | Live: row menu > Change access on a member with no project grants |
| `OrgMembersChangeAccessMany` | `#/o/harbor-labs/settings/members?s=OrgMembersChangeAccessMany` | Board snapshot, live header and navigation | Board only: Change access for Fatima Zahra, eight project grants (Fatima is not in the live data) |
| `OrgMembersChangeRole` | `#/o/harbor-labs/settings/members?s=OrgMembersChangeRole` | Board snapshot, live header and navigation | Live: row menu > Change access |
| `OrgMembersChangeRoleAdmin` | `#/o/harbor-labs/settings/members?s=OrgMembersChangeRoleAdmin` | Board snapshot, live header and navigation | Live: as Org admin, Change access (no Owner card) |
| `OrgMembersChangeRoleError` | `#/o/harbor-labs/settings/members?s=OrgMembersChangeRoleError` | Board snapshot, live header and navigation | Live: Fail next = Server error, then Save access |
| `OrgMembersChangeRoleSaving` | `#/o/harbor-labs/settings/members?s=OrgMembersChangeRoleSaving` | Board snapshot, live header and navigation | Live: Save access (0.7 s Saving...) |
| `OrgMembersEmpty` | `#/o/harbor-labs/settings/members?s=OrgMembersEmpty` | Board snapshot, live header and navigation | Scenario selector: Empty (also a snapshot) |
| `OrgMembersError` | `#/o/harbor-labs/settings/members?s=OrgMembersError` | Board snapshot, live header and navigation | Scenario selector: Error |
| `OrgMembersForbidden` | `#/o/harbor-labs/settings/members?s=OrgMembersForbidden` | Board snapshot, live header and navigation | Live: sign in as Member or Viewer and open the URL; or scenario Forbidden |
| `OrgMembersGone` | `#/o/harbor-labs/settings/members?s=OrgMembersGone` | Board snapshot, live header and navigation | Live: Fail next = Not found, then Save access |
| `OrgMembersLastOwner` | `#/o/harbor-labs/settings/members?s=OrgMembersLastOwner` | Board snapshot, live header and navigation | Live: make the other owner a member, then step Kim Hale down; or Fail next = Conflict |
| `OrgMembersLoading` | `#/o/harbor-labs/settings/members?s=OrgMembersLoading` | Board snapshot, live header and navigation | Scenario selector: Loading |
| `OrgMembersMakeOwner` | `#/o/harbor-labs/settings/members?s=OrgMembersMakeOwner` | Board snapshot, live header and navigation | Live: Change access, pick the Owner card (owner only) |
| `OrgMembersManyGrants` | `#/o/harbor-labs/settings/members?s=OrgMembersManyGrants` | Board snapshot, live header and navigation | Board only: adds Fatima Zahra with eight project grants (chips wrap); the live list shows Alexandra, who has four |
| `OrgMembersPaged` | `#/o/harbor-labs/settings/members?s=OrgMembersPaged` | Board snapshot, live header and navigation | Live: 26 members, 20 per page, page 2 |
| `OrgMembersRemoveConfirm` | `#/o/harbor-labs/settings/members?s=OrgMembersRemoveConfirm` | Board snapshot, live header and navigation | Live: row menu > Remove from organization |
| `OrgMembersRemoveLastOwner` | `#/o/harbor-labs/settings/members?s=OrgMembersRemoveLastOwner` | Board snapshot, live header and navigation | Live: Fail next = Conflict, then Remove |
| `OrgMembersRemoved` | `#/o/harbor-labs/settings/members?s=OrgMembersRemoved` | Board snapshot, live header and navigation | Live: confirm Remove (toast, row gone, audit entry) |
| `OrgMembersRemoving` | `#/o/harbor-labs/settings/members?s=OrgMembersRemoving` | Board snapshot, live header and navigation | Live: confirm Remove (0.7 s Removing...) |
| `OrgMembersRoleChanged` | `#/o/harbor-labs/settings/members?s=OrgMembersRoleChanged` | Board snapshot, live header and navigation | Live: Save access (toast, audit entry) |
| `OrgMembersRowMenu` | `#/o/harbor-labs/settings/members?s=OrgMembersRowMenu` | Board snapshot, live header and navigation | Live: row menu on another member |
| `OrgMembersRowMenuSelf` | `#/o/harbor-labs/settings/members?s=OrgMembersRowMenuSelf` | Board snapshot, live header and navigation | Live: row menu on your own row |
| `OrgMembersShell` | `#/o/harbor-labs/settings/members?s=OrgMembersShell` | Board snapshot, live header and navigation (new) | Live: Org settings tab > Members |
| `OrgMembersStepDown` | `#/o/harbor-labs/settings/members?s=OrgMembersStepDown` | Board snapshot, live header and navigation | Live: as owner, Change access on your own row, pick a lower role |
| `OrgSuspended` | `#/o/harbor-labs/projects?s=OrgSuspended` | Board snapshot, live header and navigation | Live: as Platform admin suspend Harbor Labs, then switch persona to Org owner |
| `OrgSuspendedPlatformAdmin` | `#/o/harbor-labs/projects?s=OrgSuspendedPlatformAdmin` | Board snapshot, live header and navigation | Live: as Platform admin open #/o/harbor-labs/projects after suspending it, then the org switcher |
| `OrgSuspendedSwitcher` | `#/o/harbor-labs/projects?s=OrgSuspendedSwitcher` | Board snapshot, live header and navigation | Live: on the suspended page open the org switcher |
| `Pagination` | `#/gallery/pagination` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `PlatformAdmins` | `#/platform/admins` | Live screen (Platform admin) | Live: persona Platform admin, org menu > Platform admin > Platform admins |
| `PlatformAdminsAdd` | `#/platform/admins?s=PlatformAdminsAdd` | Board snapshot, live header and navigation | Live: Add platform admin |
| `PlatformAdminsAddError` | `#/platform/admins?s=PlatformAdminsAddError` | Board snapshot, live header and navigation | Live: Fail the next action with 500 or 403, then Add |
| `PlatformAdminsAddFieldErrors` | `#/platform/admins?s=PlatformAdminsAddFieldErrors` | Board snapshot, live header and navigation | Live: Add with jo.marsh@example.com (no account) or new.hire@agentdesk.example (not verified) |
| `PlatformAdminsAddSaving` | `#/platform/admins?s=PlatformAdminsAddSaving` | Board snapshot, live header and navigation | Live: Add with a known email, e.g. jordan.wu@harborlabs.dev (0.6 s) |
| `PlatformAdminsEmpty` | `#/platform/admins?s=PlatformAdminsEmpty` | Board snapshot, live header and navigation | Scenario Empty |
| `PlatformAdminsError` | `#/platform/admins?s=PlatformAdminsError` | Board snapshot, live header and navigation | Scenario Error (live banner with Retry) |
| `PlatformAdminsForbidden` | `#/platform/admins?s=PlatformAdminsForbidden` | Board snapshot, live header and navigation | Live: any other persona types #/platform/admins |
| `PlatformAdminsLastAdmin` | `#/platform/admins?s=PlatformAdminsLastAdmin` | Board snapshot, live header and navigation | Live: revoke Priya Natarajan; your own Revoke is then disabled with "Last admin" |
| `PlatformAdminsLoading` | `#/platform/admins?s=PlatformAdminsLoading` | Board snapshot, live header and navigation | Scenario Loading (live skeleton in the layout) |
| `PlatformAdminsPaged` | `#/platform/admins?s=PlatformAdminsPaged` | Board snapshot, live header and navigation | Board snapshot (static); live list has 3 admins |
| `PlatformAdminsRevokeConfirm` | `#/platform/admins?s=PlatformAdminsRevokeConfirm` | Board snapshot, live header and navigation | Live: Revoke on Priya Natarajan |
| `PlatformAdminsRevokeSelf` | `#/platform/admins?s=PlatformAdminsRevokeSelf` | Board snapshot, live header and navigation | Live: Revoke on your own row (needs another working admin; confirming goes to the home page) |
| `PlatformAdminsRevoking` | `#/platform/admins?s=PlatformAdminsRevoking` | Board snapshot, live header and navigation | Live: confirm Revoke (0.6 s) |
| `PlatformAdminsShell` | `#/platform/admins?s=PlatformAdminsShell` | Board snapshot, live header and navigation (new) | Live: Platform admins tab |
| `PlatformAudit` | `#/platform/audit` | Live screen (Platform admin) | Live: persona Platform admin, Platform admin > Audit log |
| `PlatformAuditEmpty` | `#/platform/audit?s=PlatformAuditEmpty` | Board snapshot, live header and navigation | Scenario Empty |
| `PlatformAuditEmptyFiltered` | `#/platform/audit?s=PlatformAuditEmptyFiltered` | Board snapshot, live header and navigation | Live: pick an action with no entries, e.g. after a reset none match "Invitation resent" for Bluefin Health |
| `PlatformAuditError` | `#/platform/audit?s=PlatformAuditError` | Board snapshot, live header and navigation | Scenario Error |
| `PlatformAuditLoading` | `#/platform/audit?s=PlatformAuditLoading` | Board snapshot, live header and navigation | Scenario Loading |
| `PlatformAuditOrgChip` | `#/platform/audit?s=PlatformAuditOrgChip` | Board snapshot, live header and navigation | Live: org detail > View audit log; the chip x removes the filter |
| `PlatformAuditOrgChipUnknown` | `#/platform/audit?s=PlatformAuditOrgChipUnknown` | Board snapshot, live header and navigation | Live: #/platform/audit?org=<unknown id> |
| `PlatformAuditPaged` | `#/platform/audit?s=PlatformAuditPaged` | Board snapshot, live header and navigation | Live: page 2 |
| `PlatformAuditShell` | `#/platform/audit?s=PlatformAuditShell` | Board snapshot, live header and navigation (new) | Live: Audit log tab |
| `PlatformOrgEdit` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10?s=PlatformOrgEdit` | Board snapshot, live header and navigation | Live: org detail > Edit organization (Save stays disabled until a value changes) |
| `PlatformOrgEditError` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10?s=PlatformOrgEditError` | Board snapshot, live header and navigation | Live: Fail the next action with 500 or 403, then Save (404 gives the "Organization not found" toast) |
| `PlatformOrgEditFieldErrors` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10?s=PlatformOrgEditFieldErrors` | Board snapshot, live header and navigation | Live: clear the Name or type -harbor- as URL, then Save |
| `PlatformOrgEditSaving` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10?s=PlatformOrgEditSaving` | Board snapshot, live header and navigation | Live: change the Name, Save (0.6 s) |
| `PlatformOrgEditSlugConfirm` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10?s=PlatformOrgEditSlugConfirm` | Board snapshot, live header and navigation | Live: change the URL, Save (Cancel returns to the dialog with the input kept) |
| `PlatformOrgEditSlugTaken` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10?s=PlatformOrgEditSlugTaken` | Board snapshot, live header and navigation | Live: URL northwind, Save, Change URL |
| `PlatformOrgInvitations` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/invitations` | Live screen (Platform admin) | Live: detail > Invitations (same actions as Settings > Invitations) |
| `PlatformOrgInvitationsCopyFailed` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/invitations?s=PlatformOrgInvitationsCopyFailed` | Board snapshot, live header and navigation | Live: Fail the next action with "Clipboard blocked", then row menu > Copy link |
| `PlatformOrgInvitationsEmpty` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/invitations?s=PlatformOrgInvitationsEmpty` | Board snapshot, live header and navigation | Scenario Empty, or Bluefin Health |
| `PlatformOrgInvitationsError` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/invitations?s=PlatformOrgInvitationsError` | Board snapshot, live header and navigation | Scenario Error |
| `PlatformOrgInvitationsInvite` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/invitations?s=PlatformOrgInvitationsInvite` | Board snapshot, live header and navigation | Live: Invite people (Owner is offered) |
| `PlatformOrgInvitationsLoading` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/invitations?s=PlatformOrgInvitationsLoading` | Board snapshot, live header and navigation | Scenario Loading |
| `PlatformOrgInvitationsPaged` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/invitations?s=PlatformOrgInvitationsPaged` | Board snapshot, live header and navigation | Board snapshot (static) |
| `PlatformOrgInvitationsResending` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/invitations?s=PlatformOrgInvitationsResending` | Board snapshot, live header and navigation | Live: row menu > Resend (0.7 s) |
| `PlatformOrgMembers` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/members` | Live screen (Platform admin) | Live: detail > Members |
| `PlatformOrgMembersAddAssignment` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/members?s=PlatformOrgMembersAddAssignment` | Board snapshot, live header and navigation | Live: row menu > Add assignment |
| `PlatformOrgMembersEmpty` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/members?s=PlatformOrgMembersEmpty` | Board snapshot, live header and navigation | Scenario Empty, or Acme Rockets |
| `PlatformOrgMembersError` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/members?s=PlatformOrgMembersError` | Board snapshot, live header and navigation | Scenario Error |
| `PlatformOrgMembersLoading` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/members?s=PlatformOrgMembersLoading` | Board snapshot, live header and navigation | Scenario Loading |
| `PlatformOrgMembersPaged` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/members?s=PlatformOrgMembersPaged` | Board snapshot, live header and navigation | Live: Harbor Labs page 2 |
| `PlatformOrgMembersRemoveConfirm` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/members?s=PlatformOrgMembersRemoveConfirm` | Board snapshot, live header and navigation | Live: row menu > Remove <assignment> |
| `PlatformOrgMembersRemoving` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/members?s=PlatformOrgMembersRemoving` | Board snapshot, live header and navigation | Live: confirm Remove (0.6 s); removing the last owner is allowed and the directory shows "No owner yet" |
| `PlatformOrgMembersRowMenu` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/members?s=PlatformOrgMembersRowMenu` | Board snapshot, live header and navigation | Live: a row menu |
| `PlatformOrgMembersShell` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/members?s=PlatformOrgMembersShell` | Board snapshot, live header and navigation (new) | Live: Priya > Organizations > Harbor Labs > Members ("Open organization" shown) |
| `PlatformOrgMembersShellError` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/members?s=PlatformOrgMembersShellError` | Board snapshot, live header and navigation (new) | Live: Scenario Error on a platform org page (crumb "Organization") |
| `PlatformOrgMembersShellLoading` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/members?s=PlatformOrgMembersShellLoading` | Board snapshot, live header and navigation (new) | Live: Scenario Loading on a platform org page (crumb skeleton, side menu placeholder) |
| `PlatformOrgMembersShellNonMember` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/members?s=PlatformOrgMembersShellNonMember` | Board snapshot, live header and navigation (new) | Live: Morgan (Platform admin) > Harbor Labs > Members (no "Open organization") |
| `PlatformOrgOverview` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10` | Live screen (Platform admin) | Live: directory > Harbor Labs |
| `PlatformOrgOverviewError` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10?s=PlatformOrgOverviewError` | Board snapshot, live header and navigation | Scenario Error |
| `PlatformOrgOverviewLoading` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10?s=PlatformOrgOverviewLoading` | Board snapshot, live header and navigation | Scenario Loading |
| `PlatformOrgOverviewNotFound` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10?s=PlatformOrgOverviewNotFound` | Board snapshot, live header and navigation | Live: #/platform/orgs/<unknown id> |
| `PlatformOrgOverviewReactivateDialog` | `#/platform/orgs/b47d9c62-1e5f-4a38-9d6b-2f8a4c7e1d93?s=PlatformOrgOverviewReactivateDialog` | Board snapshot, live header and navigation | Live: Reactivate organization on Bluefin Health |
| `PlatformOrgOverviewShell` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10?s=PlatformOrgOverviewShell` | Board snapshot, live header and navigation (new) | Live: Priya > scope switch > Manage this org in Platform |
| `PlatformOrgOverviewShellNotFound` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10?s=PlatformOrgOverviewShellNotFound` | Board snapshot, live header and navigation (new) | Live: #/platform/orgs/<unknown id> |
| `PlatformOrgOverviewSuspendDialog` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10?s=PlatformOrgOverviewSuspendDialog` | Board snapshot, live header and navigation | Live: Suspend organization |
| `PlatformOrgOverviewSuspendError` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10?s=PlatformOrgOverviewSuspendError` | Board snapshot, live header and navigation | Live: Suspend with an empty reason (or over 500 characters) |
| `PlatformOrgOverviewSuspendFormError` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10?s=PlatformOrgOverviewSuspendFormError` | Board snapshot, live header and navigation | Live: Fail the next action with 500 or 403, then Suspend (404 gives the "Organization not found" toast) |
| `PlatformOrgOverviewSuspendSaving` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10?s=PlatformOrgOverviewSuspendSaving` | Board snapshot, live header and navigation | Live: Suspend with a reason (0.6 s) |
| `PlatformOrgOverviewSuspended` | `#/platform/orgs/b47d9c62-1e5f-4a38-9d6b-2f8a4c7e1d93?s=PlatformOrgOverviewSuspended` | Board snapshot, live header and navigation | Live: directory > Bluefin Health, or suspend any org |
| `PlatformOrgProjects` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/projects` | Live screen (Platform admin) | Live: detail > Projects |
| `PlatformOrgProjectsEmpty` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/projects?s=PlatformOrgProjectsEmpty` | Board snapshot, live header and navigation | Scenario Empty, or Acme Rockets |
| `PlatformOrgProjectsError` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/projects?s=PlatformOrgProjectsError` | Board snapshot, live header and navigation | Scenario Error |
| `PlatformOrgProjectsLoading` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/projects?s=PlatformOrgProjectsLoading` | Board snapshot, live header and navigation | Scenario Loading |
| `PlatformOrgProjectsPaged` | `#/platform/orgs/0f6d2a91-3c4b-4e8a-9b1d-7a2c5e8f4b10/projects?s=PlatformOrgProjectsPaged` | Board snapshot, live header and navigation | Board snapshot (static) |
| `PlatformOrgs` | `#/platform/orgs` | Live screen (Platform admin) | Live: persona Platform admin, org menu > Platform admin |
| `PlatformOrgsEmpty` | `#/platform/orgs?s=PlatformOrgsEmpty` | Board snapshot, live header and navigation | Scenario Empty |
| `PlatformOrgsEmptyFiltered` | `#/platform/orgs?s=PlatformOrgsEmptyFiltered` | Board snapshot, live header and navigation | Live: search for a name that matches nothing; Clear filters |
| `PlatformOrgsError` | `#/platform/orgs?s=PlatformOrgsError` | Board snapshot, live header and navigation | Scenario Error |
| `PlatformOrgsLoading` | `#/platform/orgs?s=PlatformOrgsLoading` | Board snapshot, live header and navigation | Scenario Loading |
| `PlatformOrgsPaged` | `#/platform/orgs?s=PlatformOrgsPaged` | Board snapshot, live header and navigation | Board snapshot (static); live directory has 5 orgs plus the ones you create |
| `PlatformOrgsShell` | `#/platform/orgs?s=PlatformOrgsShell` | Board snapshot, live header and navigation (new) | Live: scope switch > Platform admin |
| `PlatformOrgsShellScopeMenu` | `#/platform/orgs?s=PlatformOrgsShellScopeMenu` | Board snapshot, live header and navigation (new) | Live: Morgan, open the "Platform" scope switch |
| `Projects` | `#/o/harbor-labs/projects` | Live screen | Live: Projects |
| `ProjectsChecklist` | `#/o/harbor-labs/projects?s=ProjectsChecklist` | Board snapshot, live header and navigation | Live: Northwind as Kim Hale (the drawn Settings or Invitations head button is hidden unless the proposal toggle is on) |
| `ProjectsChecklistDone` | `#/o/harbor-labs/projects?s=ProjectsChecklistDone` | Board snapshot, live header and navigation | Board snapshot (static) (the drawn Settings or Invitations head button is hidden unless the proposal toggle is on) |
| `ProjectsChecklistDoneSettings` | `#/o/harbor-labs/projects?s=ProjectsChecklistDoneSettings` | Board snapshot, live header and navigation | Board snapshot (static) (the drawn Settings or Invitations head button is hidden unless the proposal toggle is on) |
| `ProjectsChecklistError` | `#/o/harbor-labs/projects?s=ProjectsChecklistError` | Board snapshot, live header and navigation | Board snapshot (static) |
| `ProjectsChecklistLoading` | `#/o/harbor-labs/projects?s=ProjectsChecklistLoading` | Board snapshot, live header and navigation | Board snapshot (static) |
| `ProjectsEmpty` | `#/o/harbor-labs/projects?s=ProjectsEmpty` | Board snapshot, live header and navigation | Live: sign in as Platform admin, switch to a new org, or scenario Empty |
| `ProjectsEmptyChecklist` | `#/o/harbor-labs/projects?s=ProjectsEmptyChecklist` | Board snapshot, live header and navigation | Board snapshot (static) |
| `ProjectsEmptyChecklistSettings` | `#/o/harbor-labs/projects?s=ProjectsEmptyChecklistSettings` | Board snapshot, live header and navigation | Board snapshot (static) (the drawn Settings or Invitations head button is hidden unless the proposal toggle is on) |
| `ProjectsEmptyNoCreate` | `#/o/harbor-labs/projects?s=ProjectsEmptyNoCreate` | Board snapshot, live header and navigation | Live: Riverside as Kim Hale (member) |
| `ProjectsMember` | `#/o/harbor-labs/projects?s=ProjectsMember` | Board snapshot, live header and navigation | Live: sign in as Member |
| `ProjectsNoAccess` | `#/o/harbor-labs/projects?s=ProjectsNoAccess` | Board snapshot, live header and navigation | Live: Mira Chen in Northwind (no role) |
| `ProjectsOrgSwitchAdmin` | `#/o/harbor-labs/projects?s=ProjectsOrgSwitchAdmin` | Board snapshot, live header and navigation | Live: org switcher as Platform admin (the drawn Settings or Invitations head button is hidden unless the proposal toggle is on) |
| `ProjectsOrgSwitchAdminPlatform` | `#/o/harbor-labs/projects?s=ProjectsOrgSwitchAdminPlatform` | Board snapshot, live header and navigation | Live: org switcher as Platform admin |
| `ProjectsOrgSwitchOpen` | `#/o/harbor-labs/projects?s=ProjectsOrgSwitchOpen` | Board snapshot, live header and navigation | Live: open the org switcher (the drawn Settings or Invitations head button is hidden unless the proposal toggle is on) |
| `ProjectsPaged` | `#/o/harbor-labs/projects?s=ProjectsPaged` | Board snapshot, live header and navigation | Board snapshot (static) |
| `ProjectsShell` | `#/o/harbor-labs/projects?s=ProjectsShell` | Board snapshot, live header and navigation (new) | Live: Priya signs in |
| `ProjectsShellScopeMenu` | `#/o/harbor-labs/projects?s=ProjectsShellScopeMenu` | Board snapshot, live header and navigation (new) | Live: Priya, open the "Harbor Labs" scope switch |
| `ProjectsShellScopeMenuPlatformError` | `#/o/harbor-labs/projects?s=ProjectsShellScopeMenuPlatformError` | Board snapshot, live header and navigation (new) | Board snapshot; the live scope menu on this scenario also hides the Platform group |
| `ProjectsShellSkipLink` | `#/o/harbor-labs/projects?s=ProjectsShellSkipLink` | Board snapshot, live header and navigation (new) | Live: press Tab once on any page |
| `ProjectsSwitching` | `#/o/harbor-labs/projects?s=ProjectsSwitching` | Board snapshot, live header and navigation | Live: choose another org (0.7 s) |
| `RouteError` | `#/gallery/pagination?s=RouteError` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RouteLoading` | `#/gallery/pagination?s=RouteLoading` | Board snapshot, live header and navigation | Static board: a loading skeleton with no text; select it in the Scenario selector |
| `RunCancelled` | `#/o/harbor-labs/p/invoicer-api/runs/52` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunFailed` | `#/o/harbor-labs/p/invoicer-api/runs/56` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunIdle` | `#/o/harbor-labs/p/invoicer-api/runs/62` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunIdleEnding` | `#/o/harbor-labs/p/invoicer-api/runs/62?s=RunIdleEnding` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunIdleShell` | `#/o/harbor-labs/p/invoicer-api/runs/62?s=RunIdleShell` | Board snapshot, live header and navigation (new) | Live: open Run 62 (bell on the run bar) |
| `RunPrompt` | `#/o/harbor-labs/p/invoicer-api/runs/60?s=RunPrompt` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunReconnect` | `#/o/harbor-labs/p/invoicer-api/runs/61?s=RunReconnect` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunRunning` | `#/o/harbor-labs/p/invoicer-api/runs/61` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunRunningAutoResume` | `#/o/harbor-labs/p/invoicer-api/runs/61?s=RunRunningAutoResume` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunRunningStop` | `#/o/harbor-labs/p/invoicer-api/runs/61?s=RunRunningStop` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunRunningUsage` | `#/o/harbor-labs/p/invoicer-api/runs/61?s=RunRunningUsage` | Board snapshot, live header and navigation | Token usage: active run, usage so far. Click Run 61 on RunsUsage |
| `RunRunningUsageReconnecting` | `#/o/harbor-labs/p/invoicer-api/runs/61?s=RunRunningUsageReconnecting` | Board snapshot, live header and navigation | Token usage: reconnecting, the cached usage stays. Scenario selector on the Run screen |
| `RunSetupFailed` | `#/o/harbor-labs/p/invoicer-api/runs/58` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunStarting` | `#/o/harbor-labs/p/invoicer-api/runs/63` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunStopped` | `#/o/harbor-labs/p/invoicer-api/runs/62?s=RunStopped` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunStoppedAutoResumeFailedGaveUp` | `#/o/harbor-labs/p/invoicer-api/runs/62?s=RunStoppedAutoResumeFailedGaveUp` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunStoppedAutoResumeWaiting` | `#/o/harbor-labs/p/invoicer-api/runs/62?s=RunStoppedAutoResumeWaiting` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunStoppedCrashedGaveUp` | `#/o/harbor-labs/p/invoicer-api/runs/62?s=RunStoppedCrashedGaveUp` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunStoppedPodLost` | `#/o/harbor-labs/p/invoicer-api/runs/62?s=RunStoppedPodLost` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunStoppedPodLostGaveUp` | `#/o/harbor-labs/p/invoicer-api/runs/62?s=RunStoppedPodLostGaveUp` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunStoppedPodLostGaveUpOnce` | `#/o/harbor-labs/p/invoicer-api/runs/62?s=RunStoppedPodLostGaveUpOnce` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunSucceeded` | `#/o/harbor-labs/p/invoicer-api/runs/60` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunSucceededFinished` | `#/o/harbor-labs/p/invoicer-api/runs/62?s=RunSucceededFinished` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunSucceededUsage` | `#/o/harbor-labs/p/invoicer-api/runs/60?s=RunSucceededUsage` | Board snapshot, live header and navigation | Token usage: one model, no reasoning line. Click Run 60 on RunsUsage; Hide on Usage or Models collapses them |
| `RunSucceededUsageCollapsed` | `#/o/harbor-labs/p/invoicer-api/runs/60?s=RunSucceededUsageCollapsed` | Board snapshot, live header and navigation | Token usage: Usage section collapsed (Show expands it). Live: Hide on the Usage section of any usage board |
| `RunSucceededUsageMultiModel` | `#/o/harbor-labs/p/invoicer-api/runs/60?s=RunSucceededUsageMultiModel` | Board snapshot, live header and navigation | Token usage: two models. Scenario selector on the Run screen |
| `RunSucceededUsageModelsCollapsed` | `#/o/harbor-labs/p/invoicer-api/runs/60?s=RunSucceededUsageModelsCollapsed` | Board snapshot, live header and navigation | Token usage: Usage open, Models table collapsed (Show expands it). Live: Hide next to Models on any usage board |
| `RunSucceededUsageNone` | `#/o/harbor-labs/p/invoicer-api/runs/60?s=RunSucceededUsageNone` | Board snapshot, live header and navigation | Token usage: no usage data. Scenario selector on the Run screen |
| `RunSucceededUsageNonePriced` | `#/o/harbor-labs/p/invoicer-api/runs/60?s=RunSucceededUsageNonePriced` | Board snapshot, live header and navigation | Token usage: no priced model, cost "—". Click Run 57 on RunsUsage |
| `RunSucceededUsagePartial` | `#/o/harbor-labs/p/invoicer-api/runs/60?s=RunSucceededUsagePartial` | Board snapshot, live header and navigation | Token usage: partial (call cap reached), "at least". Scenario selector on the Run screen |
| `RunSucceededUsagePriceRange` | `#/o/harbor-labs/p/invoicer-api/runs/60?s=RunSucceededUsagePriceRange` | Board snapshot, live header and navigation | Token usage: a run that spans a price change, "Prices as of 18 Nov 2026 to 21 Nov 2026." Scenario selector on the Run screen |
| `RunSucceededUsageReasoning` | `#/o/harbor-labs/p/invoicer-api/runs/60?s=RunSucceededUsageReasoning` | Board snapshot, live header and navigation | Token usage: "of which reasoning" line shown. Scenario selector on the Run screen |
| `RunSucceededUsageUnpriced` | `#/o/harbor-labs/p/invoicer-api/runs/60?s=RunSucceededUsageUnpriced` | Board snapshot, live header and navigation | Token usage: an unpriced model with a long name, "at least". Click Run 55 on RunsUsage |
| `RunSucceededUsageZero` | `#/o/harbor-labs/p/invoicer-api/runs/60?s=RunSucceededUsageZero` | Board snapshot, live header and navigation | Token usage: zero usage shows 0. Scenario selector on the Run screen |
| `RunTimedOut` | `#/o/harbor-labs/p/invoicer-api/runs/54` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunTranscriptStates` | `#/o/harbor-labs/p/invoicer-api/runs/62?s=RunTranscriptStates` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `Runs` | `#/o/harbor-labs/p/invoicer-api/runs` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunsEmpty` | `#/o/harbor-labs/p/invoicer-api/runs?s=RunsEmpty` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunsFlatPaged` | `#/o/harbor-labs/p/invoicer-api/runs?s=RunsFlatPaged` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunsLinked` | `#/o/harbor-labs/p/invoicer-api/runs?s=RunsLinked` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunsLinkedFiltered` | `#/o/harbor-labs/p/invoicer-api/runs?s=RunsLinkedFiltered` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunsLinkedLongChain` | `#/o/harbor-labs/p/invoicer-api/runs?s=RunsLinkedLongChain` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunsLinkedSeveralPrs` | `#/o/harbor-labs/p/invoicer-api/runs?s=RunsLinkedSeveralPrs` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunsLinkedSplitPr` | `#/o/harbor-labs/p/invoicer-api/runs?s=RunsLinkedSplitPr` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunsPageLoading` | `#/o/harbor-labs/p/invoicer-api/runs?s=RunsPageLoading` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunsPageLoadingLinked` | `#/o/harbor-labs/p/invoicer-api/runs?s=RunsPageLoadingLinked` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunsPageLoadingUsage` | `#/o/harbor-labs/p/invoicer-api/runs?s=RunsPageLoadingUsage` | Board snapshot, live header and navigation | Token usage: next page loading, the Usage column stays. Scenario selector on the Runs screen |
| `RunsPaged` | `#/o/harbor-labs/p/invoicer-api/runs?s=RunsPaged` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunsPagedLinkedIssueOnly` | `#/o/harbor-labs/p/invoicer-api/runs?s=RunsPagedLinkedIssueOnly` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunsPagedLinkedPrOnly` | `#/o/harbor-labs/p/invoicer-api/runs?s=RunsPagedLinkedPrOnly` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunsProblems` | `#/o/harbor-labs/p/invoicer-api/runs?s=RunsProblems` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunsProblemsEmpty` | `#/o/harbor-labs/p/invoicer-api/runs?s=RunsProblemsEmpty` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunsProblemsPaged` | `#/o/harbor-labs/p/invoicer-api/runs?s=RunsProblemsPaged` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `RunsUsage` | `#/o/harbor-labs/p/invoicer-api/runs?s=RunsUsage` | Board snapshot, live header and navigation | Token usage: Usage column (value, partial "+", no cost, none "—"); Run 60, 55, 57, 61 open their usage boards |
| `RunsShell` | `#/o/harbor-labs/p/invoicer-api/runs?s=RunsShell` | Board snapshot, live header and navigation (new) | Live: open a project |
| `Setup1` | `#/o/harbor-labs/projects/new/1` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `Setup1Polling` | `#/o/harbor-labs/projects/new/1?s=Setup1Polling` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `Setup1PollingOk` | `#/o/harbor-labs/projects/new/1?s=Setup1PollingOk` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `Setup2` | `#/o/harbor-labs/projects/new/2?s=Setup2` | Board snapshot, live header and navigation | Earlier version (static); the default route shows Setup2DefaultAgent |
| `Setup2AgentCodex` | `#/o/harbor-labs/projects/new/2?s=Setup2AgentCodex` | Board snapshot, live header and navigation (new) | Live: pick OpenAI Codex (sign-in file or API key, no address field) |
| `Setup2AgentRejected` | `#/o/harbor-labs/projects/new/2?s=Setup2AgentRejected` | Board snapshot, live header and navigation (new) | Live: pick any agent, type a credential containing "reject", Continue (Credential rejected, Continue anyway) |
| `Setup2DefaultAgent` | `#/o/harbor-labs/projects/new/2` | Live screen (new) | Live: setup step 2 "Add agent": nothing picked, three provider cards with logos, ten Coming-soon chips; the fields appear after a pick. Scenario group "Agent step states" lists the story states (Claude, OpenCode, saving, field errors, nothing chosen, returning) |
| `Setup3` | `#/o/harbor-labs/projects/new/3` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `Setup4` | `#/o/harbor-labs/projects/new/4` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `SetupReady` | `#/o/harbor-labs/projects/new/ready` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `SetupWorkspace` | `#/o/harbor-labs/projects/new/workspace` | Board snapshot, live header and navigation | Static board (not stateful in this prototype) |
| `SignIn` | `#/signin` | Board snapshot, live header and navigation | Live: first screen; Sign in with GitHub |
| `SignInNoInvitation` | `#/signin?s=SignInNoInvitation` | Board snapshot, live header and navigation | Live: persona Visitor with no invitation, Sign in |
| `OrgMembersSideMenu` | `#/side/o/harbor-labs/settings/members?s=OrgMembersSideMenu` | New board snapshot, 1440px, drawn as it is | Organization members, side menu (owner). Live: the same route without `?s=`, with the "Side menu shell" controls |
| `OrgMembersSideMenuCollapsed` | `#/side/o/harbor-labs/settings/members?s=OrgMembersSideMenuCollapsed` | New board snapshot, 1440px, drawn as it is | Organization members, menu collapsed. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `OrgMembersSideMenuLoading` | `#/side/o/harbor-labs/settings/members?s=OrgMembersSideMenuLoading` | New board snapshot, 1440px, drawn as it is | Organization members, menu loading. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `OrgMembersSideMenuError` | `#/side/o/harbor-labs/settings/members?s=OrgMembersSideMenuError` | New board snapshot, 1440px, drawn as it is | Organization members, menu could not load. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `ProjectsSideMenu` | `#/side/o/harbor-labs/projects?s=ProjectsSideMenu` | New board snapshot, 1440px, drawn as it is | Projects, organization menu (owner). Live: the same route without `?s=`, with the "Side menu shell" controls |
| `ProjectsSideMenuPlatformAdmin` | `#/side/o/harbor-labs/projects?s=ProjectsSideMenuPlatformAdmin` | New board snapshot, 1440px, drawn as it is | Projects, menu with Manage in Platform (platform admin). Live: the same route without `?s=`, with the "Side menu shell" controls |
| `ProjectsMemberSideMenu` | `#/side/o/harbor-labs/projects?s=ProjectsMemberSideMenu` | New board snapshot, 1440px, drawn as it is | Projects, organization menu (member or viewer). Live: the same route without `?s=`, with the "Side menu shell" controls |
| `ProjectsResumeSetup` | `#/side/o/harbor-labs/projects?s=ProjectsResumeSetup` | New board snapshot, 1440px, drawn as it is | Projects, a row with Resume setup. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `OrgInvitationsSettingsSideMenuProjectAdmin` | `#/side/o/harbor-labs/settings/invitations?s=OrgInvitationsSettingsSideMenuProjectAdmin` | New board snapshot, 1440px, drawn as it is | Organization invitations, menu for an admin of projects only. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunsSideMenu` | `#/side/o/harbor-labs/p/invoicer-api/runs?s=RunsSideMenu` | New board snapshot, 1440px, drawn as it is | Runs, full project menu. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunsSideMenuMember` | `#/side/o/harbor-labs/p/invoicer-api/runs?s=RunsSideMenuMember` | New board snapshot, 1440px, drawn as it is | Runs, project menu for a member or viewer. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunsSideMenuRepoWarning` | `#/side/o/harbor-labs/p/invoicer-api/runs?s=RunsSideMenuRepoWarning` | New board snapshot, 1440px, drawn as it is | Runs, repository block warning. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunsSideMenuRepoError` | `#/side/o/harbor-labs/p/invoicer-api/runs?s=RunsSideMenuRepoError` | New board snapshot, 1440px, drawn as it is | Runs, repository block error. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunsSideMenuRepoNoBranch` | `#/side/o/harbor-labs/p/invoicer-api/runs?s=RunsSideMenuRepoNoBranch` | New board snapshot, 1440px, drawn as it is | Runs, repository block with no default branch. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunsSideMenuLoading` | `#/side/o/harbor-labs/p/invoicer-api/runs?s=RunsSideMenuLoading` | New board snapshot, 1440px, drawn as it is | Runs, project menu loading. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunsSideMenuError` | `#/side/o/harbor-labs/p/invoicer-api/runs?s=RunsSideMenuError` | New board snapshot, 1440px, drawn as it is | Runs, project menu could not load. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `DeskRulesSideMenu` | `#/side/o/harbor-labs/p/invoicer-api/desk/rules?s=DeskRulesSideMenu` | New board snapshot, 1440px, drawn as it is | Routing rules, project menu. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `DeskRulesSideMenuSetupWarning` | `#/side/o/harbor-labs/p/invoicer-api/desk/rules?s=DeskRulesSideMenuSetupWarning` | New board snapshot, 1440px, drawn as it is | Routing rules, setup warning first in the scroll area. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `DeskSkillsSideMenu` | `#/side/o/harbor-labs/p/invoicer-api/desk/skills?s=DeskSkillsSideMenu` | New board snapshot, 1440px, drawn as it is | Skills, page header and project menu. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `DeskSetupSideMenu` | `#/side/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupSideMenu` | New board snapshot, 1440px, drawn as it is | Workspace setup, page header and project menu. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `DeskAgentSideMenu` | `#/side/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentSideMenu` | New board snapshot, 1440px, drawn as it is | Agent and settings, Agents tab, project menu. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `PlatformOrgsSideMenu` | `#/side/platform/orgs?s=PlatformOrgsSideMenu` | New board snapshot, 1440px, drawn as it is | Platform organizations, platform menu. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `CreateOrgSideMenu` | `#/side/platform/orgs/new?s=CreateOrgSideMenu` | New board snapshot, 1440px, drawn as it is | Create organization, platform menu. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `PlatformOrgProjectsSideMenu` | `#/side/platform/orgs/<orgId>/projects?s=PlatformOrgProjectsSideMenu` | New board snapshot, 1440px, drawn as it is | Platform, one organization: projects (Name first). Live: the same route without `?s=`, with the "Side menu shell" controls |
| `PlatformOrgOverviewSideMenuSuspended` | `#/side/platform/orgs/<suspendedOrgId>?s=PlatformOrgOverviewSideMenuSuspended` | New board snapshot, 1440px, drawn as it is | Platform, one suspended organization: overview. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `PlatformOrgMembersSideMenuLoading` | `#/side/platform/orgs/<orgId>/members?s=PlatformOrgMembersSideMenuLoading` | New board snapshot, 1440px, drawn as it is | Platform, one organization: menu loading. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `PlatformOrgMembersSideMenuError` | `#/side/platform/orgs/<orgId>/members?s=PlatformOrgMembersSideMenuError` | New board snapshot, 1440px, drawn as it is | Platform, one organization: could not load. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `PlatformOrgOverviewSideMenuNotFound` | `#/side/platform/orgs/<orgId>?s=PlatformOrgOverviewSideMenuNotFound` | New board snapshot, 1440px, drawn as it is | Platform, organization not found: platform menu. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunIdleSideCollapsed` | `#/side/o/harbor-labs/p/invoicer-api/runs/62?s=RunIdleSideCollapsed` | New board snapshot, 1440px, drawn as it is | Run needs you, menu collapsed, actions in the page header. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunIdleSideExpanded` | `#/side/o/harbor-labs/p/invoicer-api/runs/62?s=RunIdleSideExpanded` | New board snapshot, 1440px, drawn as it is | Run needs you, menu expanded. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunIdle1024` | `#/side/o/harbor-labs/p/invoicer-api/runs/62?s=RunIdle1024` | New board snapshot, 1024px, drawn as it is | Run needs you at 1024px. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunRunningSideMenu` | `#/side/o/harbor-labs/p/invoicer-api/runs/61?s=RunRunningSideMenu` | New board snapshot, 1440px, drawn as it is | Running, cancel confirm under the header button. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunRunningStopSideMenu` | `#/side/o/harbor-labs/p/invoicer-api/runs/61?s=RunRunningStopSideMenu` | New board snapshot, 1440px, drawn as it is | Running, stop confirm under the header button. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `ProjectsSideSwitcherOpen` | `#/side/o/harbor-labs/projects?s=ProjectsSideSwitcherOpen` | New board snapshot, 1440px, drawn as it is | Organization switcher open. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `ProjectsSideSwitcherLoading` | `#/side/o/harbor-labs/projects?s=ProjectsSideSwitcherLoading` | New board snapshot, 1440px, drawn as it is | Organization switcher, list loading. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `ProjectsSideSwitcherError` | `#/side/o/harbor-labs/projects?s=ProjectsSideSwitcherError` | New board snapshot, 1440px, drawn as it is | Organization switcher, list could not load. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `ProjectsSideSwitcherOneOrgHeld` | `#/side/o/harbor-labs/projects?s=ProjectsSideSwitcherOneOrgHeld` | New board snapshot, 1440px, drawn as it is | Organization switcher held open with one organization. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `ProjectsSideOneOrg` | `#/side/o/harbor-labs/projects?s=ProjectsSideOneOrg` | New board snapshot, 1440px, drawn as it is | One organization: plain organization name. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `MyInvitationsEmptySideSwitcherHeld` | `#/side/invitations?s=MyInvitationsEmptySideSwitcherHeld` | New board snapshot, 1440px, drawn as it is | No organization: switcher held open. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `MyInvitationsEmptyNoOrg` | `#/side/invitations?s=MyInvitationsEmptyNoOrg` | New board snapshot, 1440px, drawn as it is | My invitations with no organization. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunsSideProjectSwitcher` | `#/side/o/harbor-labs/p/invoicer-api/runs?s=RunsSideProjectSwitcher` | New board snapshot, 1440px, drawn as it is | Project switcher open. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunsSideProjectSwitcherNoCreate` | `#/side/o/harbor-labs/p/invoicer-api/runs?s=RunsSideProjectSwitcherNoCreate` | New board snapshot, 1440px, drawn as it is | Project switcher without New project. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunsSideProjectSwitcherLoading` | `#/side/o/harbor-labs/p/invoicer-api/runs?s=RunsSideProjectSwitcherLoading` | New board snapshot, 1440px, drawn as it is | Project switcher, loading. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunsSideProjectSwitcherError` | `#/side/o/harbor-labs/p/invoicer-api/runs?s=RunsSideProjectSwitcherError` | New board snapshot, 1440px, drawn as it is | Project switcher, could not load. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunsSideProjectSwitcherEmpty` | `#/side/o/harbor-labs/p/invoicer-api/runs?s=RunsSideProjectSwitcherEmpty` | New board snapshot, 1440px, drawn as it is | Project switcher, no projects. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `ProjectsSideAccountMenu` | `#/side/o/harbor-labs/projects?s=ProjectsSideAccountMenu` | New board snapshot, 1440px, drawn as it is | Account menu with My invitations. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `OrgSuspendedNoMenu` | `#/side/o/harbor-labs/projects?s=OrgSuspendedNoMenu` | New board snapshot, 1440px, drawn as it is | Suspended organization: no menu, switcher kept. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `OrgSuspendedPlainName` | `#/side/o/harbor-labs/projects?s=OrgSuspendedPlainName` | New board snapshot, 1440px, drawn as it is | Suspended only organization: plain name. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `OrgAuditForbiddenSideMenu` | `#/side/o/harbor-labs/settings/audit?s=OrgAuditForbiddenSideMenu` | New board snapshot, 1440px, drawn as it is | No access, organization menu. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `DeskRulesForbiddenSideMenu` | `#/side/o/harbor-labs/p/invoicer-api/desk/rules?s=DeskRulesForbiddenSideMenu` | New board snapshot, 1440px, drawn as it is | No access, project menu. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunsNotFoundSideMenu` | `#/side/o/harbor-labs/p/invoicer-api/runs?s=RunsNotFoundSideMenu` | New board snapshot, 1440px, drawn as it is | Project out of scope: not found with the organization menu. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunsNeedsYouNotFound` | `#/side/o/harbor-labs/p/invoicer-api/needs-you?s=RunsNeedsYouNotFound` | New board snapshot, 1440px, drawn as it is | Removed needs-you address: not found with the project menu. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RouteErrorSideMenu` | `#/side/o/harbor-labs/projects?s=RouteErrorSideMenu` | New board snapshot, 1440px, drawn as it is | Server error with the project menu. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RouteErrorNoMenu` | `#/side/o/harbor-labs/projects?s=RouteErrorNoMenu` | New board snapshot, 1440px, drawn as it is | Server error with no menu. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RouteErrorNotFoundNoMenu` | `#/side/o/harbor-labs/projects?s=RouteErrorNotFoundNoMenu` | New board snapshot, 1440px, drawn as it is | Not found with no menu. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RouteErrorCrashSideMenu` | `#/side/o/harbor-labs/projects?s=RouteErrorCrashSideMenu` | New board snapshot, 1440px, drawn as it is | Crash with the project menu. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RouteLoadingSideMenu` | `#/side/o/harbor-labs/projects?s=RouteLoadingSideMenu` | New board snapshot, 1440px, drawn as it is | Page loading with the project menu. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `PlatformAdminsForbiddenNoMenu` | `#/side/platform/admins?s=PlatformAdminsForbiddenNoMenu` | New board snapshot, 1440px, drawn as it is | Platform area without the role: no menu. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `MyInvitationsSideMenu` | `#/side/invitations?s=MyInvitationsSideMenu` | New board snapshot, 1440px, drawn as it is | My invitations, organization menu. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `MyInvitationsEmptyMember` | `#/side/invitations?s=MyInvitationsEmptyMember` | New board snapshot, 1440px, drawn as it is | My invitations, member with none pending. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `InvitationAcceptSideMenu` | `#/side/invitations/<token>?s=InvitationAcceptSideMenu` | New board snapshot, 1440px, drawn as it is | Invitation, organization menu. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `InvitationAcceptErrorSideMenu` | `#/side/invitations/<token>?s=InvitationAcceptErrorSideMenu` | New board snapshot, 1440px, drawn as it is | Invitation load error keeps the organization menu. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `InvitationAcceptNotAvailableNoMenu` | `#/side/invitations/<token>?s=InvitationAcceptNotAvailableNoMenu` | New board snapshot, 1440px, drawn as it is | Invitation not available, no active organization. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `Setup3ExitSetup` | `#/side/o/harbor-labs/projects/new/3?s=Setup3ExitSetup` | New board snapshot, 1440px, drawn as it is | Setup step 3 with Exit setup. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `Setup4ExitSetup` | `#/side/o/harbor-labs/projects/new/4?s=Setup4ExitSetup` | New board snapshot, 1440px, drawn as it is | Setup step 4 with Exit setup. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `SetupReadyExitSetup` | `#/side/o/harbor-labs/projects/new/ready?s=SetupReadyExitSetup` | New board snapshot, 1440px, drawn as it is | Setup ready with Exit setup. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `Setup3PreviewDialog` | `#/side/o/harbor-labs/projects/new/3?s=Setup3PreviewDialog` | New board snapshot, 1440px, drawn as it is | Setup step 3, skill template preview. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `SignInProofOfConcept` | `#/side/signin?s=SignInProofOfConcept` | New board snapshot, 1440px, drawn as it is | Sign in, shortened footer. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `SignInPhone` | `#/side/signin?s=SignInPhone` | New board snapshot, 390px, drawn as it is | Phone: sign in. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `ProjectsPhone` | `#/side/o/harbor-labs/projects?s=ProjectsPhone` | New board snapshot, 390px, drawn as it is | Phone: projects as cards. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `Setup1Phone` | `#/side/o/harbor-labs/projects/new/1?s=Setup1Phone` | New board snapshot, 390px, drawn as it is | Phone: setup step 1, radio cards stacked. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `Setup2Phone` | `#/side/o/harbor-labs/projects/new/2?s=Setup2Phone` | New board snapshot, 390px, drawn as it is | Phone: setup step 2, add your agent. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `Setup3Phone` | `#/side/o/harbor-labs/projects/new/3?s=Setup3Phone` | New board snapshot, 390px, drawn as it is | Phone: setup step 3. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `Setup4Phone` | `#/side/o/harbor-labs/projects/new/4?s=Setup4Phone` | New board snapshot, 390px, drawn as it is | Phone: setup step 4, aside below. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `SetupReadyPhone` | `#/side/o/harbor-labs/projects/new/ready?s=SetupReadyPhone` | New board snapshot, 390px, drawn as it is | Phone: setup ready. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `Setup3PreviewDialogPhone` | `#/side/o/harbor-labs/projects/new/3?s=Setup3PreviewDialogPhone` | New board snapshot, 390px, drawn as it is | Phone: skill template preview. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `Setup3PhoneDrawer` | `#/side/o/harbor-labs/projects/new/3?s=Setup3PhoneDrawer` | New board snapshot, 390px, drawn as it is | Phone: setup stepper in the drawer. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunsPhone` | `#/side/o/harbor-labs/p/invoicer-api/runs?s=RunsPhone` | New board snapshot, 390px, drawn as it is | Phone: runs as cards. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `DeskRulesPhone` | `#/side/o/harbor-labs/p/invoicer-api/desk/rules?s=DeskRulesPhone` | New board snapshot, 390px, drawn as it is | Phone: routing rules, one column. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `DeskRulesPromptPhone` | `#/side/o/harbor-labs/p/invoicer-api/desk/rules?s=DeskRulesPromptPhone` | New board snapshot, 390px, drawn as it is | Phone: routing rule pane in place of the list. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `DeskSkillsPhone` | `#/side/o/harbor-labs/p/invoicer-api/desk/skills?s=DeskSkillsPhone` | New board snapshot, 390px, drawn as it is | Phone: skills, list above the editor. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `DeskSetupPhone` | `#/side/o/harbor-labs/p/invoicer-api/desk/setup?s=DeskSetupPhone` | New board snapshot, 390px, drawn as it is | Phone: workspace setup. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `DeskAgentPhone` | `#/side/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentPhone` | New board snapshot, 390px, drawn as it is | Phone: agents, stacked rows and pager. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `DeskMembersPhone` | `#/side/o/harbor-labs/p/invoicer-api/desk/members?s=DeskMembersPhone` | New board snapshot, 390px, drawn as it is | Phone: project members as cards. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `DeskAuditPhone` | `#/side/o/harbor-labs/p/invoicer-api/desk/audit?s=DeskAuditPhone` | New board snapshot, 390px, drawn as it is | Phone: project audit log as cards. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `OrgGeneralPhone` | `#/side/o/harbor-labs/settings/general?s=OrgGeneralPhone` | New board snapshot, 390px, drawn as it is | Phone: organization general, one column. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `OrgMembersPhone` | `#/side/o/harbor-labs/settings/members?s=OrgMembersPhone` | New board snapshot, 390px, drawn as it is | Phone: organization members as cards. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `OrgInvitationsSettingsPhone` | `#/side/o/harbor-labs/settings/invitations?s=OrgInvitationsSettingsPhone` | New board snapshot, 390px, drawn as it is | Phone: organization invitations as cards. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `OrgAuditPhone` | `#/side/o/harbor-labs/settings/audit?s=OrgAuditPhone` | New board snapshot, 390px, drawn as it is | Phone: organization audit log as cards. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `PlatformOrgsPhone` | `#/side/platform/orgs?s=PlatformOrgsPhone` | New board snapshot, 390px, drawn as it is | Phone: platform organizations as cards. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `PlatformAdminsPhone` | `#/side/platform/admins?s=PlatformAdminsPhone` | New board snapshot, 390px, drawn as it is | Phone: platform admins as cards. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `PlatformAuditPhone` | `#/side/platform/audit?s=PlatformAuditPhone` | New board snapshot, 390px, drawn as it is | Phone: platform audit log as cards. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `PlatformOrgOverviewPhone` | `#/side/platform/orgs/<orgId>?s=PlatformOrgOverviewPhone` | New board snapshot, 390px, drawn as it is | Phone: platform organization overview. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `PlatformOrgProjectsPhone` | `#/side/platform/orgs/<orgId>/projects?s=PlatformOrgProjectsPhone` | New board snapshot, 390px, drawn as it is | Phone: platform organization projects. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `PlatformOrgMembersPhone` | `#/side/platform/orgs/<orgId>/members?s=PlatformOrgMembersPhone` | New board snapshot, 390px, drawn as it is | Phone: platform organization members. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `PlatformOrgInvitationsPhone` | `#/side/platform/orgs/<orgId>/invitations?s=PlatformOrgInvitationsPhone` | New board snapshot, 390px, drawn as it is | Phone: platform organization invitations. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `CreateOrgPhone` | `#/side/platform/orgs/new?s=CreateOrgPhone` | New board snapshot, 390px, drawn as it is | Phone: create organization. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `MyInvitationsPhone` | `#/side/invitations?s=MyInvitationsPhone` | New board snapshot, 390px, drawn as it is | Phone: my invitations. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `InvitationAcceptPhone` | `#/side/invitations/<token>?s=InvitationAcceptPhone` | New board snapshot, 390px, drawn as it is | Phone: invitation. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RouteErrorPhone` | `#/side/o/harbor-labs/projects?s=RouteErrorPhone` | New board snapshot, 390px, drawn as it is | Phone: server error. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `OrgSuspendedPhone` | `#/side/o/harbor-labs/projects?s=OrgSuspendedPhone` | New board snapshot, 390px, drawn as it is | Phone: suspended organization. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunIdlePhone` | `#/side/o/harbor-labs/p/invoicer-api/runs/62?s=RunIdlePhone` | New board snapshot, 390px, drawn as it is | Phone run: terminal with extra keys. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunIdlePhoneDetails` | `#/side/o/harbor-labs/p/invoicer-api/runs/62?s=RunIdlePhoneDetails` | New board snapshot, 390px, drawn as it is | Phone run: details. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunReconnectPhone` | `#/side/o/harbor-labs/p/invoicer-api/runs/62?s=RunReconnectPhone` | New board snapshot, 390px, drawn as it is | Phone run: terminal reconnecting, no keys. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunStoppedPhone` | `#/side/o/harbor-labs/p/invoicer-api/runs/62?s=RunStoppedPhone` | New board snapshot, 390px, drawn as it is | Phone run: paused, no keys. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunRunningPhoneCancelConfirm` | `#/side/o/harbor-labs/p/invoicer-api/runs/61?s=RunRunningPhoneCancelConfirm` | New board snapshot, 390px, drawn as it is | Phone run: cancel confirm, full width. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `ProjectsPhoneDrawer` | `#/side/o/harbor-labs/projects?s=ProjectsPhoneDrawer` | New board snapshot, 390px, drawn as it is | Phone: organization menu drawer. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `RunsPhoneDrawer` | `#/side/o/harbor-labs/p/invoicer-api/runs?s=RunsPhoneDrawer` | New board snapshot, 390px, drawn as it is | Phone: project menu drawer. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `ProjectsPhoneSwitcher` | `#/side/o/harbor-labs/projects?s=ProjectsPhoneSwitcher` | New board snapshot, 390px, drawn as it is | Phone: organization switcher popover. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `DeskAgentAddPhone` | `#/side/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentAddPhone` | New board snapshot, 390px, drawn as it is | Phone: add agent pane in place of the list. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `DeskAgentEditPhone` | `#/side/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentEditPhone` | New board snapshot, 390px, drawn as it is | Phone: edit agent pane in place of the list. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `DeskAgentRowMenuPhone` | `#/side/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentRowMenuPhone` | New board snapshot, 390px, drawn as it is | Phone: agent row menu. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `DeskAgentDeletePhone` | `#/side/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentDeletePhone` | New board snapshot, 390px, drawn as it is | Phone: delete agent dialog, full width. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `DeskAgentGitHubPhone` | `#/side/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentGitHubPhone` | New board snapshot, 390px, drawn as it is | Phone: GitHub connection tab. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `DeskAgentLimitsPhone` | `#/side/o/harbor-labs/p/invoicer-api/desk/agent?s=DeskAgentLimitsPhone` | New board snapshot, 390px, drawn as it is | Phone: Limits tab, Save limits pinned. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `Setup2AgentPickedPhone` | `#/side/o/harbor-labs/projects/new/2?s=Setup2AgentPickedPhone` | New board snapshot, 390px, drawn as it is | Phone: setup step 2, OpenCode picked. Live: the same route without `?s=`, with the "Side menu shell" controls |
| `Setup2AgentRejectedPhone` | `#/side/o/harbor-labs/projects/new/2?s=Setup2AgentRejectedPhone` | New board snapshot, 390px, drawn as it is | Phone: setup step 2, credential rejected. Live: the same route without `?s=`, with the "Side menu shell" controls |
