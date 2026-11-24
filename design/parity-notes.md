# Parity and accessibility notes

Reproduce the screenshots with `npm run build-storybook && node scripts/parity.mjs` in `web/` (set `PARITY_CHROMIUM` to a
Chromium binary, or run `npx playwright install chromium`). Output goes to `web/parity-out/` as 24 `<board>.story.png` /
`<board>.proto.png` pairs at the `canvas.json` artboard size.

All 24 pairs were reviewed (side by side; boards with under 1% pixel difference were checked at a glance).

## Fixed in the pass

- Run end banners (Failed, Timed out): prominent banner padding 14/16, icon gap 14, body gap 6, actions margin 4 (banner was 3px short).
- Succeeded and Cancelled end banners: title and text run on one line (`Banner inlineTitle`).
- Side panel "Triggered by": the comment link wraps under the actor as in the prototype.
- Run top bar: 8px between "Runs" and its count badge.
- Terminal cursor sits on the `>` prompt row, not the last row (idle run).
- Desk skill editor fills the column so the commit bar is pinned to the bottom.
- Setup 4: 24px between the sentence card and the fields (`RuleForm spacious`).
- Pull request block in the run side panel: plain title with diffstat inline.
- Desk Agent GitHub connection values use an icon and plain text, not green inline status.

## Remaining differences per board

- Main, SignIn, ProjectsEmpty, Projects, Setup2, RunReconnect: no visible difference.
- NeedsYou: the project list card is about 9px taller (the "webhooks" warning row is about 5px taller than the prototype's), which pushes the lower row of cards down by about 10px. Not fixed.
- Runs, RunsProblems: the table block sits about 2px lower (header row height); otherwise identical.
- Setup1: radio cards and the banner below are 1 to 2px taller each, 4px cumulative. Not fixed.
- Setup3, SetupReady: 1 to 2px vertical drift only.
- RunStarting, RunIdle, RunSucceeded, RunCancelled, RunTimedOut: side panel rows 1 to 3px different (the Triggered by avatar row is 2px taller). Not fixed.
- RunRunning: the Cancel popover's "Keep running" button shows a focus ring in the story (autofocus); status pill sits about 3px left of the prototype before the crumb fix, to be re-checked in a browser.
- DeskSkills, DeskRules: DeskRules stats text wraps as "14 runs this week, last / 14:15" in the story and "14 runs this week / last 14:15" in the prototype. Not fixed.
- DeskAgent: the Agent field is disabled so it renders dimmed (prototype shows normal text). The replace-credential field is empty with "Test and replace" disabled; the prototype shows a prefilled token and an enabled button. Treated as intentional state differences.
- DeskSkillDelete: the confirmation field is empty with "Delete and commit" disabled and focus on the message field; the prototype shows it typed and enabled. Intentional state difference.

## Accessibility

jsdom axe run (`src/test/stories.smoke.test.tsx`, every `Primitives/*`, `Components/*`, `Screens/*` story, `color-contrast` disabled).
Fixed:

- `heading-order`: headings that skipped a level are now `h2.h3` (Overview group titles, Setup 1 aside, Setup ready summary, GuardsCard). `.h3` in `global.css` keeps the 14px look.
- `empty-table-header`: action columns carry a visually hidden "Actions" label via the shared `.sr-only` utility (`global.css`), now also used by the Runs, Runs problems and Projects screens in place of three module-local copies.

Contrast was checked with axe `color-contrast` against the built Storybook for every Primitives, Components and Screens story. The only findings were the editor line numbers (3.11:1, `--ln` on the editor background) in `Components/CodeEditor` (both stories) and `Screens/Desk` Skills, which is an expected exception below. Nothing else failed.

Expected exceptions, not fixed:

- Disabled controls (`.dis`, opacity .45): exempt under WCAG 1.4.3 (inactive components).
- The "coming in MVP" disabled Transcript tab (opacity .6).
- Editor line numbers (`--ln`): decorative, aria-hidden.

Known minors, flagged for a human:

- Find button `aria-label="Find in scrollback"` contains the visible text "Find" (WCAG 2.5.3 label-in-name satisfied).
- RadioCard aside (Preview link) is a sibling of the label, not nested inside it.

## Parity items needing a browser check

- Ellipsis in table cells and the run bar (text-overflow depends on real widths).
- Terminal anchoring (scroll pinned to the bottom while output grows).
- Scrim layering (z-order of the dialog scrim against the top bar and popover).
- Cursor alignment in the terminal.
- 560px placeholder width for starting/cancelled runs.
- CodeEditor textarea and caret: about 2ch of slack against the highlighted layer.
- `.faint:hover` utility (hover colour not in the prototype).
- Status pill glyph rendering and size.
- Banner and heading sizes.

## Polling trigger mode (prototype states, now in Storybook)

Added after the pass above, so `parity.mjs` then found 26 boards (30 with workspace setup, below). Copy must match exactly.

- Setup1 (now 1440x1000, webhook chosen): new group "How Agent Desk hears about new comments" with two radio cards side by side,
  "Webhook" / "Near-instant. GitHub must reach Agent Desk at a public URL." and "Polling" / "Works without a public URL. Runs start up
  to one interval later." The aside warning now reads "On a local cluster GitHub cannot reach you. Choose Polling instead, or start
  the webhook relay and press Check again. ..."
- Setup1Polling (new, 1440x1000): Polling chosen, "Check every" segmented control (5 min selected, 10 min, 15 min, 30 min) with help
  "You can change the mode later in project settings." Banner (off, starting icon) "Checking issue comments for the first time" /
  "No webhook or relay needed. This takes a few seconds." Continue is disabled. The aside warning is replaced by an info banner
  "Polling and the GitHub rate limit" / "Each check is one request per repository, so 12 an hour at 5 min. GitHub gives
  the app 5,000 an hour, and a check with no new comments does not count." Intervals are 5, 10, 15 or 30 min; 5 min is the
  default and the minimum.
- Setup1PollingOk (new, 1440x1000): same, with ok banner "Polling every 5 min · last checked 20s ago" / "Agent Desk can read
  comments on this repository. A new command starts a run within 5 minutes." Continue enabled.
- SetupReady: "Last event: ping, 14:01:37 (webhook)." and a "Trigger: Webhook" row in "What you set up". The polling form of the
  line is "Last checked: 20s ago (polling)." (no separate board).
- Projects: invoicer-web shows "Polling every 5 min" (ok); docs-site keeps "No webhooks for 2 days" with a small "Switch to polling"
  button under it; new row billing-jobs (harbor-labs/billing-jobs) shows the polling error "Polling failed: rate limited, retry in 5 min".
- RunsProblems: the silent-webhook banner gains a primary "Switch to polling" button before "Check again", and its text ends
  "... or switch this project to polling, which needs no public URL."
- DeskAgent (now 1440x1320): "Trigger mode" row with a Webhook / Polling segmented control and "Last webhook" renamed "Last event"
  ("issue_comment, 2 min ago, accepted (webhook)").
- NeedsYou: unchanged; its "webhooks" warning in the switcher is still the webhook-mode warning.

## Workspace setup and plugins (prototype states, now in Storybook)

Spec: `docs/superpowers/specs/2026-11-13-workspace-setup-and-plugins-design.md`. Four new boards, so `parity.mjs` finds 30.
Not yet run through `parity.mjs`; side by side in a browser only.

- DeskSetup (1440x900): Desk tab "Workspace setup" (nav item between Routing rules and Agent & settings, also added to the
  other four Desk boards). Last-test banner, shell editor, change note + "Save version 5", side panel with Plugins
  (will install / blocked: store not approved) and Version history (View, Restore).
- DeskSetupTest (1440x900): draft under test, setup failed. Phase row (Clone, Plugins, Setup, Shell), terminal with the
  `agentdesk:` markers and the idle shell, End test in the terminal bar. Story differences: the bar keeps Find and Copy all
  (shared TerminalBar), and the side panel has no "Setup: Failed, exit 1" row (the phase row carries it).
- SetupWorkspace (1440x1000): onboarding "Step 3 of 5, optional", "Prepare the workspace". Story difference: "Test again"
  sits under the result banner, not in the footer. The other Setup boards still show four steps; they renumber when the
  onboarding step ships (the live `setupSteps` keeps four until then, `withWorkspace` opts in).
- RunSetupFailed (1440x900): Run 58, "Setup failed" pill and banner, setup log as scrollback, side panel "Setup: Version 5".
- The sample repo is .NET, but the runner image has only Node 22, git and gh, so the sample script installs the .NET SDK
  into `$HOME`. Open question for the spec: `export PATH=...` in the setup script does not reach the agent's shell.

## Rule custom prompt (prototype states, now in Storybook)

Spec: `docs/superpowers/specs/2026-11-13-rule-custom-prompt-design.md`. Four new boards, so `parity.mjs` finds 34
(the script now also maps SetupWorkspace, RunSetupFailed, DeskSetup and DeskSetupTest, which it was missing).
Copy must match exactly.

- DeskRules: new row `/triage` (5th of 6), "run **Custom prompt** <first line of the prompt> with Claude", the first line
  cut with an ellipsis. The edit pane gains a "Run" segmented control (Skill / Custom prompt) after the labels field; the
  skill select is now labelled "Skill" and sits beside "With agent", with "Enabled" on its own row.
- DeskRulesPrompt (new, 1440x1080): `/triage` selected; Custom prompt chosen. "Prompt" textarea, help "Don't paste
  passwords or tokens. This text is stored." with the counter "213 / 4000" on the right. Below it, the read-only block
  "Added by Agent Desk (can't be edited)" (lock icon, dashed border, faint mono text, placeholders in italics) and the
  note "Your prompt comes first. These lines always follow it." The sentence reads "run a custom prompt with agent Claude".
- DeskRulesPromptNew (new, 1440x1080): "New rule" `/release-notes` on pull requests, empty prompt ("0 / 4000", placeholder
  "Tell the agent what to do on the ticket"), the system block loading (three skeleton lines). No Delete button.
- DeskRulesPromptError (new, 1440x1080): prompt over the limit (counter red "4294 / 4000", textarea border red, error
  "Keep the prompt to 4000 characters or fewer.") and the system block failed: "Could not load the lines Agent Desk adds.
  They are still added to every run." with a small Retry button.
- Setup4: the same "Run" segmented control, Skill chosen (board still says "Step 4 of 4", as before). The prompt form in
  setup is the state story `Setup4Prompt` (1440x1080), no board.
- RunSucceeded: new side panel section "Prompt" after "Run", collapsed, with a ghost "Show" button and a chevron.
- RunPrompt (new, 1440x900): RunSucceeded with the Prompt section open ("Hide"), the final prompt in a scrollable mono box
  (max 220px).
- RunCancelled: the Prompt section reads "Not recorded" (a run started before prompts were kept), no button.
- The system lines follow the spec's three lines. Today's template (`packages/core/src/router/prompt.ts`) also ends with
  an `agentdesk-status` line; the boards and fixtures leave it out (open question for the backend PR, and the FR-3 fixture
  scan flags its `sk-`).
- Pixel check: the new pane and side panel content match their boards; the remaining differences on these boards are
  the pre-existing Desk frame and list drift noted above.

## Run list routing rule column (#87)

- Runs, RunsProblems: the run table shows a "Routing rule" column (the run's command, for example `/code-build`; `—` when none was recorded; one line with an ellipsis and the full command in a tooltip) where the prototype has "Skill". Intended drift, not fixed. Storybook and the parity script were not run in the runner pod (no browser build), so the pixel check of these two boards is still to do.
- DeskAgent, DeskAgentCustomModel, DeskAgentAddressChanged (model list and API address): the Agent field is disabled so it renders dimmed (as DeskAgent above). The credential panel sits 6px lower than the board (the shared 12px gap between the credential row and its panel), and the New token input has no "Paste the token" placeholder; both are the existing SecretField, left as is. The Limits section keeps the current layout (six limit fields), not the older board's four. Treated as intentional state differences.
- Setup2 (API address and Default model picker): Storybook was built and `pnpm parity` run; `Setup2.story.png` was compared with `Setup2.proto.png`. The new API address and Default model rows match the board. Remaining differences are older and intentional: the story says "Step 2 of 5" and lists the Prepare workspace step (the board predates it, as on SetupWorkspace), the Token input is empty (the board shows a prefilled token), and the reveal button sits inside the input. Setup2Fallback has no board and is not in the parity script, so it was not compared; it differs from Setup2 only by the standard names and the reason note under Default model.

## Org onboarding: Projects and sign-in boards

Spec: `docs/superpowers/specs/2026-11-21-org-onboarding-design.md` (UI and Storybook). Twelve boards added, so `parity.mjs`
finds 91: ProjectsChecklist, ProjectsChecklistDone, ProjectsChecklistError, ProjectsChecklistLoading, ProjectsEmptyChecklist,
ProjectsEmptyNoCreate, ProjectsMember, ProjectsNoAccess, ProjectsOrgSwitchAdmin, ProjectsOrgSwitchOpen, ProjectsSwitching,
SignInNoInvitation.

- Projects, ProjectsEmpty, ProjectsPaged: the boards are unchanged (no org name, no "Invitations" button). Their stories now
  draw a one-org owner, so they show the org name after the brand and an "Invitations" button beside "New project" (beside
  "Create project" on the empty page). Intended drift, not fixed.
- ProjectsNoAccess: the story draws the "You don't have access" copy with the screens' centered notice markup, not the
  router-bound `Forbidden` (screens cannot import the app layer).
- ProjectsEmptyNoCreate: drawn as the board does (h1 "No projects yet" in the centered notice) rather than the `EmptyState`
  component, which has no h1 and a smaller title.
- ProjectsSwitching: the story uses the shared `RouteSkeleton`; the board's skeleton lines differ in width and count.
- Invitations banner: the story uses the shared `Banner` (title weight and size), the board draws plain body text.
- Storybook and `parity.mjs` were not run in the runner pod (no Chromium). The 12 pixel pairs are unchecked: none of them is claimed to match; the pixel check is still to do in a browser.

## Org onboarding: welcome page boards

Spec: `docs/superpowers/specs/2026-11-21-org-onboarding-design.md` (UI and Storybook). Six boards added, so `parity.mjs`
finds 97: MyInvitations, MyInvitationsAccepting, MyInvitationsEmpty, MyInvitationsEmptyPlatformAdmin, MyInvitationsError,
MyInvitationsLoading.

- Cards: the stories use the shared `InvitationCard` (surface card, title weight and size), where the boards draw inline-styled cards.
- MyInvitationsError: the story uses the shared `RouteLoadError` banner, so the Request ID sits in the banner body as in other route errors.
- MyInvitationsLoading: the story uses `Skeleton` blocks sized as the board (32px heading, two 98px cards).
- MyInvitationsLoading and MyInvitationsError: neither the boards nor the screen draw an h1 in these states. The error banner is an alert and the loading block is a labelled busy status.
- Storybook and `parity.mjs` were not run in the runner pod (no Chromium). The 6 pixel pairs are unchecked: none of them is claimed to match; the pixel check is still to do in a browser.

## Org onboarding: invitation link page boards

Spec: `docs/superpowers/specs/2026-11-21-org-onboarding-design.md` (UI and Storybook). Twelve boards added, so `parity.mjs`
finds 109: InvitationAccept, InvitationAcceptAccepted, InvitationAcceptAccepting, InvitationAcceptDeclineConfirm,
InvitationAcceptDeclined, InvitationAcceptDeclining, InvitationAcceptError, InvitationAcceptExpired,
InvitationAcceptExpiredInviterDeleted, InvitationAcceptLoading, InvitationAcceptNotAvailable, InvitationAcceptRevoked.

- Details card: the stories use the shared `SurfaceCard` and `KeyValue` (120px term column), where the boards draw an inline-styled card.
- Decline dialog: the stories use the design-system `Dialog` (440px) with a ghost Cancel and a solid-danger Decline, as the boards.
- Resolved and not-available states: the screen draws an h1 in the centred notice column (as the welcome empty state), since the boards draw an h1 of 28px; it does not use `EmptyState`, which only offers h2 or h3.
- InvitationAcceptError: the story uses the shared `RouteLoadError` banner, so the Request ID sits in the banner body.
- InvitationAcceptLoading and InvitationAcceptError: neither the boards nor the screen draw an h1 in these states.
- InvitationAcceptAccepted: the top bar shows the org name as plain text (one org), as the board.
- Storybook and `parity.mjs` were not run in the runner pod (no Chromium). The 12 pixel pairs are unchecked: none of them is claimed to match; the pixel check is still to do in a browser.

## Org onboarding: org Invitations page list boards

Spec: `docs/superpowers/specs/2026-11-21-org-onboarding-design.md` (UI and Storybook). Twelve boards added, so `parity.mjs`
finds 121: OrgInvitations, OrgInvitationsAll, OrgInvitationsEmpty, OrgInvitationsEmptyAll, OrgInvitationsEmptyFiltered,
OrgInvitationsError, OrgInvitationsFiltered, OrgInvitationsForbidden, OrgInvitationsLoading, OrgInvitationsPaged,
OrgInvitationsRowMenu, OrgInvitationsRowMenuExpired.

- Table: the stories use the shared `DataTable` and `InvitationRow`; column widths follow the shared table layout, not the boards' fixed percentages.
- Empty states: the shared `EmptyState` under the table, drawn as an h2 (the boards draw an h3; axe heading-order requires h2 right under the h1); the Pending one carries a second "Invite people" button.
- Forbidden: the screen draws the same notice as the Projects no-access story (h1, one line), not the `Forbidden` route component, which sits in `app/` and adds a "Go to projects" button the board does not draw.
- Loading and error: the loading block is a labelled busy status of `Skeleton` blocks; the error is the shared `RouteLoadError` banner. Neither draws an h1.
- Row menus: the story-only `openMenuRowId` opens the menu by pressing that row's Actions button once after mount; the menu is placed under the button by `useRowMenu`, where the boards use fixed offsets.
- Storybook and `parity.mjs` were not run in the runner pod (no Chromium). The 12 pixel pairs are unchecked: none of them is claimed to match; the pixel check is still to do in a browser.

## Org onboarding: org Invitations page action boards

Spec: `docs/superpowers/specs/2026-11-21-org-onboarding-design.md` (UI and Storybook). Fifteen boards added, so `parity.mjs`
finds 136: OrgInvitationsCopyFailed, OrgInvitationsCreated, OrgInvitationsInvite, OrgInvitationsInviteFieldError,
OrgInvitationsInviteFormError, OrgInvitationsInviteProjectAdmin, OrgInvitationsInviteProjects, OrgInvitationsInviteSaving,
OrgInvitationsInviteTabSwitched, OrgInvitationsLinkCopied, OrgInvitationsRenewed, OrgInvitationsResendConflict,
OrgInvitationsResending, OrgInvitationsRevokeConfirm, OrgInvitationsRevoked.

- Toasts: drawn by the shared `Toast` in the shared `ToastRegion` (fixed bottom right) with a Dismiss button; the notice carries `role="status"` for both tones, as the spec says, where the live provider uses `alert` for errors.
- Copy failed: the popover sits under the row's Actions button (placed from its measured position) and holds the shared `InviteLink` (the "Invitation link" field with "Copy link", which retries the copy); the board draws a fixed offset.
- Revoke confirm: the shared `Dialog`, 440px like the decline confirm; while the row's request is in flight the buttons disable and the confirm button reads "Revoking…" (the boards draw only the idle confirm).
- Invite dialog boards: the shared `InviteDialog` over the page; the tab-switched board shows the red Toast over the dialog with the input kept.
- Resending: the in-flight row's Actions button is disabled; no spinner is drawn (as the board).
- Storybook and `parity.mjs` were not run in the runner pod (no Chromium). The 15 pixel pairs are unchecked: none of them is claimed to match; the pixel check is still to do in a browser.

## Org onboarding: create-org form boards

Spec: `docs/superpowers/specs/2026-11-21-org-onboarding-design.md` (UI and Storybook). Eleven boards added, so `parity.mjs`
finds 147: CreateOrg, CreateOrgCreated, CreateOrgError, CreateOrgFieldErrors, CreateOrgForbidden, CreateOrgInvitationFailed,
CreateOrgRetrying, CreateOrgSaving, CreateOrgSlugAuto, CreateOrgSlugEdited, CreateOrgSlugTaken.

- Fields: the shared `Field` with `TextInput` and `PrefixInput`; the "URL" input's description is the `/o/` prefix (via the new optional `prefixId` of `PrefixInput`) plus any error. Field errors are shared `Field` errors (no `role="alert"`, the boards draw one).
- Saving and retrying: the fields are read-only while the request is in flight (the boards leave them editable); in the retrying state the email is read-only too.
- Errors: the form and invitation-failed notices are the shared `Banner` (`role="alert"`, with "Retry" as a Button with the refresh icon); the request ID is plain muted text.
- Created: the shared `SurfaceCard` holding the h2, the text, the shared `InviteLink` (the "Invitation link" box with "Copy link") and "Done"; the board draws the link in an input.
- Forbidden: the same notice as the other screens (h1, one line), with no "Go to projects" button.
- Storybook and `parity.mjs` were not run in the runner pod (no Chromium). The 11 pixel pairs are unchecked: none of them is claimed to match; the pixel check is still to do in a browser.

## Org tenant admin: Projects and setup under the app bar

Spec: `docs/superpowers/specs/2026-11-22-org-tenant-admin-design.md` (UI and Storybook, navigation Option A). Two boards
added, so `parity.mjs` finds 149: ProjectsChecklistDoneSettings, ProjectsEmptyChecklistSettings.

- Projects, ProjectsEmpty, Setup1, Setup1Polling, Setup1PollingOk, Setup2, SetupWorkspace, Setup3, Setup4, SetupReady,
  Runs, RunsProblems, NeedsYou, every RunDetail board (RunStarting to RunRunningAutoResume) and every Desk board: intentional: Option A app bar. The
  story header is the new app bar (org crumb and menu, Projects and Settings tabs or the project tabs); the board still
  draws the older header and is not redrawn. The project-level stories change in Task 21.
- Projects and ProjectsEmpty stories no longer show the "Invitations" header button (Option A, BR-49); the older boards
  still draw it.
- The Setup screens take optional `account` and `org` and pass them to `SetupLayout`; the Setup stories set both, so the story header shows the org crumb, the Projects tab (active) and Settings. The app route does not pass them yet.
- Storybook and `parity.mjs` were not run in the runner pod (no Chromium). The 2 new pixel pairs are unchecked: none is claimed to match.

## Org tenant admin: Invitations inside the settings layout

Spec: `docs/superpowers/specs/2026-11-22-org-tenant-admin-design.md` (UI and Storybook, Invitations). Two boards added, so
`parity.mjs` finds 151: OrgInvitationsSettings, OrgInvitationsSettingsProjectAdmin. Their boards already draw the Option A bar
and the side menu (owner: all four tabs; project admin: Invitations only), so they have no header drift.

- OrgInvitations* (slice-2 drafts): the story renders inside the Settings layout with the Option A bar; the board keeps the old
  global bar and no side menu. Intentional header difference; the table and dialog body below the header must still match.
  Superseded by OrgInvitationsSettings.
- OrgInvitationsForbidden: intentional: Option A app bar. The story shows the no-access notice under the app bar of a member
  (no Settings tab, no side menu), as the Members no-access page does, not inside the layout.
- MyInvitations*, InvitationAccept* and CreateOrg* boards: intentional: Option A app bar. The story header is the new bar (org
  crumb and menu, account menu); MyInvitations and InvitationAccept show the Projects and Settings tabs with none active, and
  CreateOrg shows the org crumb with no tabs. The boards still draw the older header and are not redrawn. The no-organization
  stories show the "No organization" crumb.
- `OrgInvitations` takes optional `user` and `org`; the stories omit both, so the screen draws no top bar. `MyInvitations`,
  `InvitationAccept` and `CreateOrg` take an optional `account`.
- Storybook and `parity.mjs` were not run in the runner pod (no Chromium). The 2 new pixel pairs are unchecked: none is
  claimed to match.

## Org tenant admin: Members list boards

Spec: `docs/superpowers/specs/2026-11-22-org-tenant-admin-design.md` (UI and Storybook, Members). Ten boards added, so
`parity.mjs` finds 161: OrgMembers, OrgMembersAdmin, OrgMembersPaged, OrgMembersEmpty, OrgMembersLoading, OrgMembersError,
OrgMembersForbidden, OrgMembersRowMenu, OrgMembersRowMenuSelf, OrgMembersBusy (`Screens/OrgSettings`). Their boards already draw
the Option A bar and the side menu, so they have no header drift (Forbidden has no side menu and no Settings tab, as the board).

- Table: the shared `DataTable` and `MemberRow`; column widths follow the shared table layout, not the boards' fixed percentages.
- Empty: the shared `EmptyState` as an h2 under the table (the board draws an h3; axe heading-order needs h2 under the h1).
- Loading and error: a labelled busy status of `Skeleton` blocks (no h1) and the shared `RouteLoadError` banner.
- Row menus: the story-only `openMenuUserId` presses that row's Actions button once after mount; `useRowMenu` places the menu
  under the button, where the boards use fixed offsets.
- Storybook and `parity.mjs` were not run in the runner pod (no Chromium). The 10 pixel pairs are unchecked: none is claimed
  to match.

## Org tenant admin: Runs, run detail, needs-you and Desk under the app bar

Spec: `docs/superpowers/specs/2026-11-22-org-tenant-admin-design.md` (UI and Storybook). No board added (`parity.mjs` still
finds the same boards as before). Every story of Runs, RunsProblems, NeedsYou, run detail and Desk now draws the new bar, so the header differs from
the boards on purpose: project level (Runs, RunsProblems, Desk) shows the org crumb and menu, the project crumb, the Runs tab
with the needs-you count, the Desk tab and the account menu; run detail shows org / project / Runs / Run N with no bell;
NeedsYou shows the org bar (Projects and Settings tabs, none current). The content below the header must still match.

- `RunsPage`, `RunDetail` and `DeskFrame` take optional `org` and `account`; `RunDetail` also takes `run` (the Runs link and the
  Run N label); `NeedsYou`'s `topBar` takes optional `org` and `account`. Without them the legacy bar draws (routes keep it until
  Task 26).
- The example tab strip inside the NeedsYou page is a nav named "Runs and Desk tabs, example", so the page has one "Main" nav.
- Storybook and `parity.mjs` were not run in the runner pod (no Chromium). The pixel pairs of these boards are unchecked: none is
  claimed to match.

## Org tenant admin: Members change role and remove boards

Spec: `docs/superpowers/specs/2026-11-22-org-tenant-admin-design.md` (UI and Storybook, Members). Thirteen boards added, so
`parity.mjs` finds 174: OrgMembersChangeRole, OrgMembersChangeRoleAdmin, OrgMembersMakeOwner, OrgMembersStepDown,
OrgMembersChangeRoleSaving, OrgMembersChangeRoleError, OrgMembersLastOwner, OrgMembersRoleChanged, OrgMembersGone,
OrgMembersRemoveConfirm, OrgMembersRemoving, OrgMembersRemoved, OrgMembersRemoveLastOwner (`Screens/OrgSettings`).

- Change-role boards: the shared `ChangeRoleDialog` passed as `children` of `OrgMembers`; MakeOwner, StepDown and LastOwner pick
  the card in a `play` function. LastOwner shows Priya demoted so the caller is the sole owner.
- Remove confirm: `OrgMembers` `removeConfirm` draws a shared `Dialog` (`solid-danger` Remove, as the Invitations revoke dialog).
- Toasts (Role changed, "<name> removed", the two problem titles) use the shared `Toast` through `notice`.
- Storybook and `parity.mjs` were not run in the runner pod (no Chromium). The 13 pixel pairs are unchecked: none is claimed
  to match.

## Org tenant admin: General boards

Spec: `docs/superpowers/specs/2026-11-22-org-tenant-admin-design.md` (UI and Storybook, General). Nine boards added, so
`parity.mjs` finds 183: OrgGeneral, OrgGeneralSaving, OrgGeneralSaved, OrgGeneralFieldErrors, OrgGeneralNameTooLong,
OrgGeneralSlugTaken, OrgGeneralSlugConfirm, OrgGeneralFormError, OrgGeneralForbidden (`Screens/OrgSettings`). The boards were
missing from `canvas.json`; their entries (and order) are added after the Members boards.

- Layout: one shared `SettingsSection` column ("Organization") with `Field`, `TextInput` and `PrefixInput` (`/o/`); Save is the
  shared primary `Button`, disabled until something changed, "Saving…" while busy.
- Slug confirm: a shared `Dialog` opened on "Change URL" (focus moved after the focus trap's own first-button focus).
- Saved: the org crumb shows the new name through `OrgSettingsFrame`'s story-only `orgName`; the toast is the shared `Toast`.
- Forbidden: the project admin's frame (side menu lists only Invitations), the no-access notice inside the layout.
- Storybook and `parity.mjs` were not run in the runner pod (no Chromium). The 9 pixel pairs are unchecked: none is claimed
  to match.

## Org tenant admin: Audit log boards

Spec: `docs/superpowers/specs/2026-11-22-org-tenant-admin-design.md` (UI and Storybook, Audit). Six boards added, so
`parity.mjs` finds 189: OrgAudit, OrgAuditPaged, OrgAuditEmpty, OrgAuditLoading, OrgAuditError, OrgAuditForbidden
(`Screens/OrgSettings`). The boards were missing from `canvas.json`; their entries (and order) are added after the General boards.

- Table: the shared `DataTable` and `AuditRow` (When, Who, What); column widths follow the shared table layout, not the boards'
  fixed percentages.
- Empty, loading and error: as the Members page (`EmptyState` h2 "No activity yet" under the h1, a labelled busy status of
  `Skeleton` blocks with no h1, the shared `RouteLoadError`).
- Forbidden: the project admin's frame (side menu lists only Invitations), the no-access notice inside the layout.
- Storybook and `parity.mjs` were not run in the runner pod (no Chromium). The 6 pixel pairs are unchecked: none is claimed
  to match.

## Platform admin: Platform admins boards

Spec: `docs/superpowers/specs/2026-11-23-platform-admin-dashboard-design.md` (UI and Storybook). Sixteen boards added, so
`parity.mjs` finds 205: PlatformAdmins, PlatformAdminsLoading, PlatformAdminsEmpty, PlatformAdminsError, PlatformAdminsForbidden,
PlatformAdminsPaged, PlatformAdminsAdd, PlatformAdminsAddError, PlatformAdminsAddFieldErrors, PlatformAdminsAddSaving,
PlatformAdminsRevokeConfirm, PlatformAdminsRevokeSelf, PlatformAdminsRevoking, PlatformAdminsLastAdmin (`Screens/Platform`),
ProjectsOrgSwitchAdminPlatform (`Screens/Entry`) and MyInvitationsEmptyPlatformAdminMenu (`Screens/Invitations`). The boards
were missing from `canvas.json`; their entries (and order) are added after the Audit log boards.

- Rows: the stories use the shared fixtures (`platformAdminRows`), so names and emails differ from the boards' sample people;
  the columns, the "Not signed in yet" chip, the "You" chip and the dash cells are the shared `PlatformAdminRow`.
- Paged: page 2 of 2 shows rows 21 to 25 of 25 from the fixture, where the board shows 21 to 23 of 23.
- Empty, loading and error: `EmptyState` h2 "No platform admins" (the board draws an h3), a labelled busy status of `Skeleton`
  blocks with no h1, the shared `RouteLoadError`.
- Forbidden: the bar stays, the side menu is dropped; "Go to projects" is the shared link `Button`.
- Dialogs: the shared `AddPlatformAdminDialog`, and an inline revoke confirm built on the design-system `Dialog` (480px).
- Switcher boards: the open menu shows "Platform admin" above "Create organization" through `OrgSwitch`'s `platformHref`.
- Storybook and `parity.mjs` were not run in the runner pod (no Chromium). The 16 pixel pairs are unchecked: none is claimed
  to match. The interactive prototype (`_tools/build-boards.mjs`) was regenerated and came out unchanged: it already had these boards.

## Platform admin: Organizations directory boards

Spec: `docs/superpowers/specs/2026-11-23-platform-admin-dashboard-design.md` (UI and Storybook). Six boards added, so
`parity.mjs` finds 211: PlatformOrgs, PlatformOrgsLoading, PlatformOrgsEmpty, PlatformOrgsEmptyFiltered, PlatformOrgsError and
PlatformOrgsPaged (`Screens/Platform`). The boards were missing from `canvas.json`; their entries (and order) are added after
the Platform admins boards.

- Rows: the stories use the shared fixtures (`platformOrgRows`), so names and owners differ from the boards' sample orgs; the
  columns, the status chip and the "No owner yet" and "No activity yet" cells are the shared `PlatformOrgRow`.
- Filters: a labelled search box (100 characters) and a status select, shared `TextInput` and `Select`; hidden when the list
  is empty and nothing is filtered, as on the Empty board.
- Empty filtered: "No organizations match" with "Clear filters" as an `EmptyState` h2; the board also keeps the empty table
  header above it, the story does not.
- The table sits in a focusable region that scrolls sideways inside `main` (minimum width 960px).
- Loading and error: a labelled busy status of `Skeleton` blocks with no h1, the shared `RouteLoadError`.
- Storybook and `parity.mjs` were not run in the runner pod (no Chromium). The 6 pixel pairs are unchecked: none is claimed
  to match. The interactive prototype (`_tools/build-boards.mjs`) was regenerated and came out unchanged: it already had these boards.

## Platform admin: org detail Overview, suspend and reactivate boards

Spec: `docs/superpowers/specs/2026-11-23-platform-admin-dashboard-design.md` (UI and Storybook). Ten boards added, so
`parity.mjs` finds 221: PlatformOrgOverview, PlatformOrgOverviewLoading, PlatformOrgOverviewError, PlatformOrgOverviewNotFound,
PlatformOrgOverviewSuspended, PlatformOrgOverviewSuspendDialog, PlatformOrgOverviewSuspendError, PlatformOrgOverviewSuspendFormError,
PlatformOrgOverviewSuspendSaving and PlatformOrgOverviewReactivateDialog (`Screens/Platform`). The boards were missing from
`canvas.json`; their entries (and order) are added after the Directory boards.

- Content: the stories use the shared fixtures (`activeOrgOverview`, `suspendedOrgOverview`), so the org and people names differ
  from the boards' samples. The side menu shows the org group with Overview only (the other tabs land with their own tasks).
- Header: `PlatformOrgHeader` without the Edit organization button; actions are Suspend or Reactivate organization, then the
  View audit log link. The dialogs are the shared `SuspendOrgDialog` with the spec text.
- Suspended: a warning `Banner` with a triangle icon, "Since <date> by <name>. People cannot open it and no new runs start."
  and "Reason: <text>" (text only).
- Not found: an `EmptyState` h2 "Page not found" with "Back to organizations"; loading and error use a busy status of `Skeleton`
  blocks and the shared `RouteLoadError`.
- Storybook and `parity.mjs` were not run in the runner pod (no Chromium). The 10 pixel pairs are unchecked: none is claimed
  to match. The interactive prototype (`_tools/build-boards.mjs`) was regenerated and came out unchanged: it already had these boards.

## Platform admin: suspended organization boards

Spec: `docs/superpowers/specs/2026-11-23-platform-admin-dashboard-design.md` (UI and Storybook). Four boards added, so
`parity.mjs` finds 225: OrgSuspended, OrgSuspendedSwitcher, OrgSuspendedPlatformAdmin (`Screens/Entry`) and
OrgAuditPlatformSuspend (`Screens/OrgSettings`). The boards were missing from `canvas.json`; their entries are added after the
Org detail boards.

- OrgSuspended: top bar with the org name in the switcher and no Projects or Settings tabs, then the fixed title "This
  organization is suspended" and body "You can't open <org> right now. Contact your Agent Desk administrator." No reason, no links.
  The screen takes only `orgName`; the top bar is composed by the story (and later by the route).
- OrgSuspendedSwitcher / OrgSuspendedPlatformAdmin: the switcher is opened by a play step; the suspended org is marked
  "Suspended" and still listed; for the platform admin the menu shows "Platform admin" above "Create organization".
- OrgAuditPlatformSuspend: the shared `OrgAudit` screen with two rows from `platformSuspendAuditRows`, actor tagged
  "Platform admin": "<actor> reactivated the organization" and "<actor> suspended the organization"; no reason text.
- Storybook and `parity.mjs` were not run in the runner pod (no Chromium). The 4 pixel pairs are unchecked: none is claimed
  to match. The interactive prototype (`_tools/build-boards.mjs`) was regenerated and came out unchanged: it already had these boards.

## Platform admin: Edit organization boards

Spec: `docs/superpowers/specs/2026-11-23-platform-admin-dashboard-design.md` (UI and Storybook). Seven boards added, so
`coverage.test.ts` counts 269 (the plan's 225 to 232 counted from a stale base of 189; the repo had 262 before this task):
PlatformOrgEdit, PlatformOrgEditFieldErrors, PlatformOrgEditSlugTaken, PlatformOrgEditSaving, PlatformOrgEditSlugConfirm and
PlatformOrgEditError (`Screens/Platform`), and OrgAuditPlatformEdit (`Screens/OrgSettings`). The boards were missing from
`canvas.json`; their entries are added after the Reactivate dialog board (the six edit boards) and after OrgAuditPlatformSuspend.

- Edit boards: the org detail with the header's Edit organization button and the Overview behind the shared `EditOrgDialog`.
  The URL-change confirm is the shared `SlugChangeConfirm` and replaces the dialog (one modal at a time); the platform copy
  ends "Share the new link with its members." The stories use the shared fixtures, so names differ from the boards' samples.
- OrgAuditPlatformEdit: the shared `OrgAudit` screen with two rows from `platformEditAuditRows`, actor tagged "Platform
  admin": the name change and the URL change with old and new values. The board shows more rows around them; the story keeps
  only the two platform rows.
- Verification (runner pod, headless Chromium from `scripts/runner-env.sh`): `build-storybook` passed; `coverage.test.ts`,
  `stories.smoke.test.tsx` and `platform.test.tsx` passed (1960 tests). `parity.mjs` prints only "N pairs written", no numbers, so
  the pairs were compared by eye. A full `parity.mjs` run did not finish in the pod's memory budget, so the 7 boards were run with
  a temporary copy of the script filtered to them (not committed). OrgAuditPlatformEdit needed one more change in that copy: the
  script derives the id `screens-org-settings--...` but Storybook's id for `Screens/OrgSettings` is `screens-orgsettings--...`, so
  the unmodified script times out on that board (the same applies to every `Screens/OrgSettings` board). The tool is not changed here.
- Result: none of the 7 pairs matches pixel for pixel, so none is claimed to match. The edit dialog and the confirm dialog line up
  with the boards (box position within 1 px, same fields, buttons, errors and copy, except the URL format message, which the board
  words "..., with no dash at the start or end."). What differs, on all six `Screens/Platform` pairs, is the frame around them:
  the story's left menu has no icons, no "Platform admin" or org group headings and no Projects, Members, Invitations links, the
  top bar has no org switcher box, "View audit log" has no clock icon, the owner has no handle, and the sample org differs (Acme vs
  Harbor Labs, by design). The focused input also shows a focus ring that the boards do not, and the Error pair shows the request
  id in the body font where the board uses mono. OrgAuditPlatformEdit has the right two rows, but the board has 10 rows, the side
  menu has no icons and the "Platform admin" tag is plain text, not a bordered pill. The menu and header differences come from the
  shared `platformFrame` and `OrgAudit`, not from this unit's dialogs, so they are left for a separate change.
- Interactive prototype: `canvas.json` gained the 7 board entries (they were missing) and `_tools/build-boards.mjs` was
  regenerated; `design/prototype/interactive/` came out unchanged (it already had these boards). `_checks/nav-check.mjs` was
  run after the fact and passed: "boards checked: 319", "passed 179, failed 0", "console errors: none" (exit 0). The script
  hardcodes a macOS browser path (`$HOME/Library/Caches/ms-playwright/.../chrome-headless-shell-mac-arm64`) and a
  `playwright-core` path, so on this Linux runner it was run unedited with `PW_CORE_DIR` set to the repo's
  `playwright-core` and a temporary `HOME` whose macOS-style path symlinks to the installed Linux headless shell. Its
  screenshots under `_checks/nav/` were discarded, not committed.

## Platform admin: Audit log boards

Spec: `docs/superpowers/specs/2026-11-23-platform-admin-dashboard-design.md` (UI and Storybook). Eight boards added, so
`coverage.test.ts` counts 277 (the plan's 232 to 240 counted from a stale base; the repo had 269 before this task):
PlatformAudit, PlatformAuditLoading, PlatformAuditEmpty, PlatformAuditEmptyFiltered, PlatformAuditError, PlatformAuditPaged,
PlatformAuditOrgChip and PlatformAuditOrgChipUnknown (`Screens/Platform`). The boards were missing from `canvas.json`; the
entries are added after OrgAuditPlatformEdit. `AuditRow` gained an optional `note` (muted "Reason: <text>" under the sentence);
story `AuditRow/WithNote`.

- Screen: `PlatformAudit` with the Action select ("All actions" plus the eleven labels), a removable org chip (button
  "Remove filter <chip text>"), the shared `AuditRow` table, "No audit entries" and "No audit entries match" with "Clear filters",
  loading, error with Retry, and paging. Stories use `platformAuditRows`, `pagedPlatformAuditRows` and `platformAuditActions`.
- Verification (runner pod, headless Chromium from `scripts/runner-env.sh`): `build-storybook` passed; `coverage.test.ts`,
  `stories.smoke.test.tsx`, `platform.test.tsx` and `AuditRow.test.tsx` passed; `pnpm typecheck` passed. `parity.mjs` prints
  only "N pairs written", so the pairs were compared by eye. A temporary copy of the script (not committed) ran the 8 boards
  and the 10 `OrgAudit*` boards (18 pairs written); the copy also rewrote `screens-org-settings--` to `screens-orgsettings--`,
  because the unmodified script builds the id `screens-org-settings--...` for `Screens/OrgSettings` stories while Storybook's
  id is `screens-orgsettings--...`, so the unmodified script times out on those boards. The tool is not changed here.
- Result: none of the 8 pairs matches pixel for pixel, so none is claimed to match. I looked at PlatformAudit, PlatformAuditOrgChip
  and PlatformAuditEmptyFiltered side by side: same rows, order, copy, Reason notes, chip and Clear filters. Differences: the
  frame (the left menu has no icons and no "Platform admin" heading, the top bar has no org switcher box), the When and Who
  column widths (the shared `AuditRow` uses fixed widths, the board 14% and 20%), the URLs in the edit sentence are bold text,
  not mono (`AuditTextPart` has no mono flag), so the long edit row is not cut off with an ellipsis where the board cuts it, the chip's
  close button is a little larger and the note has slightly less space above it. The other five boards were generated but not inspected.
- Interactive prototype: `_tools/build-boards.mjs` was run and `design/prototype/interactive/` came out unchanged (it already
  had these boards). `_checks/nav-check.mjs` was run
  afterwards and passed: "boards checked: 319", "passed 179, failed 0", "console errors: none" (exit 0). The 319 boards are all
  those in `canvas.json`, so the 8 PlatformAudit* boards are included; `js/boards.js` routes every `PlatformAudit*` name to the
  `/platform/audit` view. The script hardcodes a macOS browser path and a `playwright-core` path, so on this Linux runner it was
  run unedited with `PW_CORE_DIR` set to the repo's `playwright-core` and a temporary `HOME` (outside the repo) whose
  macOS-style path symlinks to the installed Linux headless shell. Its screenshots under `_checks/nav/` were discarded.

## Platform admin: org Projects and Members boards

Spec: `docs/superpowers/specs/2026-11-23-platform-admin-dashboard-design.md` (UI and Storybook). Fourteen boards added, so
`coverage.test.ts` counts 291 (277 before this task): PlatformOrgProjects, …Loading, …Empty, …Error, …Paged and PlatformOrgMembers,
…Loading, …Empty, …Error, …Paged, …RowMenu, …AddAssignment, …RemoveConfirm, …Removing (`Screens/Platform`). The boards were missing
from `canvas.json`; the entries are added after PlatformAuditOrgChipUnknown (the titles come from `interactive/data/boards.js`).

- Screens: `PlatformOrgProjects` (h2 "Projects", Id and Name table, "No projects") and `PlatformOrgMembers` (h2 "Members", the muted
  "Platform view: names and emails only. Tickets, runs and secrets are never shown here.", the row menu, "No members", the
  `AssignmentDialog` and the remove confirm "Remove <role> from <name>?" with Cancel and Remove/Removing…). Both render inside
  `PlatformOrgDetail` as its children, under the org header, and share `ListView` (loading, error with Retry, ready with paging).
- The remove confirm has no body text, as in the boards. Stories use the Acme fixtures (`platformProjectRows`, `platformMemberRows`), not
  the boards' Harbor Labs rows.
- Verification: `platform.test.tsx`, `coverage.test.ts` and `stories.smoke.test.tsx` (platform stories, with axe) passed;
  `_tools/build-boards.mjs` left `design/prototype/interactive/` unchanged (it already had these boards). `build-storybook`,
  `parity.mjs` and the side-by-side comparison were not run here, so no board is claimed to match pixel for pixel.

## Platform admin: org Invitations boards

Spec: `docs/superpowers/specs/2026-11-23-platform-admin-dashboard-design.md` (UI and Storybook). Eight boards added, so
`coverage.test.ts` counts 299 (291 before this task): PlatformOrgInvitations, …Loading, …Empty, …Error, …Paged, …Invite, …Resending,
…CopyFailed (`Screens/Platform`). The boards were missing from `canvas.json`; the entries are added after PlatformOrgMembersRemoving
(the titles come from `interactive/data/boards.js`).

- Screen: `PlatformOrgInvitations` (h2 "Invitations" with "Invite people", the muted platform-view note, the status chips Pending,
  Accepted, Declined, Revoked, Expired, All, the seven-column table of `InvitationRow`, "No invitations" with "Invite people",
  paging) renders inside `PlatformOrgDetail` as its children and shares `ListView`. The invite dialog and the "Invitation link" dialog
  are slots (`inviteDialog`, `linkDialog`); `copyFailed` shows the error toast "Could not copy. Select the link and copy it.".
- `rowActions(row)` returns the `onCopy`, `onResend` and `onRevoke` handlers of one row, because `InvitationRow` owns its menu.
- Stories use the Acme fixtures (`orgInvitationRows`, `pagedInvitationRows`), not the boards' Harbor Labs rows. The Invite story offers
  Owner (`inviteRoleOptions.owner`), as the board does.
- Verification: `platform.test.tsx`, `coverage.test.ts` and `stories.smoke.test.tsx` (platform stories, with axe) passed;
  `_tools/build-boards.mjs` left `design/prototype/interactive/` unchanged. `build-storybook`, `parity.mjs` and the side-by-side
  comparison were not run here, so no board is claimed to match pixel for pixel.

## Project admin space: Desk side menu and DeskAgentProjectAdmin

Spec: `docs/superpowers/specs/2026-11-23-rbac-project-admin-space-design.md` (UI and Storybook). One board added, so
`parity.mjs` finds 190: DeskAgentProjectAdmin (`Screens/Desk`), Lee Park as signed-in project admin, no Danger zone.

- Redrawn side menus: the shared `deskFrame` story frame now passes the Members and Audit log links, so every Desk story
  shows the "Access" group after "Agent & settings". The DeskSetupEnvironment* stories are not in the repo yet, so the two
  read-only ones are not touched here.
- Intentional: the existing Desk board stories draw the Access group (human answer "1"); `DeskLayout` hides an item whose link
  is not set, and the whole group when neither is.
- Storybook and `parity.mjs` were not run here (no Chromium within the memory headroom). The new pixel pair is unchecked:
  none is claimed to match.

## Project admin space: project and org Audit log boards

Spec: `docs/superpowers/specs/2026-11-23-rbac-project-admin-space-design.md` (UI and Storybook, Audit log). Nine boards added,
so `parity.mjs` finds 199: DeskAudit, DeskAuditLoading, DeskAuditEmpty, DeskAuditError, DeskAuditPaged,
DeskAuditInvitationNoEmail, DeskAuditInvitationExpired (`Screens/Desk`), OrgAuditInvitationProjects and
OrgAuditInvitationNoEmail (`Screens/OrgSettings`). Their `canvas.json` entries sit after DeskAgentProjectAdmin and OrgAuditForbidden.

- Table and states: as the org Audit log (shared `DataTable` and `AuditRow`, `EmptyState` "No activity yet", labelled busy
  status, shared `RouteLoadError`), inside the Desk frame with the Audit log item current.
- OrgAudit*: intentional: invitation sentences name projects (at most 3, then "and N more"; the title keeps the full list).
- Storybook and `parity.mjs` were not run in the runner pod (no Chromium, low RAM). The 9 pixel pairs are unchecked: none is
  claimed to match.

## Org Members: access by scope and Change access (#259)

Ticket: haicanhdieu/agent-desk#259. Three boards added, so `parity.mjs` finds 285 boards in `canvas.json`:
OrgMembersManyGrants, OrgMembersChangeAccessMany, OrgMembersChangeAccessEmpty (`Screens/OrgSettings`). The Members table has
three columns now (Name, Access, Actions): the Role and Project roles columns became one Access column of chips, one per grant
(`Organization · Admin`, `<project> · Member`, `No role` first when there is no org grant). Every `OrgMembers*` board was redrawn
for the new cell, the Change role boards became Change access (title, Save access, a Project access section), and the row menu
item reads "Change access".

- Chips wrap onto more lines (no ellipsis, no "+N more"), so no grant is hidden. The boards draw them as `.lbl` pills in a flex-wrap list.
- Change access: the org Role cards, then a Project access group: one row per project grant (name, role select Admin / Member /
  Viewer, remove button) or "No project access.", and an Add project row (project select, role select, Add project). The shared
  `ChangeRoleDialog` shows the section only when it gets `projectAccess`; the project Members page passes none and keeps
  "Change role" / "Save role".
- Intentional: the story fixtures name their people as in the earlier Members stories (Alice, Cleo, Dana); the boards keep the
  prototype's own cast (Kim Hale, Mira Chen). The new boards use Fatima Zahra (eight project grants) and ari-k (no grants).
- Intentional: the dialog body of the story scrolls inside the dialog (`max-height: calc(100vh - 220px)`) when the Project
  access rows outgrow a short window; the static boards do not scroll.
- Table widths: the boards draw 34% / rest / 56px; the shared `DataTable` lays the columns out itself (as in the other Members boards).
- The interactive prototype (`design/prototype/interactive/`) was regenerated with `_tools/build-boards.mjs` (322 boards) and its live
  Members screen now has the Access column and a working Change access dialog (add, change, remove, audit entries). `_checks/nav-check.mjs`
  was run unchanged in the runner pod after the last regeneration, with `PW_CORE_DIR` set and a scratch `HOME` whose macOS-style browser path
  links to the installed Linux headless shell: 322 boards checked, 179 checks passed, 0 failed, no console errors. The `_checks/nav/`
  screenshots it rewrote were not committed, so they are unchanged.
- Storybook parity was run in the runner pod (`build-storybook`, then `parity.mjs` with Chromium 158 from `runner-setup.sh` profile `full`).
  `parity.mjs` built the story id from the title with a camelCase split, so every `Screens/OrgSettings` board timed out (the Storybook id is
  `screens-orgsettings--...`); it now lowercases the title without splitting. After that fix only the 26 `OrgMembers*` pairs (23 redrawn and
  the 3 new) were rendered and compared, by eye; the other boards were not re-run in this pass. Result:
  - Fixed: `OrgMembersRowMenu` and `OrgMembersRowMenuSelf` had lost one row and the open row menu, and had Actions labels shifted onto the wrong
    row. They now have 8 rows, the open menu (Change access and Remove from organization; own row: Change access only) and matching labels.
  - Compared and matching in layout: the Access column with chips, the Change access title and Save access, the Project access rows, the Add
    project row, and "No project access." on the empty board.
  - Remaining differences, none claimed to match pixel for pixel. Each has a reason (frontend.md §8):
    - Story cast (Alice, Cleo, Dana, Fatima) against board cast (Kim Hale, Mira Chen, ari-k): intentional state difference.
    - The board dialog body overflows the 900px window while the story scrolls it inside the dialog: intentional state difference (see above).
    - The story page content and dialog body sit 2px to 8px further in than the board: not fixed; it comes from the shared
      `OrgSettingsLayout` and `Dialog`, which this PR does not change (the same kind of 1 to 8px layout drift is recorded for other boards above).
    - The story has no sidebar icons: not fixed; shared `OrgSettingsLayout`, not changed here.
    - The story shows no menu on the caller's own row, while the `RowMenuSelf` board draws one: not fixed; the board already drew an
      own-row menu on `main` ("Change role" on Kim Hale's row), and the own-row rule is not changed here.
