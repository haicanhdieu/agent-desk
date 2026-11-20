<!-- dev-plan: kind=spec id=skills-review-diff rev=1 hash=b33d86d46056 source=issue#175 -->
# Skills editor Preview and Diff views: design

Date: 2026-11-20 · Status: draft for approval · Source: ticket "Implement the Review and Diff actions in the Skills
editor" · Sensitive: no (web app only: no API, contracts, database, migration, `withOrg`/RLS, auth, webhooks,
secrets/tokens, terminal or run Job change. It does render untrusted skill text, so the security rules in
[Rendering untrusted skill text](#rendering-untrusted-skill-text) are binding.)

## Intent

On the Desk Skills page the editor header has an `Edit / Preview / Diff` segmented control. Only Edit does anything:
Preview and Diff just make the editor read-only. The ticket asks for the other two to work, so a person can read a
skill the way it will look and see what their unsaved edit changes before they commit it.

The ticket says "Review". The human confirmed it means the existing **Preview** tab ("i mean Preview from begining").
The label stays "Preview".

Decided by the human:

- **Preview** is a read-only Markdown mode. It shows the editor's current text as formatted Markdown ("show MD in
  present"). **Edit** stays the raw-code editor it is today.
- **Diff** compares the editor's current text with "this file on main branch".
- **Diff layout:** one column (each line once, removed and added lines marked), not side by side.
- **Libraries, not hand-written code:** the `diff` package for the line diff and **Streamdown** for Markdown, chosen
  because it supports tables and Mermaid diagrams. The human asked for both tables and Mermaid diagrams. Both are
  undecided under [Needs approval](#needs-approval) until the human approves each in writing.
- Skill text keeps the plain-React-text, no-raw-HTML rule.

## How it works today

- `apps/web/src/screens/DeskSkills.tsx`: the `SkillEditor` holds the draft (`value`) in local state, initialised from
  `skill.body`. `dirty` is `value !== skill.body`, which drives the "Unsaved changes" chip. Discard resets `value` to
  `skill.body`. The view (`'edit' | 'preview' | 'diff'`) is local state too. For Preview and Diff the `CodeEditor` is
  only made `readOnly`. Diff also passes the `changedLines` prop, which only stories set (`[17]`).
- `apps/web/src/app/routes/o.$org.p.$project.desk.skills.tsx` loads the open skill with `deskQueries.skill`
  (`GET /api/projects/{id}/skills/{name}` → `SkillDto { body, sha, … }`) and passes it in through `toSkill`.
- "This file on main" is that `skill.body`. The API reads `SKILL.md` through `CodeHostAdapter.readSkill`. The GitHub
  adapter (`packages/core/src/adapters/github/codehost.ts`) calls the contents API with no `ref`, so it reads the
  repo's **default branch**, the branch the page labels "main" and that commits go to. The page already holds it. No
  new request is needed.
- `CodeEditor` draws Markdown with the in-house line highlighter `highlightMarkdown.ts`. Nothing in the web app
  renders Markdown to formatted output or computes a diff. The run transcript shows Markdown literally.
- The web app has no Tailwind and no shadcn. Styling is CSS Modules with tokens from `apps/web/src/ds/tokens.css`
  (which already has `--term-add-bg`, `--term-del-bg`, `--editor-changed-bg`, `--ok`, `--err`).
- `docs/conventions/security.md` §"Untrusted input": repo file contents, skills included, are untrusted. They are
  rendered as text (React escaping), with no `dangerouslySetInnerHTML` without a sanitizer.
- The PRD defers a skills "versioning UI". This change adds no history view.

## Goals

1. Preview shows the editor's current text (draft included, saved or not) as formatted, read-only Markdown, with
   tables drawn as tables and `mermaid` code fences drawn as diagrams.
2. Diff shows, in one column, how the editor's current text differs from the skill as last loaded from main.
3. Preview and Diff have clear loading, empty and error states where they apply (ticket).
4. Edit keeps its current behavior.

## Constraints

- Web app only (`apps/web`). Layering stays `web → contracts`. No contract, API, worker or core change (rule 1, 2).
- Design tokens only (rule 10). Every new or changed shared component has a story for each state (rule 10,
  [UI and Storybook](#ui-and-storybook)).
- Strict TS: no `any`, no unexplained casts (rule 11).
- Skill text is untrusted (rule 6, security.md).
- No new dependency is added before the human approves it ([Needs approval](#needs-approval)).
- Heavy, route-specific code is lazy-loaded (frontend.md §12).

## Approaches

Three ways to build both views were weighed in planning:

1. **Hand-written in the web app:** a small line diff and a small Markdown-subset formatter that emit React
   elements. No new dependency, safe by construction. No tables or diagrams unless we write them ourselves.
2. **`diff` + `react-markdown` (+ `remark-gfm` for tables):** well-known libraries with no raw HTML by default. No
   Mermaid without more work.
3. **`diff` + Streamdown with its Mermaid plugin:** tables built in (bundled GFM), Mermaid through
   `@streamdown/mermaid`, a hardened sanitizing pipeline. Its default look expects Tailwind and shadcn variables,
   which this repo does not use, so every element is restyled here.

**The human picked 3.** They want tables and Mermaid from one library that supports both ("prefier on lib support
all").

## Design

### Where the code goes

- `apps/web/src/components/lineDiff.ts`: pure helper. `lineDiff(base: string, draft: string): DiffLine[]` wraps
  `diffLines` from `diff`. `DiffLine` is `{ kind: 'same' | 'add' | 'del'; text: string; baseNo?: number; draftNo?:
  number }`. Unit tested.
- `apps/web/src/components/SkillDiff.tsx` (+ `.module.css`, `.stories.tsx`, `.test.tsx`): the Diff view.
- `apps/web/src/components/frontMatter.ts`: pure helper. `splitFrontMatter(text)` returns
  `{ fields: { key: string; value: string }[]; body: string }` for a leading `---` … `---` block. Unit tested.
- `apps/web/src/components/SkillPreview.tsx` (+ `.module.css`, `.stories.tsx`, `.test.tsx`): the Preview view. It is
  the only module that imports `streamdown` and `@streamdown/mermaid`.
- `apps/web/src/screens/DeskSkills.tsx`: `SkillEditor` renders `CodeEditor` for Edit, `SkillPreview` (lazy) for
  Preview and `SkillDiff` for Diff, all fed from the same `value` and `skill.body`. The header, the commit bar and the
  draft stay as they are.
- Export the two components from `apps/web/src/components/index.ts`, as the folder does today.
- No route change: the route already passes `skill.body` and keeps the draft.

Agent call: put both views in `components/` as shared pieces with their own stories. Reason: frontend.md keeps
composites there, and stories per state are required.

### The editor column across views

- Switching views keeps the draft, as today (`value` lives in `SkillEditor`).
- Preview and Diff are read-only. The "Unsaved changes" chip, Discard and Commit work the same in all three views.
- The view fills the editor column's scroll area, like `CodeEditor`, so the header and the commit bar stay in view
  (the existing `skills-layout` behavior).

Agent call: Edit is left exactly as it is, including the story-only `changedLines` marks. Reason: the human said to
keep Edit as the raw-code editor, and changing its marks is outside the ticket.

### Diff

- **Baseline:** `skill.body`, the default-branch file as last loaded by the page. It is the same text the "Unsaved
  changes" chip and Discard use. If a background refetch brings a newer main, the baseline follows it, as the chip
  and Discard already do.
- **Compared text:** the editor's current `value`.

Agent call: the baseline follows the newest loaded main, not the version the draft started from. Reason: it matches
the chip and Discard, and it needs no route change. The case is rare (the skill refetches only after the query goes
stale). When it happens, Commit already gets a 409 and restarts the draft from the new main, so Diff then shows the
right thing again.
- **Layout (human):** one column, every line of the file once, in order:
  - unchanged lines plain;
  - removed lines (in main, not in the draft) on `--term-del-bg`, with a `−` glyph in `--err`;
  - added lines (in the draft, not in main) on `--term-add-bg`, with a `+` glyph in `--ok`;
  - two narrow line-number columns (main's number, then the draft's), each blank where the line does not exist on
    that side;
  - line text in the editor's mono font, coloured with `highlightMarkdown` as in `CodeEditor`.
- **Accessibility:** a labelled region "Changes against main". Removed and added lines carry visually hidden
  "Removed"/"Added" text, so status is not conveyed by colour alone (frontend.md §10).
- **Empty state:** when the draft equals main, no lines are listed. The view shows the message "No changes. The
  editor matches main."
- **Loading / error:** none apply. The diff is computed in the browser from text the page already holds, with no
  request. The page's own loading and error states cover loading the skill.
- Line endings: compare as stored. A CRLF-only change shows as changed lines.

Agent call: the empty-state copy "No changes. The editor matches main." Reason: no prototype board exists for this
state. The copy pass can reword it.

Agent call: whole file shown, no collapsing of unchanged runs. Reason: the human picked "each line once" with the
whole file for context, and SKILL.md files are short.

Agent call: no `useMemo` around the diff unless a profile shows a cost. Reason: frontend.md §12 says not to memoise
by default.

### Preview

Render pipeline, in `SkillPreview`:

1. `splitFrontMatter(value)`. When there is front matter, show its fields (`name`, `description`, …) above the body
   with the existing `KeyValue` component, as text.
2. Render `body` with `<Streamdown mode="static" parseIncompleteMarkdown={false} skipHtml controls={false} …>`.
   - Tables, task lists and strikethrough come from Streamdown's bundled GFM. No extra package.
   - `mermaid` code fences render as diagrams through `createMermaidPlugin` from `@streamdown/mermaid`, configured as
     in [Rendering untrusted skill text](#rendering-untrusted-skill-text).
   - Other code fences render as plain mono blocks. The Shiki highlighter plugin (`@streamdown/code`) is not added.
3. Look: every element Streamdown draws (headings, paragraphs, lists, blockquote, code, inline code, table parts,
   links, horizontal rule) is styled through the `components` prop and/or a CSS Module scoped to the preview
   container (Streamdown's `data-streamdown="…"` attributes may be used as selectors), with design tokens only.
   Tailwind and shadcn variables are not added.

Agent call: front matter is split off and shown as fields, not passed to Streamdown. Reason: without a front-matter
plugin, Markdown reads the leading `---` block as a rule plus a heading, which misreads every SKILL.md. Adding
`remark-frontmatter` would be another dependency.

Agent call: `controls={false}`, which removes Streamdown's copy, download, fullscreen and pan/zoom buttons on tables,
code and diagrams. Reason: they are Tailwind-styled, and they add downloads and actions the human did not ask for.

Agent call: `mode="static"`. Reason: the text is complete, not streamed, so streaming repair (`remend`) must not
change what the skill says.

**States (Preview):**

| State | When | What the person sees |
| --- | --- | --- |
| Loading | First open of Preview while the lazy module downloads | A `Skeleton` shaped like text lines in the editor column (frontend.md §9) |
| Default | Text rendered | Front-matter fields, then the formatted body |
| Empty | The text is empty or only whitespace (front matter aside) | "Nothing to preview yet. Write the skill in Edit." (front-matter fields still show when present) |
| Error | Rendering throws or the lazy module fails to load | An error boundary around the view shows `Banner` tone `err`, title "Could not show the preview", with a "Try again" button that remounts the view. Edit, Diff, Discard and Commit stay usable |
| Diagram loading | A Mermaid fence while the diagram renders | A "Loading diagram…" placeholder in the diagram's place, styled with tokens, never a blank gap |
| Diagram error | Mermaid cannot parse or draw a fence | In that diagram's place only, via Streamdown's `mermaid.errorComponent`: a small `err`-tone notice "This diagram could not be drawn", Mermaid's error message as text, and the fence source as a plain code block. The rest of the preview renders normally. A "Try again" button calls the `retry` it is given |

Agent call: the empty, error and diagram-error copy above. Reason: there is no prototype board for these states.
The copy pass can reword it.

Agent call: lazy loading in two steps. `SkillPreview` is loaded with `React.lazy` on the first open of Preview. The
Mermaid plugin (and with it `mermaid`) is loaded with a dynamic `import()` only when the text contains a
` ```mermaid ` fence. Reason: Streamdown is about 162 kB gzipped and Mermaid about 178 kB gzipped plus per-diagram
chunks (bundlephobia). Most skills have no diagram, and frontend.md §12 requires lazy-loading heavy code.

### Rendering untrusted skill text

Skill text comes from the repo and is untrusted. Binding rules:

- **No raw HTML from skill text:** `skipHtml` is always set, so HTML in the Markdown is dropped, not rendered.
  Neither `rehype-raw` nor any other plugin that turns text into HTML is added. Streamdown's own sanitizing chain
  (`rehype-sanitize`, `rehype-harden`) stays on.
- **Mermaid in strict mode:** the plugin is created as `createMermaidPlugin({ config: { securityLevel: 'strict' } })`,
  set explicitly even though it is the plugin's default. No code path changes `securityLevel`, `htmlLabels`, `secure`
  or `startOnLoad`. Mermaid's `secure` key list stays as it is, so `%%{init}%%` directives in skill text cannot loosen
  it. A unit test asserts the config passed to the plugin.
- **The one HTML insertion:** Streamdown places Mermaid's SVG with `dangerouslySetInnerHTML`. With
  `securityLevel: 'strict'`, Mermaid sanitizes its output with DOMPurify first. That meets security.md's "no
  `dangerouslySetInnerHTML` without a sanitizer". The app adds no other `dangerouslySetInnerHTML`.
- **Links:** Streamdown's default URL transform stays (it drops `javascript:`, `data:` and other unsafe schemes).
  Links open in a new tab with `rel="noopener noreferrer"`.
- **Images:** Markdown images are not fetched. The `img` element is overridden to show its alt text (or the URL as
  text when there is no alt).
- Everything else is React text.

Agent call: images are shown as text, not loaded. Reason: an image URL in untrusted repo text would make every
viewer's browser call a third-party server. No skill needs images to be read.

Agent call: Streamdown's link-safety modal is off and links are plain new-tab links. Reason: the modal is
Tailwind-styled, and the URL transform already blocks unsafe schemes.

### Tests (unit and component)

- `lineDiff`: unchanged text → all `same`. A line added, removed or changed, at the start, middle or end, and
  last-line-without-newline cases get correct kinds and line numbers.
- `splitFrontMatter`: with, without, unclosed and empty front matter.
- `SkillDiff`: lists removed and added lines with their glyphs, hidden labels and numbers. Shows the empty message
  when equal.
- `SkillPreview`: renders headings, a table (`role="table"`), front-matter fields. Drops raw HTML
  (`<script>`, `<img onerror>`, `<a href="javascript:…">` in the text produce no such element or attribute). Renders
  an image as its alt text. Shows the empty state. Shows the error state when rendering throws. Passes
  `securityLevel: 'strict'`.
- `DeskSkills`: switching Edit → Preview → Diff → Edit keeps the draft. Preview and Diff are read-only. Commit sends
  the draft from any view.
- jsdom has no layout, SVG measuring or `IntersectionObserver`, so Mermaid cannot draw there. Following the
  `fakeXterm` precedent in `apps/web/src/test/setup.ts`, unit tests and the stories smoke test get a test double for
  `mermaid` (or `@streamdown/mermaid`) that resolves an SVG, or fails, on demand. Real drawing is proven by the mock
  e2e below.

Agent call: a test double for Mermaid in jsdom, with real drawing proven only in Playwright. Reason: Mermaid needs a
real browser. This is the same split the repo uses for xterm.

### E2E

A mock Playwright spec (web-only behavior; nothing crosses the API, worker, runner or fake pod), for example
`apps/web/e2e/mock/skills-preview-diff.spec.ts`, using a mock skill fixture in `apps/web/src/mocks/skills.ts`. Extend
an existing fixture or add one, with front matter, a table, a valid `mermaid` fence and an invalid one. It covers:

- Preview shows formatted Markdown (heading, table, front-matter fields), is read-only, and draws the valid diagram as
  an SVG. The invalid fence shows the diagram error while the rest renders.
- Preview of an unsaved edit shows the edited text.
- Diff with no edits shows "No changes. The editor matches main."
- After an edit, Diff shows the removed and added lines. Discard returns Diff to the empty state.
- Switching views keeps the draft, and Commit works from Preview and Diff.

Agent call: mock e2e only, no local-stack spec. Reason: the change is in the web app only and adds no API, worker or
runner behavior (tests-and-e2e.md §3a).

## UI and Storybook

Screens and components this changes:

- `screens/DeskSkills` (Skills editor column): the Preview view gains loading (lazy module), default (formatted
  Markdown with front-matter fields, table and diagram), empty, error, diagram-loading and diagram-error states. The
  Diff view gains default (one-column removed/added lines) and empty ("No changes. The editor matches main.")
  states. The Edit view is unchanged.
- `components/SkillPreview` (new): default, with table, with diagram, diagram loading, diagram error, empty, error,
  loading (the lazy fallback).
- `components/SkillDiff` (new): with changes (added, removed and changed lines) and empty.

Prototype: skipped by the human at planning time

**Blocker: Storybook first.** Before any task that implements this UI in `apps/web/src/{app,features}` or wires it to
data starts, the related Storybook stories are added or updated and reviewed: every changed or new `ds/`,
`components/` and `screens/` piece has a story for each state above (default, loading, empty, error, and the others
the spec names), fed from `@/mocks` fixtures. No UI implementation work begins until that is done.

Agent call: the new Preview and Diff screen stories (for example `DeskSkillsPreview`, `DeskSkillsDiff`) are not
prototype boards, so they are not registered in `canvas.json`, `screens/storyIds.ts` or `scripts/parity.mjs`.
Reason: no board was drawn. The existing `DeskSkills` board (Edit view) must show no new parity drift.

## Left to the builder

- Exact CSS for each Markdown element and the diff rows, within existing tokens. A new token goes in `tokens.css`
  only if no existing one fits.
- How the "Loading diagram…" placeholder is restyled. Streamdown draws it with Tailwind classes and fixed English
  text. Style it with tokens through the scoped CSS Module, or, if that cannot reach it, render `mermaid` fences
  through a `components` override that keeps the strict plugin. Either way it must not be a blank gap.
- The shape of the Mermaid test double, and whether it mocks `mermaid` or `@streamdown/mermaid`.
- The exact fixture text for the mock skill.

## Needs approval

Each item is **undecided** until the human approves it in writing. None of these packages is a dependency of
`apps/web` today. All would go in `apps/web/package.json` `dependencies` and `pnpm-lock.yaml`, with the repo's usual
`^` ranges. Facts were checked on the npm registry and bundlephobia on 2026-11-20.

1. **`diff`** 9.0.0 (released 2026-04-13). License BSD-3-Clause. About 7.9 kB gzipped. No dependencies of its own.
   Ships its own TypeScript types. Used for the line diff (`diffLines`). It is already in the lockfile only as a
   build-time dependency of `@tanstack/router-utils` (the router plugin), not as a web dependency. Existing
   alternative: none in the web app. The fallback is a hand-written line diff (Approach 1).
2. **`streamdown`** 2.8.0 (released 2026-11-17, three days before this spec; the previous release is 2.7.1 from
   2026-10-19). License Apache-2.0. About 162 kB gzipped with its parser stack. Peer `react`/`react-dom`
   `^18.0.0 || ^19.0.0`, which fits the repo's React `^19.3.1`. Tables, task lists and strikethrough are built in
   through its bundled `remark-gfm`. It brings 15 runtime packages, none in the repo today: `clsx`, `marked`,
   `remend`, `unified`, `rehype-raw`, `remark-gfm`, `remark-parse`, `rehype-harden`, `remark-rehype`,
   `tailwind-merge`, `rehype-sanitize`, `unist-util-visit`, `html-url-attributes`, `hast-util-to-jsx-runtime`,
   `unist-util-visit-parents`. Tailwind itself is not a dependency. Streamdown only expects it for its default look,
   which this design replaces. Existing alternative: none.
3. **`@streamdown/mermaid`** 1.0.4 (released 2026-11-17; previous 1.0.3 from 2026-09-30). License Apache-2.0. Peer
   `react ^18.0.0 || ^19.0.0`. Its only dependency is `mermaid ^11.16.1`. It defaults to `securityLevel: 'strict'`.
   Mermaid is a separate plugin package, not built into Streamdown. Existing alternative: none.
4. **`mermaid`** 11.17.2, which `@streamdown/mermaid` pulls in (the plugin requires `^11`; Mermaid's latest major is
   12.3.0). License MIT. About 178 kB gzipped for the main chunk plus per-diagram chunks. Its own dependencies
   include `d3`, `cytoscape` (+ layouts), `dagre-d3-es`, `elkjs`, `katex`, `dompurify`, `marked`, `dayjs`, `stylis`,
   `roughjs`, `chevrotain`, `@mermaid-js/parser`, `@braintree/sanitize-url`, `@iconify/utils`, none in the repo
   today. It is the reason the diagram code is lazy-loaded only when a skill has a diagram.

If an item is turned down:

- `diff` turned down: write the line diff by hand in `lineDiff.ts`, with the same `DiffLine` output. The rest of the
  design does not change.
- `streamdown` turned down: Preview is not planned. Planning stops and goes back to the human, because the human
  chose this library and replacing it is their decision.
- `@streamdown/mermaid` or `mermaid` turned down: Preview ships with Streamdown alone. `mermaid` fences render as
  plain code blocks. The diagram states, the Mermaid test double and the diagram e2e cases are dropped.
- Versions: the plan installs the versions the human approves. The versions listed above are the latest as of this
  spec. The human may pick the earlier releases (`streamdown` 2.7.1, `@streamdown/mermaid` 1.0.3) instead.

Agent call: these fallbacks. Reason: they keep each approval independent and never swap in a library the human did
not choose.

Agent call: Mermaid uses its `dark` theme, with `themeVariables` taken from the app's tokens where Mermaid accepts
them. Reason: the app's palette is dark, and the default light theme would be unreadable on it.

Agent call: list `mermaid` as its own item although it arrives through the plugin. Reason: it is the largest new code
in the change and carries the SVG sanitizer the security rules depend on.
