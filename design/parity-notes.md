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
