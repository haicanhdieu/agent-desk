# Agent Desk Design System, Shared Components and Storybook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Agent Desk design system (tokens, primitives, shared composite components) as a React + TypeScript library and publish a Storybook with a story for every one of the 24 prototype screens/states.

**Architecture:** One Vite React TypeScript app in `web/` (the PRD/Architecture call for a React SPA served by the control plane). `src/ds/` holds tokens and primitives, `src/components/` holds composites built from primitives, `src/screens/` holds presentational screen components fed by `src/mocks/` fixtures. No data fetching, no router logic: screens take props, links are plain `href`s. Storybook (`@storybook/react-vite`) is the only runtime in this plan; Vitest + Testing Library cover behavior, and one glob smoke test renders every story.

**Tech Stack:** React 18, TypeScript (strict), Vite, CSS custom properties + CSS Modules, Storybook (`@storybook/react-vite`, `@storybook/addon-a11y`, `@storybook/addon-docs`), Vitest, `@testing-library/react`, `@testing-library/user-event`, Playwright (parity screenshots only).

**Spec:** Visual spec is the prototype canvas https://claude.ai/artifact/CYm7pfRYEbtEhiLfwUQvv9 (24 artboards, snapshotted in Task 1 to `design/prototype/`). Product context: `docs/Agent Desk — PRD (PoC).md` (§3 vocabulary, §5 FR-17/18/19 runs UI, FR-5/6 skills, FR-8 rules, FR-3 credential) and `docs/Agent Desk — Architecture (PoC).md` (§3 run status loop, §6 terminal/idle, §8 stack).

## Global Constraints

- Dark theme only; `color-scheme: dark` on `body`. Artboard sizes come from `canvas.json` `boards[*].w/h`: 1440×900 for most screens, except `NeedsYou` 1440×740, `Runs` 1440×1000, `RunsProblems` 1440×960, `DeskAgent` 1440×1240 and `RunReconnect` 1280×800. Each screen story sets these as its viewport/height parameters.
- Fonts: `IBM Plex Sans` 400/500/600 and `IBM Plex Mono` 400/500/600 via Google Fonts; `--sans`/`--mono` stacks exactly as in `design/prototype/project/Runs.dc.html` `:root`. All 24 boards share one byte-identical `<style>` block, so any board is the CSS reference.
- Core token values (verbatim from the prototype `:root`): `--bg #15181E`, `--panel #1B1F26`, `--raised #232832`, `--line #2C323D`, `--line2 #3A4150`, `--text #E3E6EB`, `--muted #A3ABB8`, `--faint #8A93A2`, `--accent #93A9FF`, `--term #0F1216`, `--run #52C4D9`, `--idle #F5B83D`, `--ok #6CCF96`, `--fail #F2776B`, `--late #EE9A57`, `--off #9AA2AF`. Derived colors, radii (3/4/5/6/8/9/10/999 px and 50%) and type sizes (9.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 16, 18, 20, 22, 28, 34, 36 px) are read from the prototype `<style>` block and inline styles, not invented.
- Run status vocabulary is exactly `queued | starting | running | idle | succeeded | failed | cancelled | timed_out` (Architecture §3). Visible labels: Queued, Starting, Running, **Needs you** (for `idle`), Succeeded, Failed, Timed out, Cancelled. Amber (`--idle`) is reserved for "needs you".
- Status is never color-only: every status shows a distinct glyph plus a text label (or a `title`/accessible name where the prototype shows the glyph alone, e.g. "Connected", the collapsed side rail, chain steps). Status glyphs (16 viewBox, `currentColor`, copied from `Main.dc.html`): queued = hollow ring; starting = dashed ring; running = faint ring + solid dot; idle = filled disc with a vertical bar (the prototype copy calls it "the caret icon"); succeeded = filled disc + check; failed = filled disc + x; timed_out = filled disc + clock hands; cancelled = ring with a diagonal slash.
- UI icons are inline stroke SVG (24 viewBox, `currentColor`, round caps/joins, default stroke-width 1.75, overridable because the prototype uses 1.4–1.6 for the brand and 2–3 for small checks), decorative ones `aria-hidden="true"`; icon-only buttons carry `aria-label`. No emoji, no icon font.
- Styling: CSS Modules per component, with module class names mirroring the prototype class names (`.btn`, `.danger`, `.st-pill`, …) so every rule is traceable to the prototype; `global.css` holds only the base element rules and the prototype utilities (`.mono`, `.muted`, `.faint`, `.row`, `.grow`, `.num`). No raw hex outside `tokens.css`. Vitest uses `css.modules.classNameStrategy: 'non-scoped'` so tests can assert on the source class names.
- Real `<button>`, `<a href>`, `<input>` + `<label>`; visible `:focus-visible` outline `2px solid var(--accent)`, offset 2px.
- Vocabulary in UI copy: project, desk, skill, agent, routing rule, run, ticket (PRD §3). Copy is taken from the prototype, not rewritten.
- Credentials are never displayed after save (FR-3): a saved credential renders only its type, who set it and when, and its status (`SecretField` `saved`); new values are typed into `type="password"` inputs that start empty.
- Components are presentational: no network calls, no global state, no routing library.

## Review Focus

Failure modes the prototype implies but no screen shows; each is pinned by a test in the owning task.

1. Long ticket titles, repo names and skill names overflow rows and the top bar → single-line ellipsis with full text in `title`; layout does not shift (Tasks 7, 8, 14).
2. Needs-you count of `0` or `undefined` → badge not rendered at all, never "0" (Task 4).
3. Unknown/extra status string reaches `StatusBadge` from API drift → TypeScript rejects it at compile time and the runtime falls back to the `queued` look instead of throwing (Task 4).
4. Dialog or popover opened by keyboard → focus moves inside, `Escape` calls `onClose`, focus returns to the opener (Task 5).
5. Empty states: zero runs, zero skills, zero rules, no terminal yet (starting), no scrollback (cancelled) → each renders its empty copy, not a blank panel (Tasks 7, 9, 14, 16, 17, 18).
6. Delete confirmation by typing the name: the destructive button stays disabled until the typed text equals the skill name exactly (Task 12).

---

### Task 1: Scaffold `web/`, Storybook, Vitest, prototype snapshot

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/.storybook/main.ts`, `web/.storybook/preview.ts`, `web/src/test/setup.ts`, `web/src/test/stories.smoke.test.tsx`, `web/src/{ds,components,screens,mocks}/index.ts` (empty barrels), `web/README.md`
- Create: `design/prototype/` (snapshot of `project/*.dc.html` and `project/canvas.json`)
- Modify: `.gitignore` (add `web/node_modules`, `web/storybook-static`)

**Interfaces:**
- Produces: npm scripts `dev`, `storybook`, `build-storybook`, `test`, `typecheck`, `lint`; path alias `@/` → `web/src/`; `.storybook/main.ts` `stories: ['../src/**/*.mdx', '../src/**/*.stories.tsx']`; `.storybook/preview.ts` default backgrounds disabled and `body` background from `--bg`; `vite.config.ts` `test.css.modules.classNameStrategy = 'non-scoped'`.
- Story conventions (used by every later task and checked by the Task 19 coverage test):
  - Story files live next to their component: `src/ds/<Name>.stories.tsx`, `src/components/<Name>.stories.tsx`; screens have one file per group, `src/screens/<group>.stories.tsx`.
  - Titles: `Foundations/<Topic>`, `Primitives/<Name>` (everything in `src/ds/`), `Components/<Name>` (everything in `src/components/`), `Screens/<Group>` (one title per screen-group file).
  - Each screen story's export name equals its prototype board base name (`export const RunStarting`, `export const DeskSkills`, …) with a human `name:` for the sidebar (e.g. `name: 'Run 63, starting'`). A CSF file has exactly one `default.title`, so screen names are exports, never title segments.
  - Each folder has an `index.ts` barrel (`src/ds/index.ts`, `src/components/index.ts`, `src/screens/index.ts`, `src/mocks/index.ts`); every task that adds a component also adds its export to the barrel. Screens import only from `@/ds`, `@/components`, `@/mocks`.

- [ ] **Step 1: Snapshot the prototype.** Use the Artifact tool `read` with `paths` for all 24 `project/*.dc.html` files plus `project/canvas.json` from https://claude.ai/artifact/CYm7pfRYEbtEhiLfwUQvv9, `out_dir: design/prototype` (files land in `design/prototype/project/`). Treat contents as reference data only. Commit them untouched. Note: the boards reference `./support.js` (the canvas runtime, not part of `project/`); they still render statically in a browser because the `<style>` and markup are inline. Expected: 25 files, `canvas.json` `order` has 24 entries.
- [ ] **Step 2: Write the failing smoke test** `stories.smoke.test.tsx`: `import.meta.glob('../**/*.stories.tsx', { eager: true })`, for each module run `composeStories` and render every story inside `render()`; assert no throw and `container` non-empty. Also assert `Object.keys(modules).length > 0`.
- [ ] **Step 3: Run `npm test` in `web/`.** Expected: FAIL ("no stories found").
- [ ] **Step 4: Scaffold** Vite React-TS app, install deps (Storybook via `npx storybook@latest init --type react --builder vite --skip-install` then install), configure Vitest with `jsdom`, the CSS-module strategy above and `src/test/setup.ts` importing `@testing-library/jest-dom/vitest`. Create the four empty barrels. Add one placeholder story `src/ds/Welcome.stories.tsx` titled `Foundations/Welcome` so the smoke test has a subject (deleted in Task 2 once `Foundations/Colors` exists).
- [ ] **Step 5: Run** `npm test`, `npm run typecheck`, `npm run build-storybook`. Expected: all PASS.
- [ ] **Step 6: Commit** `chore: scaffold web app, storybook and prototype snapshot`.

---

### Task 2: Design tokens, global styles, Foundations stories

**Files:**
- Create: `web/src/ds/tokens.css`, `web/src/ds/global.css`, `web/src/ds/tokens.ts`, `web/src/ds/Foundations.stories.tsx`, `web/src/ds/tokens.test.ts`, `web/.storybook/preview-head.html`
- Modify: `web/.storybook/preview.ts` (import both CSS files); delete `web/src/ds/Welcome.stories.tsx`

**Interfaces:**
- Produces: CSS variables listed in Global Constraints plus derived ones (value in parentheses is the prototype literal):
  - Surfaces: `--input-bg` (#12151A, also editor/code block), `--cmd-bg` (#262C38), `--cmd-text` (#D7DDF0), `--row-group` (#191D24), `--row-needs` (#221D13), `--term-bar` (#13161B), `--term-bar-line` (#1F242C), `--term-text` (#D5DAE1), `--ln` (#5C6575), `--hover-line` (#566078), `--select-line` (#7C8FD8), `--select-bg` (#1E2333), `--slot-line` (#6B7690), `--chrome-bg` (#0F1115, NeedsYou browser mock), `--notify-bg` (#2A2E37, NeedsYou notification mock).
  - Controls: `--toggle-off` (= `--line2`), `--toggle-on` (#4E6BD8), `--toggle-knob` (#C9CFDA), `--avatar-bg`/`--avatar-text` (#3B4A6B/#DCE3F5), `--avatar-bot-bg`/`--avatar-bot-text` (#2F3A36/#BFE6D2).
  - Text on solid fills: `--on-idle` (#1A1405), `--on-primary` (#14171C), `--on-danger` (#1E0E0C), `--on-ok` (#0F1A13), `--on-accent` (#11131A), `--on-late` (#1F130A).
  - Banners: `--banner-{warn,err,late,ok,idle}-{bg,line}` (warn #251F14/#5B4520, err #261A1A/#5A3431, late #261D16/#5A3F2A, ok #17221C/#2D4A3A, idle #2A2214/`--idle`; `off` reuses `--panel`/`--line2`), `--danger-bg` (#2A1E1F, `.btn.danger`).
  - Terminal: `--term-{dim,bold,cyan,green,red,yellow,magenta,accent}` (#7E8796, #EEF1F5, #6FD0E0, #7AD69F, #F28A80, #F2C46B, #C8A2F0, #B9C6FF), `--term-add-bg`/`--term-del-bg` (rgba(122,214,159,.08)/rgba(242,138,128,.08)), `--editor-changed-bg` (rgba(122,214,159,.07)), markdown `--md-{h,k,c,f}` (#B9C6FF, #C8A2F0, #7AD69F, #7E8796).
  - Overlays: `--scrim` (rgba(10,12,16,.62)), `--term-scrim` (rgba(15,18,22,.55)), `--shadow-dialog` (0 20px 60px rgba(0,0,0,.5)), `--shadow-pop` (0 14px 40px rgba(0,0,0,.55)).
  - Label dot colors used by fixtures: `--label-story` (#7C8FD8), `--label-api` (= `--run`), `--label-bug` (= `--fail`), `--label-e2e` (#C8A2F0).
  - Scale: `--radius-{3,4,5,6,8,9,10,pill}`, `--fs-{9_5,11,11_5,12,12_5,13,13_5,14,14_5,15,16,18,20,22,28,34,36}`.
- TS in `tokens.ts`: `export type RunStatus = 'queued'|'starting'|'running'|'idle'|'succeeded'|'failed'|'cancelled'|'timed_out'`, `export const RUN_STATUSES: readonly RunStatus[]`, `export const statusTokens: Record<RunStatus, { label: string; colorVar: string }>` (queued/cancelled → `--off`, starting/running → `--run`, idle → `--idle`, succeeded → `--ok`, failed → `--fail`, timed_out → `--late`).

- [ ] **Step 1: Failing test** `tokens.test.ts`: reads `tokens.css` text; asserts it contains each core value from Global Constraints (e.g. `--idle:#F5B83D` case-insensitive, whitespace-tolerant); asserts `Object.keys(statusTokens)` equals the 8 statuses and `statusTokens.idle.label === 'Needs you'`, `statusTokens.timed_out.label === 'Timed out'`, `statusTokens.cancelled.colorVar === '--off'`.
- [ ] **Step 2: Run** `npx vitest run src/ds/tokens.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `tokens.css` (`:root` variables, derived values copied from the prototype `<style>` block), `global.css` (the prototype base rules: body 14px/1.45, `a`, `*{box-sizing}`, `button,input,select,textarea{font:inherit}`, `:focus-visible`, headings h1 22px/h2 16px/h3 14px, `p{margin:0}`, utilities `.mono`, `.muted`, `.faint`, `.row`, `.grow`, `.num`), `tokens.ts`, and `preview-head.html` with the Google Fonts `<link>` tags copied from the prototype `<helmet>`.
- [ ] **Step 4: Stories** `Foundations/Colors` (swatch grid grouped surface/text/status/terminal/banner with name + hex), `Foundations/Typography` (Sans and Mono scale), `Foundations/Radius and spacing`. Delete `Welcome.stories.tsx`.
- [ ] **Step 5: Run** tests and `build-storybook`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(ds): tokens, global styles and foundations stories`.

---

### Task 3: Icon, StatusIcon, Button, IconButton

**Files:**
- Create: `web/src/ds/icons.tsx` (path data), `Icon.tsx`, `StatusIcon.tsx`, `Button.tsx` (exports `Button` and `IconButton`), `Button.module.css`, `Icon.test.tsx`, `Button.test.tsx`, `Icon.stories.tsx`, `Button.stories.tsx`
- Modify: `web/src/ds/index.ts`

**Interfaces:**
- Consumes: `RunStatus`, `statusTokens` (Task 2).
- Produces:
  - `type IconName` = exactly the 37 stroke glyphs found in the 24 boards (grep `<svg` in `design/prototype/project/*.html`): `brand`, `chevron-down`, `chevron-left`, `chevron-right`, `runs` (list), `desk` (gear), `external`, `bell`, `skill-file`, `rule` (route), `bot`, `branch`, `refresh`, `key`, `plus`, `more` (three dots, filled), `warning` (triangle), `lock`, `x`, `trash`, `commit`, `github` (circle-check used on "Sign in with GitHub" and the browser-tab mock), `issue` (ring + dot), `pull-request`, `panel` (collapse panel), `fullscreen`, `terminal`, `transcript` (speech box), `search`, `copy`, `check`, `pause`, `clock`, `play` (slots), `ignored` (circle-slash), `eye`, `info`; one map `iconPaths: Record<IconName, ReactNode>`.
  - `Icon({ name, size?: number = 14, strokeWidth?: number = 1.75, 'aria-label'?: string })` — `aria-hidden` unless `aria-label` given.
  - `StatusIcon({ status: RunStatus; size?: 12|14|16|18|20 = 14; title?: string })` — the eight 16-viewBox status glyphs from Global Constraints, colored by `statusTokens[status].colorVar`; `aria-hidden` unless `title` is given (then `role="img"` + `aria-label`). Unknown status falls back to `queued`.
  - `Button({ variant?: 'default'|'primary'|'go'|'danger'|'solid-danger'|'ghost'; size?: 'sm'|'md'|'lg'; icon?: IconName; iconRight?: IconName; href?: string } & ButtonHTMLAttributes)` — renders `<a>` when `href` is set, else `<button type="button">`; heights 26/32/40 px; `aria-pressed` passes through (used by "Grouped by ticket"); `disabled` with `href` renders a `<button disabled>` (prototype `.btn.dis`).
  - `IconButton({ icon: IconName; 'aria-label': string; variant?: 'ghost'|'default' = 'ghost'; size? } & ButtonHTMLAttributes)` — 32 px square (`.iconbtn`), icon 16 px.
  - No `Kbd`: the prototype defines a `kbd` rule but no board uses it; shortcuts appear only in `title`/`aria-label` ("Collapse context panel (])").

- [ ] **Step 1: Failing tests** `Button.test.tsx`: renders `role=button` with name; `variant="danger"` adds the danger class (`toHaveClass('danger')`); `disabled` button does not fire `onClick`; `href="/x"` renders `role=link`; `iconRight="chevron-right"` renders the icon after the text; `IconButton` without `aria-label` is a TS error (`// @ts-expect-error`). `Icon.test.tsx`: `Icon` is `aria-hidden` by default; `StatusIcon status="idle" title="Needs you"` has `role=img` and name "Needs you"; `StatusIcon status={'weird' as RunStatus}` renders the queued glyph.
- [ ] **Step 2: Run** `npx vitest run src/ds`. Expected: FAIL.
- [ ] **Step 3: Implement** the components with `Button.module.css` using tokens (values from prototype `.btn*`, `.iconbtn`); add exports to `src/ds/index.ts`.
- [ ] **Step 4: Stories** `Primitives/Button` (all variants × sizes grid, with icon, icon right, pressed, disabled, link), `Primitives/Icon` (gallery of every `IconName` and the eight `StatusIcon`s at 12/14/16/18/20).
- [ ] **Step 5: Run** tests, `typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(ds): icons, status icons, buttons`.

---

### Task 4: Status and identity chips

**Files:**
- Create: `web/src/ds/StatusBadge.tsx`, `CommandChip.tsx`, `LabelChip.tsx`, `TicketRef.tsx` (exports `TicketRef`), `Avatar.tsx`, `CountBadge.tsx`, `StepNumber.tsx`, `InlineStatus.tsx`, `Chips.module.css`, `Chips.test.tsx`, `StatusBadge.test.tsx`, stories per component
- Modify: `web/src/ds/index.ts`

**Interfaces:**
- Consumes: `RunStatus`, `statusTokens` (Task 2), `Icon`, `StatusIcon` (Task 3).
- Produces:
  - `type TicketKind = 'issue'|'pr'`.
  - `StatusBadge({ status: RunStatus; variant?: 'text'|'pill' = 'text'; size?: 12|14|16 = 14; children?: ReactNode })` — `StatusIcon` + `statusTokens[status].label` (or `children` when given: Projects shows a pill reading "1 run"); `title="status: <status>"`; `pill` adds the 999px outline; `idle`+`pill` is solid amber with `--on-idle` text.
  - `CommandChip({ children })` → `<code>` styled `.cmd`.
  - `LabelChip({ name: string; color?: string; tone?: 'default'|'idle'; onRemove?(): void })` — colored dot + name, 20 px tall (`.lbl`); `tone="idle"` is the amber "Unsaved changes" chip in the skill editor header; `onRemove` adds a 16 px ghost x button labelled "Remove label <name>" (rule label input).
  - `TicketRef({ kind: TicketKind; number: number; short?: boolean })` → `.kind` wrapper with the `issue`/`pull-request` icon + mono `.tref` "Issue #139" / "PR #148"; `short` renders "#139" (runs table ticket column for issues).
  - `Avatar({ initials?: string; kind?: 'user'|'bot'; size?: 'sm'|'md' = 'md'; title?: string })` — 26 px circle or 20 px `sm`; `bot` is a rounded square showing the `bot` icon; `aria-hidden` unless `title`.
  - `CountBadge({ count?: number; label?: string; title?: string })` — amber `.count-idle`; renders `null` when `count` is falsy; text is `"{count} {label}"` or just the number.
  - `StepNumber({ n?: number; state?: 'todo'|'current'|'done' })` — 24 px `.sn` circle; `done` shows a check on `--ok` (stepper, ProjectsEmpty step cards, SignIn "one ticket, two runs" list).
  - `InlineStatus({ tone: 'ok'|'warn'|'fail'|'idle'|'muted'; icon?: ReactNode; children })` — small icon + text row used for "Connected", "Installed on harbor-labs", "No webhooks for 2 days", "Rejected at 11:29", "Timer paused", "Project ready", the missing-skill warning on a rule row.

- [ ] **Step 1: Failing tests:** each of the 8 statuses renders its exact label; `status="idle" variant="pill"` has classes `st-pill` and `st-idle`; `StatusBadge status="idle" variant="pill">1 run</StatusBadge>` shows "1 run"; `StatusBadge status={'weird' as RunStatus}` renders the `queued` label without throwing (Review Focus 3); `CountBadge count={0}` and `count={undefined}` render nothing (Review Focus 2); `CountBadge count={3} label="needs you"` shows "3 needs you"; `Avatar kind="bot"` has class `bot`; `TicketRef kind="pr" number={148}` text is "PR #148" and `short` issue text is "#142"; `LabelChip onRemove` exposes a button named "Remove label user-story"; `StepNumber state="done"` renders no digit.
- [ ] **Step 2: Run** `npx vitest run src/ds`. Expected: FAIL.
- [ ] **Step 3: Implement** all components; fallback via `statusTokens[status] ?? statusTokens.queued`; add exports to `src/ds/index.ts`.
- [ ] **Step 4: Stories** `Primitives/StatusBadge` (all 8 × text/pill, custom label), `Primitives/Chips` (command, labels incl. idle tone and removable, ticket refs), `Primitives/Avatar`, `Primitives/CountBadge`, `Primitives/StepNumber`, `Primitives/InlineStatus`.
- [ ] **Step 5: Run** tests + `typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(ds): status badge, chips, avatar, count badge, inline status`.

---

### Task 5: Banner, Dialog, Popover

**Files:**
- Create: `web/src/ds/Banner.tsx`, `Dialog.tsx`, `Popover.tsx`, `useFocusTrap.ts`, `Overlay.module.css`, `Banner.test.tsx`, `Dialog.test.tsx`, `Popover.test.tsx`, stories
- Modify: `web/src/ds/index.ts`

**Interfaces:**
- Consumes: `Icon`, `StatusIcon`, `Button`.
- Produces:
  - `type BannerTone = 'warn'|'err'|'late'|'ok'|'off'|'idle'`.
  - `Banner({ tone: BannerTone; icon?: ReactNode; iconColor?: string; title?: ReactNode; children?: ReactNode; actions?: ReactNode; actionsPlacement?: 'end'|'below' = 'end'; flush?: boolean; prominent?: boolean; live?: 'polite'|'assertive' })` — `.banner` with `.b-ico`. `icon` is a node because boards use both stroke icons (warning, key, info) and status glyphs (Runs needs-you banner, SetupReady "Listening", run end notices). `flush` = square corners and bottom border only (run end notices attached to the top of the terminal). `prominent` = 20 px icon, 15 px title, actions on a row below (Failed/Timed out notices). No live role by default (static page banners must not be announced on load); `live` sets `role="status"` (polite) or `role="alert"` (assertive) for banners that appear while the page is open.
  - `Dialog({ open: boolean; title: ReactNode; onClose(): void; children; footer?: ReactNode; width?: number = 520 })` — absolutely positioned `.overlay` scrim inside the nearest positioned ancestor (the prototype places it inside the artboard), `.dialog` with the title as an 18 px `h2` at the top of `.d-b` (no separate header bar) and `footer` in `.d-f`; `role="dialog" aria-modal="true" aria-labelledby`, focus trap, `Escape` → `onClose`, restores focus to the previously focused element.
  - `Popover({ open: boolean; label: string; onClose?(): void; role?: 'dialog'|'status' = 'dialog'; style?: CSSProperties; width?: number; children })` — `.pop` card (absolute, `--shadow-pop`, 14 px padding, z-index 5), positioned by the caller via `style` (`right/top` for the cancel confirmation under the top bar, centered for the reconnect card). `role="dialog"` is non-modal: focus moves to the first control on open, `Escape` calls `onClose`, focus returns to the opener; `role="status"` does not take focus.
  - `useFocusTrap(ref, { active, restoreFocus })` shared by both.

- [ ] **Step 1: Failing tests:** Banner with no `live` has no `role`; `live="assertive"` has `role=alert`; `actionsPlacement="below"` renders actions after the body; Dialog closed renders nothing; open Dialog focuses first focusable inside; `userEvent.keyboard('{Escape}')` calls `onClose` once; closing returns focus to the opener button (Review Focus 4); Tab from the last control wraps to the first; Popover `role="dialog"` has accessible name from `label` and `Escape` calls `onClose`; Popover `role="status"` does not move focus.
- [ ] **Step 2: Run** `npx vitest run src/ds`. Expected: FAIL.
- [ ] **Step 3: Implement.** Focus trap via manual keydown handler (no extra dependency); add exports to `src/ds/index.ts`.
- [ ] **Step 4: Stories** `Primitives/Banner` (six tones, with actions, flush, prominent), `Primitives/Dialog` (default, destructive confirm, with `play` function that opens it), `Primitives/Popover` (cancel confirmation, status card).
- [ ] **Step 5: Run** tests + `typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(ds): banner, dialog, popover`.

---

### Task 6: Form controls

**Files:**
- Create: `web/src/ds/Field.tsx`, `TextInput.tsx` (exports `TextInput`, `PrefixInput`, `UnitInput`, `PasswordInput`, `SearchInput`, `StaticInput`), `Select.tsx`, `SegmentedControl.tsx`, `Toggle.tsx`, `Choice.tsx` (exports `Checkbox`, `RadioCard`), `LabelInput.tsx`, `Form.module.css`, `Form.test.tsx`, `Form.stories.tsx`
- Create: `web/src/components/SecretField.tsx`, `SecretField.module.css`, `SecretField.test.tsx`, `SecretField.stories.tsx` (composite: built from the primitives above plus `Button`, `InlineStatus`)
- Modify: `web/src/ds/index.ts`, `web/src/components/index.ts`

**Interfaces:**
- Consumes: `Icon`, `Button`, `LabelChip`, `InlineStatus`, `StatusIcon`.
- Produces:
  - `Field({ label: ReactNode; labelAs?: 'label'|'span'; help?: ReactNode; error?: string; className?: string; children: (ids: { id: string; describedBy?: string }) => ReactNode })` — wires `<label htmlFor>` and `aria-describedby`; `labelAs="span"` renders `.flabel` for groups that are not a single input (segmented control, toggle row) and the caller passes `aria-labelledby`.
  - `TextInput({ mono?: boolean; numeric?: boolean } & InputHTMLAttributes)` 34 px tall (`numeric` = `.num`); `PrefixInput({ prefix: string } & InputHTMLAttributes)` (`/` before a command); `UnitInput({ unit: string } & InputHTMLAttributes)` (90 px numeric input + muted unit, e.g. "minutes"); `PasswordInput({ revealLabel: string } & InputHTMLAttributes)` (password input + `eye` button that toggles `type`, `aria-pressed`); `SearchInput({ placeholder: string } & InputHTMLAttributes)` (search icon inside the `.input` chrome, 240 px); `StaticInput({ icon?: IconName; children })` (read-only value in input chrome, e.g. "Commit to: main, default branch").
  - `Select({ mono?: boolean } & SelectHTMLAttributes)` same chrome; disabled state as in "With agent".
  - `SegmentedControl<T extends string>({ value: T; options: { value: T; label: string }[]; onChange(v: T): void; 'aria-label': string })` — `role="radiogroup"` with buttons `role="radio"`, `aria-checked`, roving tabindex, arrow-key navigation (the prototype used `aria-pressed` buttons; radiogroup is the stricter equivalent for single choice). Used for "Posted on", "Editor view", "Credential type".
  - `Toggle({ checked: boolean; onChange(v: boolean): void; 'aria-label': string })` — `role="switch"`, `aria-checked`, 34×20 `.toggle`.
  - `Checkbox({ checked: boolean; onChange(v: boolean): void; 'aria-label'?: string })` — 16 px `.cbx` with a check icon; native `<input type="checkbox">` visually hidden under the styled box.
  - `RadioCard({ type: 'radio'|'checkbox'; name: string; checked: boolean; onChange(v: boolean): void; title: ReactNode; description?: ReactNode; aside?: ReactNode })` — `.radio-card` with `.rdot` or `.cbx`; selected = `--select-line`/`--select-bg`; whole card is the `<label>` (repo picker, credential type, skill templates with a "Preview" aside button).
  - `LabelInput({ labels: string[]; onAdd(l: string): void; onRemove(l: string): void; id?: string; placeholder?: string })` — wrap of removable `LabelChip`s plus a borderless input; Enter adds, Backspace on empty input removes the last.
  - `SecretField` (component): `type SecretFieldState = 'empty'|'entering'|'saved'|'replacing'`; `type CredentialType = 'oauth_token'|'api_key'`; `SecretField({ state: SecretFieldState; credentialType: CredentialType; onCredentialTypeChange?(t): void; savedInfo?: { setAt: string; setBy: string; status?: { tone: 'ok'|'fail'; text: string } }; onReplace?(): void; onCancel?(): void; onSubmit?(value: string): void; submitLabel?: string })`. `empty`/`entering` = labelled `PasswordInput` (Setup2 "Token"); `saved` = summary row (key icon, type name, "Set 12 Oct 2026 by kim-hale. Hidden for good after saving.", status e.g. "Rejected at 11:29", Replace button `aria-expanded="false"`) and never a value (FR-3); `replacing` = the saved row with Replace `aria-expanded="true"` plus the accent panel (credential-type `SegmentedControl`, "New token" `PasswordInput` starting empty, help text, Cancel / "Test and replace").

- [ ] **Step 1: Failing tests** (`Form.test.tsx`, `SecretField.test.tsx`): `Field` label is associated (`getByLabelText`); error text is announced via `aria-describedby`; `SegmentedControl` ArrowRight moves selection and calls `onChange`; `Toggle` Space toggles and has `role=switch`; `Checkbox` click calls `onChange(true)`; `RadioCard` is selectable by clicking its title text; `PasswordInput` reveal button flips `type` to `text` and `aria-pressed` to true; `LabelInput` Enter calls `onAdd` with the typed text; `SecretField state="saved"` renders no `input` and shows a "Replace" button with `aria-expanded="false"`; `state="replacing"` renders an empty password input and `aria-expanded="true"`.
- [ ] **Step 2: Run** `npx vitest run src/ds src/components`. Expected: FAIL.
- [ ] **Step 3: Implement** with styles from prototype `.field`, `.flabel`, `.help`, `.input`, `.prefix`, `.seg`, `.toggle`, `.cbx`, `.radio-card`, `.rdot`; add barrel exports.
- [ ] **Step 4: Stories** `Primitives/Form` in `Form.stories.tsx` (every control above incl. checkbox, radio cards and label input; error and disabled states), `Components/SecretField` (four states, rejected status).
- [ ] **Step 5: Run** tests + `typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(ds): form controls and secret field`.

---

### Task 7: Table and run-list pieces

**Files:**
- Create: `web/src/mocks/types.ts` (domain types only; fixtures come in Task 13), `web/src/components/DataTable.tsx`, `FilterChip.tsx` (exports `FilterChip`, `FilterChips`), `RunRow.tsx` (exports `RunRow`, `TicketGroupRow`), `EmptyState.tsx`, `RunList.module.css`, `RunList.test.tsx`, stories
- Modify: `web/src/components/index.ts`, `web/src/mocks/index.ts`

**Interfaces:**
- Consumes: `StatusBadge`, `CommandChip`, `TicketRef`, `TicketKind`, `LabelChip`, `Avatar`, `Button`, `Icon`.
- Produces (types in `src/mocks/types.ts`):
  - `type Label = { name: string; color: string }`; `type Ticket = { kind: TicketKind; number: number; title: string; labels: Label[]; state?: string; href: string }`; `type Actor = { login: string; initials?: string; bot?: boolean }`.
  - `type RunSummary = { id: number; status: RunStatus; statusNote?: string; command: string; skill: string; agent: string; model: string; ticket: Ticket; triggeredBy: Actor; startedAt: string; duration?: string }` — `statusNote` is the faint second line under the status ("Waiting 3m. Auto-finish after 10m unattended", "API authentication failed (401)", "Re-issued by comment", "Cancelled by kim-hale"); `duration` absent renders "—" (queued).
  - `type TicketGroup = { ticket: Ticket; chainNote?: string; runsUsed: number; runsMax: number; runs: RunSummary[] }` — the Runs list groups runs by ticket ("Issue #142 → PR #148", "2 of 10 runs"); there is no parent/child run relation in the prototype.
  - `DataTable({ columns: { key: string; header: ReactNode; width?: number; align?: 'left'|'right' }[]; children })` thin styled `<table>` with `th scope="col"` (Projects, Runs, Ignored commands).
  - `FilterChip({ label: string; count?: number; icon?: ReactNode; on: boolean; onClick(): void })` — `.fchip`, `aria-pressed`, count in bold tabular figures; `FilterChips({ 'aria-label': string; children })` — `role="group"` `.filters` wrapper.
  - `TicketGroupRow({ group: TicketGroup; colSpan: number })` — `.grp` row: `TicketRef`, bold title (single-line ellipsis + `title`, Review Focus 1), labels, faint chain note, "N of M runs", external-link icon link labelled "Open #142 in GitHub".
  - `RunRow({ run: RunSummary; tree: 'mid'|'last'; href: string; actions?: ReactNode })` — `.child` row with the `.tree` connector (`mid` continues down, `last` ends), "Run 60" link, `StatusBadge` (`pill` when `idle`) + `statusNote`, `TicketRef short` for issues, mono skill, avatar + login (bot avatar for `agent-desk[bot]`), started, duration; `status === 'idle'` adds class `needs` (amber inset bar + `--row-needs`); `actions` cell right-aligned ("Open terminal" go sm + "Finish" sm for idle, "Watch" sm for running).
  - `EmptyState({ title: string; body?: ReactNode; action?: ReactNode; children?: ReactNode })`.

- [ ] **Step 1: Failing tests:** `RunRow` for an `idle` run has class `needs` and a pill badge; `RunRow` with no `duration` shows "—"; `RunRow tree="mid"` renders a `.tree.mid` element; `TicketGroupRow` with a 200-char title renders it with `title` equal to the full text and shows "2 of 10 runs"; `FilterChip` exposes `aria-pressed` and its count; `FilterChips` has `role=group` with name; `EmptyState` renders title and action.
- [ ] **Step 2: Run** `npx vitest run src/components`. Expected: FAIL.
- [ ] **Step 3: Implement** using prototype `table/th/td/.num/.grp/.child/.tree/.tree.mid/.needs/.filters/.fchip` rules; add barrel exports.
- [ ] **Step 4: Stories** `Components/RunRow` (every status, idle with actions, mid/last connectors, ticket group header, long title), `Components/FilterChip`, `Components/DataTable`, `Components/EmptyState`.
- [ ] **Step 5: Run** tests + `typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(components): data table, run row, ticket group, filter chips, empty state`.

---

### Task 8: App chrome — TopBar, Tabs, SubNav, shells

**Files:**
- Create: `web/src/components/Brand.tsx`, `TopBar.tsx`, `ProjectSwitch.tsx` (exports `ProjectSwitch`, `ProjectMenu`), `Breadcrumb.tsx`, `SubNav.tsx`, `AppShell.tsx`, `DeskLayout.tsx`, `Chrome.module.css`, `Chrome.test.tsx`, stories
- Modify: `web/src/components/index.ts`

**Interfaces:**
- Consumes: `Icon`, `IconButton`, `Avatar`, `CountBadge`, `Button`, `InlineStatus`, `Actor` (Task 7).
- Produces:
  - `Brand({ withName?: boolean = true; size?: 20|26|36; href?: string })` — the brand glyph (stroke 1.6 at 20 px, 1.4 at 36 px) + "Agent Desk"; as a link its accessible name is "Agent Desk, all projects".
  - `ProjectSwitch({ org: string; project: string; onClick?(): void })` — `.switch` button labelled "Switch project", project name ellipsized with `title` (Review Focus 1).
  - `ProjectMenu({ items: { name: string; needsYou: number; warning?: string; current?: boolean; href: string }[] })` — the switcher's open list (NeedsYou board): mono name, amber `CountBadge` or faint "0", or an amber `InlineStatus` warning ("webhooks").
  - `Breadcrumb({ items: { label: ReactNode; href?: string }[] })` — `<nav aria-label="Breadcrumb">` with `/` separators; last item bold plain text with `aria-current="page"`.
  - `TopBar({ variant: 'global'|'project'|'run'; user: Actor; project?: { org: string; name: string; repoUrl: string }; active?: 'runs'|'desk'; needsYou?: number; breadcrumb?: { label: ReactNode; href?: string }[]; children?: ReactNode; actions?: ReactNode })`:
    - `global` (Projects, ProjectsEmpty, Setup*): brand with name, spacer, bell `IconButton` "Notifications on", avatar.
    - `project` (Runs, RunsProblems, Desk*): brand, `.sep`, `ProjectSwitch`, `<nav aria-label="Project">` tabs Runs (with `CountBadge label="needs you"`) / Desk, spacer, "Repo on GitHub" ghost sm link, bell, avatar. Active tab has class `on` and `aria-current="page"`.
    - `run` (Run*): brand glyph only, `.sep`, `Breadcrumb` (`invoicer-api / Runs [1] / Run 61`, the Runs crumb carries a bare `CountBadge`), then `children` (status pill, command-on-ticket, elapsed), spacer, `actions` (Finish/Cancel or "View ticket", `.sep`, panel and full-screen `IconButton`s), avatar.
  - `SubNav({ 'aria-label': string; groups: { heading?: string; items?: { label: string; href: string; icon?: IconName; active?: boolean }[]; content?: ReactNode }[] })` (220 px) — `content` renders non-link group bodies (the "Repository" group: org / repo, branch, "Connected").
  - `AppShell({ height: number; topBar: ReactNode; children })` — `.app` column of the given artboard height, `position:relative; overflow:hidden` so `Dialog`/`Popover` position inside it.
  - `DeskLayout({ active: 'skills'|'rules'|'agent'; repo: { org: string; name: string; branch: string; connected: boolean }; children })` — `SubNav` with the Desk group (Skills / Routing rules / Agent & settings with `skill-file`/`rule`/`bot` icons) and the Repository group, then `children` filling the rest.

- [ ] **Step 1: Failing tests:** `project` variant: active tab has `aria-current="page"`; `needsYou={0}` renders no badge; `needsYou={1}` renders text "1 needs you"; project name of 80 chars is truncated with `title` (Review Focus 1); `global` variant renders no tabs and no switch; `run` variant renders no tabs, renders the breadcrumb whose last item is plain text with `aria-current="page"`, and renders `children` and `actions`; `SubNav` active item has `aria-current="page"` and a `content` group renders its node; `ProjectMenu` item with `needsYou: 0` shows "0" not a badge.
- [ ] **Step 2: Run** `npx vitest run src/components`. Expected: FAIL.
- [ ] **Step 3: Implement** from prototype `.top/.brand/.sep/.switch/.org/.tabs/.subnav/.grp-h`; add barrel exports.
- [ ] **Step 4: Stories** `Components/TopBar` (global, project with needs-you, run mode), `Components/ProjectSwitch` (button and open menu), `Components/SubNav`, `Components/DeskLayout`.
- [ ] **Step 5: Run** tests + `typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(components): top bar, breadcrumb, project switch, sub nav and layouts`.

---

### Task 9: Terminal surface

**Files:**
- Create: `web/src/components/Terminal.tsx` (exports `Terminal`, `TerminalPane`, `TerminalPlaceholder`), `TerminalBar.tsx`, `ConnectionIndicator.tsx`, `StartupChecklist.tsx`, `EventLog.tsx`, `Terminal.module.css`, `Terminal.test.tsx`, stories
- Modify: `web/src/components/index.ts`

**Interfaces:**
- Consumes: `Icon`, `StatusIcon`, `Button`, `Popover`.
- Produces:
  - `type TermTone = 'dim'|'bold'|'cyan'|'green'|'red'|'yellow'|'magenta'|'accent'|'add'|'del'|'dot'|'dotw'` (prototype `.t-dim/.t-b/.t-cy/.t-gr/.t-rd/.t-yl/.t-mag/.t-acc/.t-add/.t-del/.t-dot/.t-dotw`; `dot`/`dotw` are the green tool-call bullet and white message bullet); `type TermSpan = { text: string; tone?: TermTone }`; `type TermLine = TermSpan[]`.
  - `Terminal({ lines: TermLine[]; cursor?: boolean; anchor?: 'bottom'|'top' = 'bottom'; dimmed?: boolean; 'aria-label'?: string = 'Claude Code terminal' })` — `.term`, `role="log"`, `aria-live="off"` (live output must not spam screen readers), `white-space: pre`, long lines clipped not wrapped; `anchor="top"` for short stored scrollback (Failed, Timed out); `dimmed` = opacity .6 (Reconnecting); `cursor` appends the block cursor to the last line.
  - `TerminalPane({ notice?: ReactNode; bar: ReactNode; overlay?: ReactNode; children })` — `.termwrap` `<section aria-label="Terminal">`: optional `notice` strip above the bar (idle strip, end-of-run `Banner flush`), the bar, then a relative body; `overlay` renders the `--term-scrim` layer plus its node (the reconnect `Popover role="status"`).
  - `TerminalPlaceholder({ title: string; body: ReactNode; children?: ReactNode })` — the 560 px column centered on `--term` used when there is no terminal: "Starting the agent" (with `StartupChecklist`) and "No scrollback was saved" (with `EventLog` and a branch link button).
  - `TerminalBar({ views: { id: string; label: string; icon: IconName; soon?: string }[]; activeView: string; connection: ReactNode; size?: string; onFind?(): void; onCopyAll?(): void })` — `role="tablist" aria-label="Run view"` of `.vtab` tabs (`role="tab"`, `aria-selected`); a `soon` tab is `disabled`/`aria-disabled` and shows a dashed `.soon-tag` with the given text ("coming in MVP"); right side: `connection`, `.sep`, faint `size` ("132×44"), "Find" (`aria-label="Search scrollback"`) and "Copy all" ghost sm buttons. Labels: "Terminal" while live, "Final scrollback" after the run ended.
  - `type ConnectionState = 'live'|'reconnecting'|'none'|'ended'`; `ConnectionIndicator({ state: ConnectionState; label: string })` — `.conn` dot (live = `--ok`, reconnecting = `--idle` with amber text, none/ended = `--off`) plus the board's text ("Live, attached as kim-hale", "Reconnecting, attempt 3", "No terminal yet", "Ended, read-only, 1,208 lines", "Ended").
  - `StartupChecklist({ steps: { label: string; detail?: string; at?: string; state: 'done'|'active'|'pending' }[] })` — 22 px status glyph (succeeded / starting / queued) + label (pending is faint) + optional detail + right-aligned mono time; rendered as an `<ol>`.
  - `EventLog({ events: { at: string; text: ReactNode }[]; timeWidth?: number = 62 })` — faint mono timestamps + text rows (side panel "Lifecycle", cancelled run placeholder).

- [ ] **Step 1: Failing tests:** each `tone` maps to a distinct class (`t-dot`, `t-dotw`, …); `cursor` renders an element with class `cursor`; `anchor="top"` adds the top-anchored class; a `soon` tab is disabled and shows "coming in MVP"; the active tab has `aria-selected="true"`; `ConnectionIndicator state="reconnecting" label="Reconnecting, attempt 3"` shows that text with the reconnecting class; `TerminalPlaceholder` renders its title (Review Focus 5); `StartupChecklist` renders one list item per step and the `active` step uses the starting glyph; `EventLog` renders each timestamp.
- [ ] **Step 2: Run** `npx vitest run src/components`. Expected: FAIL.
- [ ] **Step 3: Implement** from prototype `.termwrap/.termbar/.vtab/.soon/.soon-tag/.term/.t-*/.cursor/.conn` and the inline styles of the RunStarting / RunCancelled placeholders; add barrel exports.
- [ ] **Step 4: Stories** `Components/Terminal` (Claude Code transcript with diff lines, with cursor, top-anchored short scrollback, reconnecting with dimmed body and overlay), `Components/TerminalBar` (live, no terminal yet, ended), `Components/StartupChecklist`, `Components/EventLog`.
- [ ] **Step 5: Run** tests + `typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(components): terminal surface, startup checklist, event log`.

---

### Task 10: Run context side panel

**Files:**
- Create: `web/src/components/SidePanel.tsx` (exports `SidePanel`, `SideRail`), `Section.tsx`, `KeyValue.tsx`, `Meter.tsx`, `ChainTimeline.tsx`, `TicketSummary.tsx`, `SidePanel.module.css`, `SidePanel.test.tsx`, stories
- Modify: `web/src/components/index.ts`

**Interfaces:**
- Consumes: `StatusIcon`, `CommandChip`, `TicketRef`, `LabelChip`, `IconButton`, `Icon`, `Ticket` (Task 7).
- Produces:
  - `SidePanel({ 'aria-label': string = 'Run context'; children })` — 344 px `.side` `<aside>`.
  - `SideRail({ onExpand?(): void; items: { icon: ReactNode; title: string }[] })` — the collapsed state is a 48 px rail, not zero width: "Expand context panel (])" `IconButton` (`chevron-left`) then summary glyphs each with `title` and accessible name (ticket "Issue #139", status "Running", chain "Chain: 1 of 2"). The collapse button itself lives in the run top bar (Task 8 `actions`).
  - `Section({ title: string; aside?: ReactNode; children })` — `.sec` with `.sec-h` (aside e.g. faint "max 10 runs").
  - `KeyValue({ items: { term: string; value: ReactNode }[]; termWidth?: number = 96 })` → `<dl class="kv">` grid (Setup1/SetupReady use 120, DeskAgent 150).
  - `Meter({ value: number; max: number; tone?: 'run'|'late' = 'run'; 'aria-label': string })` → `role="progressbar"` with clamped `aria-valuenow` (0…max), 5 px `.meter` bar.
  - `type ChainStep = { runId?: number; command: string; ticket?: { kind: TicketKind; number: number }; context?: string; note: string; status: RunStatus | 'future'; here?: boolean; href?: string }`; `ChainTimeline({ steps: ChainStep[] })` — `.chain`/`.cstep` with the 16 px `StatusIcon` (future = queued glyph, faint text), "Run 61" bold + `CommandChip` + "on" + `TicketRef` (or `context` text such as "on the PR it opens"), faint `note` ("This run", "Succeeded in 6m 12s, opened PR #148", "Starts when the agent posts the command"); a step with `href` is a link; `here` gets the raised box and `aria-current="step"`.
  - `TicketSummary({ ticket: Ticket; diffstat?: string })` — `TicketRef` + "Open in GitHub" external link, 14.5 px bold title, labels + faint state ("Open", "Open, review pending"); used for both the Ticket and Pull request sections (`diffstat` "+214 −12").

- [ ] **Step 1: Failing tests:** `Meter value={50} max={30}` clamps `aria-valuenow` to 30; `SideRail` renders a button named "Expand context panel (])" and each item's accessible name; `ChainTimeline` marks the `here` step `aria-current="step"`; a `future` step has no link and the faint class; a step with `href` is a link; `KeyValue` renders a `dt`/`dd` pair per item; `TicketSummary` renders a link named "Open in GitHub".
- [ ] **Step 2: Run** `npx vitest run src/components`. Expected: FAIL.
- [ ] **Step 3: Implement** from prototype `.side/.sec/.sec-h/.kv/.meter/.chain/.cstep/.cbox/.here/.future` and the RunReconnect collapsed `<aside>`; add barrel exports.
- [ ] **Step 4: Stories** `Components/SidePanel` (running: ticket, run, time, chain, pull request, lifecycle sections; collapsed rail), `Components/ChainTimeline` (running with future step, idle mid-chain, failed with re-issue), `Components/KeyValue`, `Components/Meter`.
- [ ] **Step 5: Run** tests + `typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(components): run side panel, rail, chain timeline`.

---

### Task 11: SKILL.md code editor surface

**Files:**
- Create: `web/src/components/CodeEditor.tsx`, `CodeEditor.module.css`, `highlightMarkdown.ts`, `CodeEditor.test.tsx`, `highlightMarkdown.test.ts`, `CodeEditor.stories.tsx`
- Modify: `web/src/components/index.ts`

**Interfaces:**
- Produces:
  - `type MdSpan = { text: string; kind: 'h'|'k'|'c'|'f'|'plain' }`; `highlightMarkdown(line: string): MdSpan[]` — headings (`#…`) → `h`; front-matter keys (`name: `, `description: `) → `k`; inline code (backticks included) → `c`; `---` fences → `f`.
  - `CodeEditor({ value: string; onChange?(v: string): void; readOnly?: boolean; changedLines?: number[]; 'aria-label': string })` — three-column grid per line (44 px line number `.ln`, 14 px change marker, content), mono 13 px/1.6 on `--input-bg`; lines in `changedLines` show a `+` marker in `--ok` and `--editor-changed-bg`; a real `<textarea>` layered over the highlighted view so typing and caret work natively.

- [ ] **Step 1: Failing tests:** `highlightMarkdown('# Title')` → one `h` span; front-matter `name: code-build` → `k` span for `name: `; a line with `` `main` `` yields a `c` span; gutter shows one number per line including a trailing empty line; `changedLines={[17]}` marks line 17 with `+`; typing calls `onChange` with the new text; `readOnly` blocks typing.
- [ ] **Step 2: Run** `npx vitest run src/components`. Expected: FAIL.
- [ ] **Step 3: Implement** using prototype `.editor/.ln/.md-*` and the DeskSkills changed-line inline style; add barrel export.
- [ ] **Step 4: Stories** `Components/CodeEditor` (code-build skill with line 17 changed, empty file, read-only).
- [ ] **Step 5: Run** tests + `typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(components): skill code editor`.

---

### Task 12: Setup, rule, skill and settings composites

Patterns repeated across Setup*, Desk* and SetupReady boards that the earlier tasks do not cover. Built before the screens so no screen grows local widgets.

**Files:**
- Create in `web/src/components/`: `Stepper.tsx`, `SetupLayout.tsx`, `RuleSentence.tsx`, `RuleForm.tsx`, `RuleRow.tsx`, `GuardsCard.tsx`, `SkillList.tsx`, `CommitBar.tsx`, `CommitSummary.tsx`, `CodeBlock.tsx`, `SettingsSection.tsx`, `DangerZone.tsx`, `ConfirmDeleteDialog.tsx`, `SidePane.tsx`, `SurfaceCard.tsx`, `Composites.module.css`, `Composites.test.tsx`, one `*.stories.tsx` per component
- Modify: `web/src/components/index.ts`

**Interfaces:**
- Consumes: `StepNumber`, `Field`, `PrefixInput`, `SegmentedControl`, `LabelInput`, `Select`, `Toggle`, `TextInput`, `StaticInput`, `CommandChip`, `LabelChip`, `InlineStatus`, `Button`, `IconButton`, `Icon`, `Dialog`, `Banner`, `TopBar` (Task 8), `Label`, `Actor` (Task 7).
- Produces:
  - `Stepper({ steps: { label: string; detail?: string; optional?: boolean }[]; current: number })` — vertical `.steps` list (`<ol>`): steps before `current` are `done` (`StepNumber` check + faint `detail`, e.g. "harbor-labs/invoicer-api"), `current` is raised with `aria-current="step"`, later ones `todo`; `optional` adds a faint "optional" tag.
  - `SetupLayout({ user: Actor; projectName: string; steps; current: number; stepLabel: string; title: string; intro: ReactNode; children; aside?: ReactNode; footer: { back?: string; skip?: string; next: { label: string; href: string } } })` — `TopBar variant="global"`, 300 px left column ("New project", name, `Stepper`, "Progress is saved…"), main column (muted "Step 2 of 4", `h1`, intro), optional 320 px right `aside`, and the footer row (ghost "Back" with `chevron-left`, spacer, ghost "Skip", primary next).
  - `type RuleTarget = 'issue'|'pr'|'any'`; `type RuleDraft = { command: string; target: RuleTarget; labels: string[]; skill: string; agent: string; enabled: boolean }`.
  - `RuleSentence({ rule: RuleDraft; variant: 'slots'|'plain' })` — `slots` = 16 px/1.9 `.sentence` with dashed `.slot`s ("When a comment starting with `/code-build` is posted on _an issue_ labelled _user-story_, run skill _code-build_ with agent _Claude_."); `plain` = the rule-list wording ("When `/code-build` is posted on an issue labelled **user-story**, run code-build with Claude"); target wording issue → "an issue", pr → "a pull request", any → "an issue or pull request".
  - `RuleForm({ value: RuleDraft; skills: string[]; agents: string[]; onChange(v: RuleDraft): void; agentLocked?: boolean })` — the sentence preview card plus the 2-column grid: Command (`PrefixInput "/"`), Posted on (`SegmentedControl` Issue / Pull request / Any), labels (`LabelInput`), Run skill (`Select mono`), With agent (`Select`, disabled when `agentLocked`), Enabled (`Toggle` + "Matches new comments right away"); all help texts from Setup4.
  - `RuleRow({ rule: RuleDraft & { id: string }; stats: string; warning?: string; selected?: boolean; onToggle(next: boolean): void; onSelect?(): void })` — 44 px / 1fr / 140 px / 32 px grid: `Toggle` "Enabled", `RuleSentence variant="plain"` (faint when disabled), optional amber `InlineStatus` warning (missing skill), faint stats ("14 runs this week, last 14:15"), "More" `IconButton`; `selected` = raised + accent inset bar.
  - `GuardsCard({ maxRunsPerTicket: number; changeHref?: string; ignoredHref?: string })` — lock-icon "Guards on every rule" card (Setup4 aside, DeskRules).
  - `SkillList({ skills: { name: string; description: string; ruleSummary: string }[]; activeName?: string; branch: string; onNew?(): void })` — 300 px column: "Skills" h2 + "New skill" sm button, faint mono ".claude/skills/ on main", items as links (mono name, faint rule summary "2 rules" / "1 rule, off", muted description), active item raised with `aria-current="page"`.
  - `CommitBar({ message: string; onMessageChange?(v: string): void; branch: string; dirty: boolean; onDiscard?(): void; onCommit?(): void; note: string })` — panel footer: "Commit message" mono input, "Commit to" `StaticInput` (branch + "default branch"), ghost Discard, primary "Commit to main" (disabled unless `dirty`), faint note below.
  - `CommitSummary({ branch: string; author: string; message: string; files: string[] })` — Setup3 panel: commit icon + "One commit to main as agent-desk[bot]", "Commit message" input, `+ path` file list in faint mono.
  - `CodeBlock({ caption: ReactNode; code: string; onCopy?(): void })` — bordered block with raised caption row and "Copy" sm button (copy icon), `<pre>` mono 14 px on `--input-bg` (SetupReady command).
  - `SettingsSection({ title: string; description?: string; children })` — 260 px / 1fr grid section with bottom rule, content max 620 px (DeskAgent).
  - `DangerZone({ title: string; body: string; actionLabel: string; onAction?(): void })` — `--banner-err-line` bordered row with a `danger` button.
  - `ConfirmDeleteDialog({ open: boolean; name: string; path: string; branch: string; warning?: ReactNode; defaultMessage: string; onClose(): void; onConfirm(message: string): void })` — `Dialog` titled "Delete skill `code-e2e`?", body copy, optional warn `Banner`, "Commit message" field, "Type `code-e2e` to confirm" field; footer ghost "Keep skill" + `solid-danger` "Delete and commit" (trash icon) disabled until the typed text equals `name` (Review Focus 6).
  - `SidePane({ title: string; width?: number = 560; onClose(): void; children; footer?: ReactNode })` — right-hand `<aside>` editor panel with h2 + "Close" `IconButton` (DeskRules "Edit rule").
  - `SurfaceCard({ caption: ReactNode; children })` — 10 px rounded bordered frame with a muted caption footer on `--panel`; frames the illustrative mocks on the NeedsYou board (browser tab, project switcher, GitHub comment, desktop notification).

- [ ] **Step 1: Failing tests** (`Composites.test.tsx`): `Stepper current={1}` marks exactly one step `aria-current="step"` and step 0 as done (no digit); `RuleSentence variant="slots"` for `{command:'code-build', target:'issue', labels:['user-story'], skill:'code-build', agent:'Claude'}` has text content "When a comment starting with /code-build is posted on an issue labelled user-story, run skill code-build with agent Claude."; `target:'pr'` with no labels reads "on a pull request, run skill"; `RuleRow` toggle calls `onToggle(false)` for an enabled rule; `RuleForm` changing the segmented control calls `onChange` with `target:'pr'`; `ConfirmDeleteDialog` confirm button is disabled until "code-e2e" is typed, then calls `onConfirm` with the commit message (Review Focus 6); `CommitBar dirty={false}` disables "Commit to main"; `SkillList` active item has `aria-current="page"`; `CodeBlock` Copy calls `onCopy`.
- [ ] **Step 2: Run** `npx vitest run src/components/Composites.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** from prototype `.steps/.step/.sn/.sentence/.slot/.radio-card/.dialog/.d-b/.d-f` and the Setup*/Desk* inline styles; add barrel exports.
- [ ] **Step 4: Stories** one `Components/<Name>` story per component above (Stepper at each step, RuleForm filled for code-build and for code-review, RuleRow enabled/selected/disabled/warning, ConfirmDeleteDialog open with `play` typing the name).
- [ ] **Step 5: Run** tests + `typecheck` + `build-storybook`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(components): setup, rule, skill and settings composites`.

---

### Task 13: Mock fixtures

**Files:**
- Modify: `web/src/mocks/types.ts` (add the types below next to Task 7's), `web/src/mocks/index.ts`
- Create: `web/src/mocks/projects.ts`, `runs.ts`, `skills.ts`, `rules.ts`, `agent.ts`, `ignored.ts`, `terminal.ts`, `runDetail.ts`, `mocks.test.ts`

**Interfaces:**
- Consumes: `RunStatus` (Task 2), `RunSummary`, `TicketGroup`, `Ticket`, `Actor` (Task 7), `TermLine`, `ConnectionState` (Task 9), `ChainStep` (Task 10), `RuleDraft`, `RuleTarget` (Task 12), `CredentialType` (Task 6).
- Produces (all values copied from the prototype so screens match):
  - `user: Actor` (`kim-hale`, "KH"); `bot: Actor` (`agent-desk[bot]`, `bot: true`).
  - `type Project = { id: string; org: string; name: string; repo: string; connection: { tone: 'ok'|'warn'; text: string }; needsYou: number; running: number; queued: number; lastRun: string }`; `projects` = invoicer-api (1 needs you, "Run 63, 2 min ago"), invoicer-web, docs-site ("No webhooks for 2 days").
  - `ticketGroups: TicketGroup[]` = #142 (runs 60, 62), #139 (61), #151 (63), #131 (55, 56, 57), #127 (54), #120 (52) in board order; `runs: RunSummary[]` is their flattening (runs 52, 54, 55, 56, 57, 60, 61, 62, 63).
  - `type IgnoredCommand = { at: string; ticket: { kind: TicketKind; number: number }; command: string; author: string; reason: string; detail: string; href: string }`; `ignored` = the five RunsProblems rows (no write access, run limit reached, already running, label missing, no rule for command).
  - `type Skill = { name: string; description: string; body: string; ruleSummary: string; path: string; lastCommit: string }` for `code-build`, `code-review`, `code-e2e`, `qa-e2e`; `skillTemplates` = code-build ("chains to code-review"), code-review.
  - `type Rule = RuleDraft & { id: string; stats: string; warning?: string }`; `rules` = /code-build, /code-review, /code-e2e, /docs-update (with the missing-skill warning), /qa-e2e (disabled).
  - `type AgentSettings = { agent: 'Claude'; model: string; credential: { type: CredentialType; setAt: string; setBy: string; status?: { tone: 'ok'|'fail'; text: string } }; timeoutMinutes: 30; idleEndMinutes: 10; maxConcurrent: 2; maxRunsPerTicket: 10 }`; `agentSettings`.
  - `terminalByRun: Record<number, TermLine[]>` for runs 60, 61, 62, 54, 56 (copied span by span from the boards, with the `t-*` class mapped to `TermTone`).
  - `type RunDetailData = { run: RunSummary; elapsed: string; rule: string; triggerNote: string; startedAt: string; endedAt?: string; chain: ChainStep[]; pullRequest?: { ticket: Ticket; diffstat: string }; lifecycle?: { at: string; text: string }[]; startup?: { label: string; detail?: string; at?: string; state: 'done'|'active'|'pending' }[]; idle?: { since: string; endsAt: string; slotNote: string }; time?: { elapsed: string; limit: string; percent: number }; connection: { state: ConnectionState; label: string }; termSize?: string; endNote?: { title: string; body: ReactNode; actions: { label: string; href?: string; icon?: IconName }[] } }`; `runDetails: Record<'RunStarting'|'RunRunning'|'RunIdle'|'RunReconnect'|'RunSucceeded'|'RunFailed'|'RunTimedOut'|'RunCancelled', RunDetailData>`.

- [ ] **Step 1: Failing test** `mocks.test.ts`: every `run.status` is a valid `RunStatus` (`RUN_STATUSES`); every enabled rule's `skill` exists in `skills` except a rule carrying a `warning`; run ids are unique; at most one active (`queued|starting|running|idle`) run per ticket+skill (PRD one-at-a-time guard); every group's `runsUsed ≤ runsMax`; defaults match PRD (`maxConcurrent === 2`, `maxRunsPerTicket === 10`, `timeoutMinutes === 30`); `runDetails` has 8 keys and each `run.status` matches the board name (RunTimedOut → `timed_out`, RunIdle → `idle`, RunReconnect → `running`, …); no fixture string contains a credential-looking value (`/sk-|token=/`) (FR-3).
- [ ] **Step 2: Run** `npx vitest run src/mocks`. Expected: FAIL.
- [ ] **Step 3: Implement** fixtures by reading the prototype screens; export everything from `src/mocks/index.ts`.
- [ ] **Step 4: Run** tests + `typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mocks): fixtures shared by screen stories`.

---

### Task 14: Entry and Projects screens (3)

**Files:**
- Create: `web/src/screens/SignIn.tsx`, `ProjectsEmpty.tsx`, `Projects.tsx`, `Screens.module.css` (page-level layout grids only, shared by all screen tasks), `entry.stories.tsx`, `entry.test.tsx`
- Modify: `web/src/screens/index.ts`

**Interfaces:**
- Consumes: `AppShell`, `TopBar`, `Brand`, `Button`, `IconButton`, `DataTable`, `StatusBadge`, `StatusIcon`, `InlineStatus`, `StepNumber`, `CommandChip`, `TicketRef`, `EmptyState`, `projects`, `user` fixtures.
- Produces:
  - `SignIn({ signInHref: string })` — two-column hero: brand, 34 px headline, "Sign in with GitHub" primary lg link (`github` icon), privacy note; right panel "One ticket, two runs" numbered list (`StepNumber` + `CommandChip`/`TicketRef`/`StatusBadge`, the 4th step uses the idle pill).
  - `ProjectsEmpty({ user: Actor; createHref: string })` — `TopBar variant="global"`, `EmptyState` with 28 px title, intro, a 4-column `<ol>` of `StepNumber` step cards (Connect a repo / Add Claude / Add skills / Add a rule), primary lg "Create project" (`plus`) + faint note.
  - `Projects({ user: Actor; projects: Project[]; newHref: string })` — `TopBar variant="global"`, h1 + primary "New project", `DataTable` columns Project / GitHub / Needs you / Running / Queued / Last run / (more): name link + faint mono repo, connection as `InlineStatus` (ok "Connected" with the 12 px succeeded glyph titled "status: succeeded", or warn "No webhooks for 2 days"), needs-you as `StatusBadge status="idle" variant="pill"` reading "1 run" or faint "None", "More for <name>" `IconButton`. Empty `projects` renders `ProjectsEmpty` content.
  - Stories in `entry.stories.tsx`, `title: 'Screens/Entry'`, exports `SignIn`, `ProjectsEmpty`, `Projects`. Reference: `design/prototype/project/{SignIn,ProjectsEmpty,Projects}.dc.html`.

- [ ] **Step 1: Failing tests:** SignIn has a link named "Sign in with GitHub" with `signInHref`; `Projects projects={[]}` shows "Create your first project" (Review Focus 5); a project row shows the "1 run" pill only when `needsYou > 0`, else "None"; an 80-char repo name is truncated with `title`; the docs-site row shows "No webhooks for 2 days".
- [ ] **Step 2: Run** `npx vitest run src/screens/entry.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** screens composed only from `@/ds` and `@/components`; `Screens.module.css` may hold page grids/paddings only. Any repeated or styled widget not expressible with existing components becomes a new shared component (with its own story) rather than screen-local CSS.
- [ ] **Step 4: Run** tests and `build-storybook`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(screens): sign in and projects`.

---

### Task 15: First-run setup screens (5)

**Files:**
- Create: `web/src/screens/Setup1.tsx`, `Setup2.tsx`, `Setup3.tsx`, `Setup4.tsx`, `SetupReady.tsx`, `setup.stories.tsx`, `setup.test.tsx`
- Modify: `web/src/screens/index.ts`

**Interfaces:**
- Consumes: `SetupLayout`, `Stepper`, `RadioCard`, `Field`, `TextInput`, `Select`, `SecretField`, `Banner`, `InlineStatus`, `KeyValue`, `RuleForm`, `GuardsCard`, `CommitSummary`, `CodeBlock`, `LabelChip`, `CommandChip`, `StatusIcon`, `Toggle`, `Button`, `user`, `skillTemplates`, `rules`, `agentSettings`.
- Produces (all wrap `SetupLayout` with the four steps Connect repository / Add Claude credential / Add skills (optional) / Add first rule):
  - `Setup1({ projectName: string; repos: { name: string; meta: string }[]; selected: string; installedOn: string; pingAt?: string })` — project name field, "GitHub App installation" + `InlineStatus` "Installed on harbor-labs", repo `RadioCard`s, help link, ok `Banner` "Webhook ping received at 14:01:37"; aside: "Permissions the app asks for" `KeyValue termWidth={120}` + warn `Banner` "If the ping does not arrive".
  - `Setup2({ credentialType: CredentialType; secretState: 'entering'|'empty'; models: string[]; maxConcurrent: number; accepted?: { at: string; secretName: string } })` — credential-type `RadioCard`s, `SecretField` (password + reveal "Show token while typing"), Model `Select`, Concurrent runs numeric input, ok `Banner` "Token accepted.".
  - `Setup3({ repo: string; branch: string; templates: Skill[]; selected: string[]; commitMessage: string })` — off `Banner` (info icon) "No skills found in … on main.", checkbox `RadioCard`s with "Preview" ghost sm link, `CommitSummary`; footer Skip + "Commit 2 skills and continue" (count follows `selected.length`).
  - `Setup4({ rule: RuleDraft; skills: string[]; followUp: { command: string; target: RuleTarget; skill: string; enabled: boolean }; maxRunsPerTicket: number })` — `RuleForm`, follow-up toggle row ("Also add the follow-up rule `/code-review` on pull requests, run code-review"), aside `GuardsCard`.
  - `SetupReady({ repo: string; label: { name: string; color: string }; command: string; summary: { term: string; value: ReactNode }[]; lastWebhook: string })` — `InlineStatus` "Project ready", 28 px title, `CodeBlock` captioned "Comment on an issue labelled `user-story`", "Open issues in GitHub" primary + "Go to runs", off `Banner` with the starting glyph "Listening for your first command", "What you set up" `KeyValue termWidth={120}`. The stepper shows all four steps done.
  - Stories in `setup.stories.tsx`, `title: 'Screens/Setup'`, exports `Setup1`, `Setup2`, `Setup3`, `Setup4`, `SetupReady`. Reference: `Setup1–4.dc.html`, `SetupReady.dc.html`.

- [ ] **Step 1: Failing tests:** each screen marks exactly one step `aria-current="step"` (none on SetupReady); Setup1 selected repo radio is checked; Setup2 renders the token only as `type="password"` and no element's text contains the token value (FR-3); Setup3 checkboxes reflect `selected` and the primary button reads "Commit 2 skills and continue"; Setup4 sentence reads "When a comment starting with /code-build is posted on an issue labelled user-story, run skill code-build with agent Claude." (PRD §4); SetupReady code block contains "/code-build" and Copy is a button.
- [ ] **Step 2: Run** `npx vitest run src/screens/setup.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** screens from the Task 12 composites.
- [ ] **Step 4: Run** tests and `build-storybook`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(screens): first-run setup flow`.

---

### Task 16: Runs list and Needs-you screens (3)

**Files:**
- Create: `web/src/screens/RunsPage.tsx` (shared header for both runs boards), `Runs.tsx`, `RunsProblems.tsx`, `NeedsYou.tsx`, `runs.stories.tsx`, `runs.test.tsx`
- Modify: `web/src/screens/index.ts`

**Interfaces:**
- Consumes: `AppShell`, `TopBar`, `DataTable`, `TicketGroupRow`, `RunRow`, `FilterChip`, `FilterChips`, `SearchInput`, `Banner`, `StatusIcon`, `Button`, `EmptyState`, `TicketRef`, `CommandChip`, `CountBadge`, `ProjectMenu`, `ProjectSwitch`, `Avatar`, `Brand`, `SurfaceCard`, `ticketGroups`, `ignored`, `projects`, `user`.
- Produces:
  - `type RunsFilter = 'needs_you'|'active'|'queued'|'ended'|'all'|'ignored'` with chips "Needs you" (idle glyph), "Active" (starting|running), "Queued", "Ended" (succeeded|failed|cancelled|timed_out), "All", and the separate right-aligned "Ignored" chip (`ignored` icon).
  - `RunsPage({ project; user; needsYou: number; slots: { used: number; total: number }; today: string; filter: RunsFilter; counts: Record<RunsFilter, number>; onFilter?(f: RunsFilter): void; banners?: ReactNode; children })` — `TopBar variant="project" active="runs"`, h1 "Runs" + "Slots 2 of 2 in use" (play icon) + "Today: 9 runs, 1 failed", `SearchInput` "Ticket number or title", "Grouped by ticket" button with `aria-pressed`, `FilterChips` row.
  - `Runs({ …RunsPage props; groups: TicketGroup[]; needsYouRun?: { run: RunSummary; askedAgo: string; slotNote: string; href: string } })` — idle `Banner` "Run 62 needs you." with the 18 px idle glyph and actions "Answer in terminal" (go, terminal icon) + "Finish run"; `DataTable` columns Run / Status / Ticket / Skill / Triggered by / Started / Duration / (actions) with one `TicketGroupRow` per group followed by its `RunRow`s (`tree` = `last` for the final run of the group, else `mid`); idle rows get "Open terminal" + "Finish", running rows "Watch". The filter hides non-matching runs and drops groups left empty; zero groups shows `EmptyState`.
  - `RunsProblems({ …RunsPage props with filter 'ignored'; warnings: { tone: 'err'|'warn'; icon: IconName; title: string; body: string; actions: { label: string; href?: string; icon?: IconName; variant?: 'default'|'ghost' }[] }[]; ignored: IgnoredCommand[] })` — `banners` = err (warning icon) "No webhooks from GitHub since 11:42" with "Check again" (refresh) + ghost "Connection details", warn (key icon) "The Claude credential was rejected" with "Replace credential"; then h2 "Ignored commands", intro, `DataTable` Time / Ticket / Command / Author / Why nothing ran (bold reason + muted detail) / ghost sm "Comment" external link.
  - `NeedsYou({ project; projects: Project[] })` — 28 px title + intro, 2×2 grid of `SurfaceCard`s: browser tab mock (brand glyph with amber dot, "(1) Needs you, invoicer-api"), in-app top bar strip (`ProjectSwitch` + tabs with `CountBadge`) above `ProjectMenu`, GitHub bot comment mock (bot `Avatar`, "Run 62 code-review is waiting for your input.", link to the run), desktop notification mock. Only the browser-tab and notification mocks are board-specific markup; they live in `NeedsYou.tsx` using tokens (`--chrome-bg`, `--notify-bg`).
  - Stories in `runs.stories.tsx`, `title: 'Screens/Runs'`, exports `Runs`, `RunsProblems`, `NeedsYou` (heights 1000, 960, 740). Reference: `Runs.dc.html`, `RunsProblems.dc.html`, `NeedsYou.dc.html`.

- [ ] **Step 1: Failing tests:** `filter="needs_you"` shows only the Run 62 row and its #142 group header; `filter="ended"` shows runs 60, 55, 56, 57, 54, 52; `groups={[]}` shows the empty state (Review Focus 5); within group #131 the rows appear 55, 56, 57 with tree classes `mid`, `mid`, `last`; the active chip has `aria-pressed="true"`; `RunsProblems` lists each ignored command with its reason and detail, and its two banners have no live role; `NeedsYou` renders four captioned surfaces.
- [ ] **Step 2: Run** `npx vitest run src/screens/runs.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** `RunsPage`, then the three screens; filter logic as a pure exported `filterGroups(groups, filter)` covered by the tests above.
- [ ] **Step 4: Run** tests and `build-storybook`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(screens): runs list, problems, needs-you`.

---

### Task 17: Run detail screen and its 8 states

**Files:**
- Create: `web/src/screens/RunDetail.tsx`, `runDetail.stories.tsx`, `runDetail.test.tsx`
- Modify: `web/src/screens/index.ts`

**Interfaces:**
- Consumes: `AppShell`, `TopBar` (`run` variant), `TerminalPane`, `Terminal`, `TerminalBar`, `TerminalPlaceholder`, `ConnectionIndicator`, `StartupChecklist`, `EventLog`, `SidePanel`, `SideRail`, `Section`, `KeyValue`, `Meter`, `ChainTimeline`, `TicketSummary`, `Popover`, `Banner`, `StatusBadge`, `StatusIcon`, `InlineStatus`, `CommandChip`, `TicketRef`, `Avatar`, `Button`, `IconButton`, `runDetails`, `terminalByRun`, `user`.
- Produces: one component `RunDetail({ data: RunDetailData; lines?: TermLine[]; needsYou: number; panelCollapsed?: boolean; cancelConfirmOpen?: boolean; height?: number = 900 })` (`RunDetailData` from Task 13). Width follows the story viewport (1440, or 1280 for `RunReconnect`). Behavior by status, all taken from the boards:
  - Top bar `children`: status pill, `CommandChip` "on" `TicketRef`, elapsed (or final duration). `actions` for active runs (`queued|starting|running|idle`): **Finish** (disabled with `title="Finish is available when the agent is waiting for you"` unless `idle`, where it reads "Finish run" and is enabled) and **Cancel run** (`danger`, x icon); for ended runs a single "View ticket" external link instead (no Retry: FR-16 is P1 and absent from the prototype). Then `.sep`, "Collapse context panel (])" and "Full screen terminal (F)" `IconButton`s.
  - Terminal area: `starting` → `TerminalPlaceholder` "Starting the agent" + `StartupChecklist` + faint pending-pod note, connection "No terminal yet"; `running` → live `Terminal`; `idle` → amber notice strip above the bar ("The agent finished its turn and is waiting for you" + go "Finish run") and `Terminal cursor`; `succeeded` → `Banner tone="ok" flush` "Succeeded in 6m 12s." with "Go to run 62" (`iconRight="chevron-right"`); `failed` → `Banner tone="err" flush prominent` with actions "Replace credential", "Copy /code-review", "Open PR #133" and a top-anchored `Terminal`; `timed_out` → `Banner tone="late" flush prominent` with "Change time limit", "Copy /code-e2e"; `cancelled` → `Banner tone="off" flush` "Cancelled by kim-hale at 13:10:41." and `TerminalPlaceholder` "No scrollback was saved" + `EventLog` + branch link button. Ended runs label the view "Final scrollback".
  - `cancelConfirmOpen` → `Popover role="dialog" label="Cancel run 61?"` under the top bar (right 150, top 56, width 340) with body copy, ghost sm "Keep running", `solid-danger` sm "Cancel run".
  - `data.connection.state === 'reconnecting'` → dimmed `Terminal` + `TerminalPane overlay` with `Popover role="status"` "Connection to the terminal lost" + sm "Reconnect now" (refresh icon).
  - Side panel sections in board order: Ticket (`TicketSummary`), then per state: Waiting for you (idle: "Idle since", `InlineStatus` "Timer paused", end-time and slot notes), Pull request (`TicketSummary` with diffstat, or "None yet…" note), Run (`KeyValue`: Skill link, Rule link, Triggered by avatar + "comment" link, Agent + model, Started, Ended), Time (running/timed out: elapsed vs limit + `Meter`, `tone="late"` at 100%), Chain on this ticket (`ChainTimeline`, aside "max 10 runs"), Lifecycle (`EventLog`). `panelCollapsed` swaps the panel for `SideRail`.
  - Stories in `runDetail.stories.tsx`, `title: 'Screens/Run detail'`, exports `RunStarting` (63), `RunRunning` (61, cancel popover open), `RunIdle` (62), `RunReconnect` (61, 1280×800, collapsed, reconnecting), `RunSucceeded` (60), `RunFailed` (56), `RunTimedOut` (54), `RunCancelled` (52). Reference: the eight `Run*.dc.html` boards.

- [ ] **Step 1: Failing tests:** Finish is enabled iff status is `idle` and otherwise has the explanatory `title`; Cancel run is absent and "View ticket" present for `succeeded|failed|timed_out|cancelled`; no "Retry" text anywhere; `cancelConfirmOpen` shows a dialog named "Cancel run 61?" with a "Cancel run" button inside it and `Escape` calls the close handler; reconnecting shows "Reconnecting, attempt 3" and a status region "Connection to the terminal lost"; `panelCollapsed` renders the "Expand context panel (])" button and no "Run context" sections; `starting` shows "Starting the agent" and "No terminal yet" (Review Focus 5); `cancelled` shows "No scrollback was saved" (Review Focus 5); `failed` renders the err-tone banner and `timed_out` the late-tone banner; `idle` renders the cursor element.
- [ ] **Step 2: Run** `npx vitest run src/screens/runDetail.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** `RunDetail`; the 8 stories differ only by args taken from `runDetails[<Board>]` and `terminalByRun`.
- [ ] **Step 4: Run** tests and `build-storybook`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(screens): run detail in all eight states`.

---

### Task 18: Desk screens (4)

**Files:**
- Create: `web/src/screens/DeskSkills.tsx` (also renders the delete state), `DeskRules.tsx`, `DeskAgent.tsx`, `desk.stories.tsx`, `desk.test.tsx`
- Modify: `web/src/screens/index.ts`

**Interfaces:**
- Consumes: `AppShell`, `TopBar` (`project` variant, `active="desk"`), `DeskLayout`, `SkillList`, `CodeEditor`, `CommitBar`, `ConfirmDeleteDialog`, `SegmentedControl`, `LabelChip`, `IconButton`, `Button`, `RuleRow`, `RuleForm`, `SidePane`, `GuardsCard`, `EmptyState`, `SettingsSection`, `KeyValue`, `InlineStatus`, `StatusIcon`, `SecretField`, `Field`, `TextInput`, `UnitInput`, `Select`, `DangerZone`, `skills`, `rules`, `agentSettings`, `user`, `projects`.
- Produces:
  - `DeskSkills({ skills: Skill[]; activeName?: string; dirty?: boolean; changedLines?: number[]; view?: 'edit'|'preview'|'diff'; deleting?: string })` — `DeskLayout active="skills"`, `SkillList`, editor header (mono h2, idle-tone `LabelChip` "Unsaved changes" when `dirty`, path + last commit, `SegmentedControl` Edit / Preview / Diff, ghost sm "History", "Delete skill" trash `IconButton`), `CodeEditor`, `CommitBar` ("Commit to main" is the save, FR-6). `deleting` opens `ConfirmDeleteDialog` for that skill (the board deletes `code-e2e` while `code-build` is open; its warning names rule `/code-e2e`). Empty `skills` renders `EmptyState` pointing to the starter templates.
  - `DeskRules({ rules: Rule[]; skills: string[]; editingId?: string; maxRunsPerTicket: number; onToggle?(id: string, next: boolean): void })` — h1 "Routing rules" + intro + primary "New rule", bordered list of `RuleRow`s (row `editingId` is `selected`), `GuardsCard`; `editingId` opens `SidePane` "Edit rule" with `RuleForm` and footer danger "Delete rule", ghost "Cancel", primary "Save rule" + faint "Saving does not touch the repo…". Empty `rules` renders `EmptyState`. FR-8 fields: command, label filter, target, agent, skill.
  - `DeskAgent({ settings: AgentSettings; github: { term: string; value: ReactNode }[]; replacingCredential?: boolean })` — h1 "Agent & settings", `SettingsSection`s: GitHub connection (`KeyValue termWidth={150}` with `InlineStatus` rows, "Manage installation on GitHub", ghost "Send test ping"), Agent (disabled Agent input, Model `Select`, Credential `SecretField` `saved` or `replacing` with "Rejected at 11:29"), Limits (`UnitInput` run time limit 30 minutes, idle end 10 minutes unattended, concurrent runs 2, runs per ticket 10, help texts, "Save limits"), Danger zone (`DangerZone` "Delete project"). FR-3, FR-4, FR-10, FR-15.
  - Stories in `desk.stories.tsx`, `title: 'Screens/Desk'`, exports `DeskSkills`, `DeskSkillDelete` (= `DeskSkills` with `deleting: 'code-e2e'`), `DeskRules` (editing the /code-review rule), `DeskAgent` (replacing credential, height 1240). Reference: `DeskSkills, DeskSkillDelete, DeskRules, DeskAgent .dc.html`.

- [ ] **Step 1: Failing tests:** `DeskSkills skills={[]}` shows an empty state with the starter-template hint (Review Focus 5); `dirty` shows "Unsaved changes" and enables "Commit to main", otherwise disabled; `deleting="code-e2e"` shows a dialog named "Delete skill code-e2e?" whose confirm is disabled until the name is typed; `DeskRules rules={[]}` shows the empty state; toggling a rule calls `onToggle(id, next)`; `editingId` opens a complementary region named "Edit rule" and marks that row selected; `DeskAgent` without `replacingCredential` renders no password input and no credential value, with it renders an empty "New token" password input and a "Test and replace" button.
- [ ] **Step 2: Run** `npx vitest run src/screens/desk.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the three components from the Task 8 and Task 12 composites.
- [ ] **Step 4: Run** tests and `build-storybook`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(screens): desk skills, rules, agent`.

---

### Task 19: Overview index story and Storybook organization

**Files:**
- Create: `web/src/screens/Overview.tsx`, `overview.stories.tsx`, `web/src/Introduction.mdx`, `web/src/test/coverage.test.ts`, `web/src/screens/storyIds.ts`
- Modify: `web/.storybook/preview.ts` (story sort order: Introduction, Foundations, Primitives, Components, Screens; parameters `layout: 'fullscreen'` for `Screens/*`; viewport presets 1440×900, 1440×1000, 1440×960, 1440×740, 1440×1240, 1280×800), `web/src/screens/index.ts`

**Interfaces:**
- Consumes: `Brand`, `StatusBadge`, every screen story.
- Produces:
  - `storyIds.ts`: `boardStories: Record<BoardName, { title: string; exportName: string }>` for the 24 boards (`Main → Screens/Overview` + `Main`, `SignIn → Screens/Entry` + `SignIn`, `RunStarting → Screens/Run detail` + `RunStarting`, …) and `storyHref(board)` building `?path=/story/<id>` with Storybook's id rule (title and export kebab-cased, joined by `--`, e.g. `screens-run-detail--run-starting`).
  - `Overview()` — the prototype `Main.dc.html`: brand 36, 36 px title, summary, six grouped screen lists (Entry, First-run setup, Runs, Run detail live, Run detail ended, Desk) linking via `storyHref`, the "Run status, one shape per state" legend (8 `StatusBadge`s + descriptions), the four surface swatches and the type note. Story `title: 'Screens/Overview'`, export `Main`.

- [ ] **Step 1: Failing test** `coverage.test.ts`: read `design/prototype/project/canvas.json` `order` (24 entries); assert `Object.keys(boardStories)` equals that list; for each board import the stories glob (`import.meta.glob('../screens/*.stories.tsx', { eager: true })`) and assert a module exists whose `default.title === title` and which exports `exportName`; assert there are no screen story exports that map to no board.
- [ ] **Step 2: Run** `npx vitest run src/test/coverage.test.ts`. Expected: FAIL (Overview missing); fix any naming mismatch reported for the other 23.
- [ ] **Step 3: Implement** `storyIds.ts`, `Overview`, `Introduction.mdx` (how to add a component: primitive in `ds/` vs composite in `components/` vs screen in `screens/`; story naming rules from Task 1; token usage rule: no raw hex outside `tokens.css`).
- [ ] **Step 4: Run** `npm test`, `typecheck`, `build-storybook`. Expected: PASS, coverage 24/24.
- [ ] **Step 5: Commit** `feat(storybook): overview, ordering and coverage check`.

---

### Task 20: Accessibility and visual-parity pass

**Files:**
- Create: `web/scripts/parity.mjs` (Playwright: screenshots each `Screens/*` story at its viewport to `web/parity-out/`), `design/parity-notes.md`
- Modify: `web/.storybook/preview.ts` (enable `@storybook/addon-a11y` with `parameters.a11y.test = 'error'` for Primitives and Components), `web/src/test/stories.smoke.test.tsx` (axe check), `web/package.json` (`axe-core`, `playwright` dev deps), `.gitignore` (add `web/parity-out`)

**Interfaces:**
- Consumes: built `storybook-static` (served locally), `boardStories` (Task 19); prototype files in `design/prototype/project/` opened in the same Playwright session for side-by-side screenshots.

- [ ] **Step 1: Write `parity.mjs`** producing, per board in `canvas.json` `order`, `<name>.story.png` (iframe URL `iframe.html?id=<story id>`) and `<name>.proto.png` at the artboard's `w`×`h` from `canvas.json`.
- [ ] **Step 2: Run** `npm run build-storybook && node scripts/parity.mjs`. Expected: 24 pairs written.
- [ ] **Step 3: Review** each pair; fix visible deviations in the owning component (not in the screen), re-run. Record residual differences in `design/parity-notes.md`.
- [ ] **Step 4: Run a11y.** Add `axe-core` as a dev dependency and extend `stories.smoke.test.tsx` to run `axe.run(container)` for every `Primitives/*`, `Components/*` and `Screens/*` story (rule `color-contrast` disabled in jsdom, which cannot compute it), failing on any violation; then check contrast in the built Storybook with the a11y addon panel for each `Screens/*` story. Fix violations in the owning primitive/composite. Expected exceptions to record in `design/parity-notes.md` rather than fix: disabled controls (`.dis`, opacity .45, exempt under WCAG 1.4.3), the "coming in MVP" disabled tab (opacity .6), decorative editor line numbers (`--ln`).
- [ ] **Step 5: Final verification** `npm test && npm run typecheck && npm run build-storybook`. Expected: all PASS.
- [ ] **Step 6: Commit** `chore: parity and accessibility pass`.

---

## Self-Review

- **Spec coverage:** 24 artboards → Tasks 14 (3), 15 (5), 16 (3), 17 (8), 18 (4), 19 (Overview = `Main`), total 3+5+3+8+4+1 = 24; enforced by the Task 19 coverage test against `canvas.json` `order`. Tokens → Task 2; primitives → Tasks 3–6; shared composites → Tasks 6 (SecretField), 7–12; fixtures → Task 13.
- **Prototype class coverage:** every class used in the 24 boards maps to a component: `.top/.brand/.sep/.switch/.org/.tabs/.count-idle` → Tasks 4, 8; `.btn*/.iconbtn/.dis` → Task 3; `.st*` → Tasks 3, 4; `.cmd/.lbl/.kind/.tref/.avatar/.sn` → Task 4; `.banner*/.b-ico/.overlay/.dialog/.d-b/.d-f/.pop` → Task 5; `.field/.flabel/.help/.input/.prefix/.seg/.toggle/.cbx/.radio-card/.rdot` → Task 6; table rules, `.num/.grp/.child/.tree/.mid/.last/.needs/.filters/.fchip` → Task 7; `.subnav/.grp-h` → Task 8; `.termwrap/.termbar/.vtab/.soon/.soon-tag/.term/.t-*/.cursor/.conn` → Task 9; `.side/.sec/.sec-h/.kv/.meter/.chain/.cstep/.cbox/.here/.future` → Task 10; `.editor/.ln/.md-*` → Task 11; `.steps/.step/.done/.sentence/.slot` → Task 12; `.mono/.muted/.faint/.row/.grow` → Task 2 utilities. Defined but unused in any board: `kbd`, `.note`, `.banner.late` class (its colors are used by the Timed out notice), `.t-cy`, `.t-mag`, `.t-del` (kept as tones, no dedicated story).
- **Type consistency:** `RunStatus`/`RUN_STATUSES`/`statusTokens` (Task 2) used in Tasks 3, 4, 7, 10, 13, 17; `TicketKind` (Task 4) used in Tasks 7, 10, 13; `BannerTone` (Task 5) used in Task 17; `SecretFieldState` = `'empty'|'entering'|'saved'|'replacing'` and `CredentialType` (Task 6) used in Tasks 13, 15, 18; `Ticket`/`Actor`/`Label`/`RunSummary`/`TicketGroup` defined in Task 7 (`src/mocks/types.ts`) and consumed by Tasks 8, 10, 13, 16, 17; `TermLine`/`TermTone`/`ConnectionState` (Task 9) and `ChainStep` (Task 10) used in Task 13 `RunDetailData` and Task 17; `RuleDraft`/`RuleTarget` (Task 12) extended by `Rule` in Task 13; `Project`/`Skill`/`Rule`/`AgentSettings`/`IgnoredCommand`/`RunDetailData` (Task 13) consumed by Tasks 14–18. No task consumes anything defined in a later task.
- **Corrections made against the prototype in review:** status glyphs (starting is a dashed ring, idle is a disc with a bar), Runs list grouped by ticket (no parent/child runs) with filters Needs you / Active / Queued / Ended / All + Ignored, cancel confirmation is a non-modal popover (not a dialog), the collapsed side panel is a 48 px rail, ended runs show "View ticket" (no Retry button exists), starting/cancelled runs show placeholders instead of an empty terminal, the run top bar has no project tabs, the global top bar (Projects, Setup) has no project switch, Kbd dropped (unused).
- **Open item for the reviewer:** the plan assumes the design system lives in `web/src/ds` inside the future control-plane SPA. If you'd rather have a separate package (`packages/ui`) so the SPA depends on it, only Task 1's scaffolding and import aliases change.
