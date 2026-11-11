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
- Find button `aria-label="Search scrollback"`: the accessible name does not contain the visible text "Find" (WCAG 2.5.3 label-in-name). Known minor, flagged for the human to decide.
- RadioCard "Preview" link sits inside the `<label>`: nested interactive content. Known minor, tracked, not fixed.

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
