<!-- dev-plan: kind=spec id=shared-pagination rev=2 hash=78d0477e708c source=issue#146 -->
# Shared pagination for every data list (API and web): design

Date: 2026-11-19 · Status: draft for approval · Source: issue #146 · Sensitive: no (no migration, no change to
`withOrg`/RLS, auth, webhooks, secrets, terminal or the run Job; existing list queries change shape but keep their
org/project scope and authz)

## Intent

With many runs (the human's example is 1000), the Run list loads and draws every run at once, and the page gets slow.
The human wants a smaller page (20 runs by default) and a way for people to switch to the page they want.

The human does not want a fix for runs alone. Neither the web app nor the API has a pagination design today, so this
change sets one **rule** for both and applies it to every data list in the app.

Decided by the human:

- **Numbered pages with jump to page** ("Page 3 of 50", a box to type a page number).
- **Page size:** 20 by default; a chooser lets people change it, and the browser remembers the choice.
- **Grouped by ticket** pages by runs: a ticket whose runs cross a page break shows its header again on the next page.
- **Follow best practice for offset pagination** and correct the background load of up to 1000 runs that feeds the
  Run list's counts. That load is part of the performance problem.
- **The lists that get paging:** Runs, Needs you, Ignored, Projects, Rules, Skills and setup script version history.
  The GitHub repo picker, the run log/terminal and menus such as the project switcher are not data lists.

## How it works today

- `runs.list` is the only paged route. It takes a keyset `cursor` and `limit` (≤ 100, default 50) and returns
  `nextCursor`, with no total. `docs/conventions/backend.md` §11 and `docs/conventions/database.md` §8 require keyset
  cursors and forbid `OFFSET` on growing tables.
- The web app (`apps/web/src/features/runs/queries.ts`) follows `nextCursor` for up to 10 pages of 100 runs and draws
  them all in one table. The Runs route loads that list twice: once unfiltered (`'all'`) and once for the chosen
  filter. The unfiltered copy feeds the Ended/All chip counts, "N of max runs" on each ticket group, the
  "Today: N runs, F failed" line and the needs-you banner (the newest idle run and the oldest queued run). Past 1000
  runs everything is capped without telling anyone (logged in `apps/web/CONTRACT-GAPS.md`).
- `projects.list`, `projects.ignored` (capped at 100 in the API, `IGNORED_LIMIT`), `rules.list`, `skills.list` (read
  from the repo through the code host, not from Postgres) and `setupScript.versions` return plain arrays.
- Other code reads some of those arrays in full: the project switcher menu and the Needs you page's project list
  (`projects.list`), the Rules page's skill picker (`skills.list`), the Skills page's rule references (`rules.list`),
  the setup flow's "already exists" checks (`skills.list`, `rules.list`) and run detail's runs of the same ticket
  (`runs.list` with `ticket`).
- The web app has no pagination control, and the existing prototype boards draw none. The approved boards for this
  change are listed under "UI and Storybook".

## Goals

1. One pagination rule, written down, for every data list in the API and in the web app.
2. Every listed data list shows numbered pages, previous/next, jump to page and a page-size chooser (20 by default,
   remembered in the browser).
3. The Run list page loads only the page it shows. The numbers it used to compute from 1000 runs come from the server.

## Non-goals

None stated beyond the human's list of what is not a data list (the repo picker, the run log/terminal, menus).

## Approaches

1. **Offset pagination with a total (picked by the human).** The API takes `page` and `pageSize`, returns the page's
   items plus `total`, and the web app shows numbered pages and jump to page. Trade-off: rows inserted while someone
   pages shift later pages by one, so a row can show up twice or be skipped when moving on. Deep pages cost more,
   because the database still walks the skipped rows. Jump to page and "Page 3 of 50" are only possible this way.
2. **Keyset cursor with Previous/Next only (the current rule).** Stable under inserts and cheap at any depth, but it
   can't jump to a page or say how many pages there are. The human rejected it for that reason.
3. **"Load more" / infinite scroll.** The simplest UI, but the list grows long again after a few clicks, which brings
   back the drawing cost. Rejected.

## The rule (replaces the keyset rule)

### Record of the change

- **New ADR** `docs/adr/0026-offset-pagination-for-data-lists.md` (status Proposed until the human accepts it). It
  records the decision (offset pages with a total for every data list), the alternatives above and their trade-offs,
  and the consequences: page drift under concurrent inserts is accepted, and deep offsets cost more.
  Agent call: an ADR, because this reverses an architectural rule two convention docs state.
- **Convention updates**, in the same PR as the ADR. A newer accepted doc wins, so the stale text is fixed, not left
  in place:
  - `docs/conventions/backend.md` §11: the keyset line becomes the offset rule below.
  - `docs/conventions/database.md`: §8's `MUST paginate … keyset` line, the checklist item on keyset pagination, and
    the `SHOULD` on composite indexes that names the keyset cursor (its index matches the list's `ORDER BY` columns
    instead). `OFFSET` is allowed for data lists, only with the ordering rule below.
  - `docs/conventions/frontend.md`: a data list uses the shared `Pagination` component, page in the URL, page size
    from the shared browser preference.
- These docs are rules agents follow, so that PR waits for a human (AGENTS.md: PRs that change agent rules wait for a
  human).

### API rule

- **Query:** every data-list route takes `page` (integer ≥ 1, default 1, at most 2147483647 like the other integer
  params in `routes.ts`) and `pageSize` (integer 1–100, default 20).
  Agent call: the API accepts any size from 1 to 100 and the web chooser offers 20, 50 and 100, so other clients and
  tests aren't tied to the UI's three options.
- **Response envelope:** `{ items: T[], page: number, pageSize: number, total: number }`. `total` counts every row
  that matches the route's filters. The client derives the page count as `ceil(total / pageSize)`.
  Agent call: return only `total` and not `totalPages` too, because the second can be derived and could disagree.
- **Past the end:** a `page` beyond the last page returns 200 with `items: []` and the real `total`, never a 4xx. The
  client then moves to the last page.
  Agent call: lets a client recover with one rule and avoids an error when rows were deleted between two requests.
- **Ordering:** every paged query has a fixed `ORDER BY` that ends in a unique column (`id`, or the natural unique key),
  so pages never overlap or skip while no rows change.
- **Counting:** `total` comes from a `count(*)` with the same `WHERE`, run in the same `withOrg` transaction as the page
  query. It is not a window function, because a page past the end returns no rows and so no count.
- **Scope:** unchanged. Every page and count query keeps its existing `withOrg`/project scope and authz (AGENTS.md
  rules 4 and 7).
- **Accepted drift:** a row inserted or deleted while someone pages shifts later pages by one row.
  Agent call: this is the known cost of the offset pages the human chose, and the ADR records it.

### Shared code (no new dependency)

- `packages/contracts/src/schemas/page.ts`:
  - `PageQuery`: a Zod object with `page` and `pageSize`, coerced from the query string, with the defaults above.
    Route queries extend it, as `RunListQuery` does with `filter` and `ticket`.
  - `pageOf(item)`: builds the response envelope schema for an item schema.
  - The pure helpers `pageWindow({ page, pageSize }) → { limit, offset }`, `toPage(items, total, query)`,
    `slicePage(all, query)` (for lists that are not in Postgres) and `pageRange(page, pageSize, total)`, which gives
    the first and last row numbers and the page count.
  - Agent call: these live in contracts because they define what the contract's `page` means and both the API and the
    web app use them. They are framework-free, so the layering (`web → contracts`) holds.
- The API services use `pageWindow` with Drizzle's `.limit()` / `.offset()` and `toPage`. Nothing new is needed in
  `packages/db`.

## Lists and routes

| List (screen)                               | Route                                | Order                         | Source                                    |
| ------------------------------------------- | ------------------------------------ | ----------------------------- | ----------------------------------------- |
| Runs (Runs page, flat and grouped)          | `runs.list`                          | `queued_at desc, id asc`      | Postgres (existing index `runs_project_queued_idx`) |
| Needs you (Needs you page)                  | `runs.list` with `filter=needs_you`  | same                          | Postgres                                  |
| Ignored (Runs page, Ignored chip)           | `projects.ignored`                   | `received_at desc, id asc`    | Postgres (`IGNORED_LIMIT` cap removed)    |
| Projects (Projects page)                    | `projects.list`                      | `created_at asc, id asc`      | Postgres                                  |
| Rules (Desk → Rules)                        | `rules.list`                         | `created_at asc, id asc`      | Postgres                                  |
| Skills (Desk → Skills)                      | `skills.list`                        | `name asc`                    | Code host, then `slicePage` in the API    |
| Setup script history (Desk → Setup)         | `setupScript.versions`               | `version desc`                | Postgres                                  |

- `runs.list`: `cursor` and `limit` are replaced by `page` and `pageSize`, and `nextCursor` by the envelope. The
  cursor encode/decode code in `runs.service.ts` goes away.
- Each route's `response` in `routes.ts` becomes `pageOf(<ItemDto>)`, and its `query` becomes `PageQuery` (extended
  where it has filters).
- Agent call: skills are paged in memory in the API after the code host lists them, because the code host returns the
  whole skills folder and has no paging of its own.
- Agent call: none of these orders needs a new index. Runs and ignored events already have matching indexes, and
  projects, rules and setup versions are small per org or project. So there is no migration.
- These are breaking changes to the response shape, and the web app is the only client. Each list's contract, API and
  screen change must land together, or the web build breaks. The local e2e specs and API integration tests that read
  these routes change with them.

### Readers that need the whole set

These readers are not screens with paging. They read page 1 with `pageSize=100` (the maximum) in one request: the
project switcher menu, the Needs you page's project list, the Rules page's skill picker, the Skills page's rule
references, the setup flow's "already exists" checks and run detail's runs of the same ticket (bounded by
`maxRunsPerTicket` ≤ 50).
Agent call: one capped request instead of walking pages, because these sets are small by nature. Walking pages would
bring back the unbounded load this change removes. The cap is recorded as a row in `apps/web/CONTRACT-GAPS.md`.

## Run list numbers from the server

The Run list page no longer loads the unfiltered run list. A new route gives it everything it took from those 1000
runs:

- `runs.stats`: `GET /api/projects/:projectId/runs/stats?since=<ISO timestamp with offset>` returns `RunStatsDto`:
  - `counts`: `{ needs_you, active, queued, ended, all, ignored }`, one number per chip, with the same meanings as the
    `runs.list` filters and `projects.ignored`. The counts come from grouped queries, as `ProjectDto.counts` already
    does.
  - `today`: `{ total, failed }`: runs queued at or after `since`, and how many of those failed.
  - `idleRun`: the newest idle run as a `RunListItem`, or `null` (for the needs-you banner).
  - `nextQueuedNumber`: the number of the oldest queued run, or `null` (for the banner's "Run N is waiting").
- Agent call: one route for the page's summary numbers instead of fields on `ProjectDto`, because "today" depends on
  the person's local day (`since` is the browser's local midnight, as the "Today" line uses now). The project DTO is
  also read by every page.
- Agent call: `ProjectDto.counts` stays as it is, because the top bar and other pages still use it.
- **Runs per ticket:** `RunListItem` gains `ticketRunCount`, the number of runs that ticket has had in the project
  across all statuses. One grouped query computes it, for the tickets on the page only. It feeds "N of max runs" on
  the ticket group header.
  Agent call: a field on the list item keeps the shared envelope plain and costs one grouped query per page.
- The Runs route's loader then reads `runs.stats`, the current page of `runs.list` and, only on the Ignored chip, the
  current page of `projects.ignored`. `RUN_LIST_MAX_PAGES`, `truncated`, `chipCounts`, `runsPerTicket` and
  `todaySummary`'s list input go away. The `CONTRACT-GAPS.md` row on aggregate counts is removed as resolved.

## Web app

### State

- **Page:** in the URL as `?page=N`. The route's `validateSearch` parses it with a shared Zod piece in
  `apps/web/src/app/` (a missing or invalid value means 1). Page 1 leaves `page` out of the URL.
  Agent call: back, refresh and shared links return to the same page, as the filter already does with `?filter=`.
- **Page size:** a shared hook `usePageSize()` in `apps/web/src/app/`, saved in `localStorage` under one key
  (`agentdesk.pageSize`). It allows only 20, 50 or 100, and anything else means 20. If storage is blocked, it falls
  back for the visit. This follows `useGroupedPref`.
  Agent call: one remembered size for the whole app, not one per list, because the human asked for one rule and one
  remembered choice.
- **Resets:** changing the page size, the filter, the ticket filter or the grouped toggle goes back to page 1.
- **Past the end:** when the URL's page is beyond the last page (for example after deletes, or a hand-edited URL), the
  route replaces the URL with the last page. When `total` is 0, it shows the list's existing empty state.
- **Loading between pages:** the page on screen stays visible, marked `aria-busy`, with the controls disabled until
  the next page arrives. The first load uses the existing route loading skeleton, and a failed load uses the existing
  route error (Request ID and Retry), as the `RouteLoading` and `RouteError` boards show.
- **Query keys** include `page` and `pageSize`, so each page is cached on its own. Mutations and the project event
  stream keep invalidating by prefix (`runsKey`, the desk keys), which covers every page.
- **Live updates:** the project event stream keeps patching run status on the cached pages. A new run reaches page 1
  when the runs queries refetch, and later pages may shift by one (accepted drift above).

### The `Pagination` component

A new shared composite, `apps/web/src/components/Pagination.tsx`, drawn on the approved board
`design/prototype/project/Pagination.dc.html`. It is built from the existing `ds` `Button`, `TextInput` and `Select`,
styled with design tokens only, and has a story for each state (AGENTS.md rule 10). Every listed screen puts it
directly under its list.

At full width it is one row: the range on the left, the page buttons in the middle, and the tools on the right.

```
Showing 481–500 of 1,000      ‹ Previous  1  …  24  [25]  26  …  50  Next ›      Go to page [    ] Go   Rows per page [20 ▾]
```

- **Range:** "Showing <first>–<last> of <total>", with numbers grouped by thousands ("6,221–6,240 of 12,480").
- **Page buttons (wide set):** the first page, the last page, and the current page with one neighbour on each side,
  with "…" for the gaps. When every page fits, there is no "…" (for example 3 pages: `1 2 3`). On page 1 the set is
  `1 2 … 50`, and on the last page `1 … 49 50`. Each button has the accessible name "Page N", and the current one has
  `aria-current="page"` and is drawn with a stronger border and weight. The "…" is `aria-hidden`.
- **Previous / Next:** a chevron with the word. Previous is disabled on page 1 and Next on the last page.
- **Go to page:** a labelled number input (`inputmode="numeric"`) and a Go button, which is disabled while the input is
  empty. Enter works like Go. A number outside 1 to the last page is clamped to that range (typing 80 with 50 pages
  goes to page 50).
- **Rows per page:** a labelled `Select` with 20, 50 and 100.
- **Loading between pages:** the page on screen stays visible and the list is marked `aria-busy`. The `nav` is marked
  `aria-busy` too, and every control (page buttons, Previous/Next, input, Go, size) is disabled until the new page
  arrives.
- **Hidden:** when `total` ≤ 20 (one page at every size), the control is not drawn. Otherwise it is shown, including
  the size chooser, so someone on 100 rows can switch back.
- **One row at every width (the human's change while reviewing the prototype):** the control stays on one row and gets
  more compact as its own container narrows (container queries, not viewport media queries):
  - under 1070px: the "Go to page" and "Rows per page" labels and the "Previous"/"Next" words are hidden visually but
    kept for screen readers, and the arrows become square icon buttons;
  - under 790px: "Showing" is dropped (the range reads "481–500 of 1,000"), and the page buttons shrink to a narrow
    set: first, current and last, with "…" between them (`1 … 25 … 50`). The jump input and size select get narrower;
  - under 590px: the range is hidden, and buttons, input and select use a smaller height and text size with tighter
    gaps;
  - under 360px: only the current page shows between the arrows;
  - it wraps to a second row only at 240px or below.
  The breakpoints and sizes are the board's. The builder maps its sizes to existing design tokens.

### Screens

Each screen keeps its current layout, columns and copy. Only the control under the list and the server-fed numbers
are new. The boards' table headers predate some column renames (for example "Skill" where the app now says "Routing
rule"). The app's current columns win.
Agent call: pagination does not change columns, and those labels were settled in earlier merged work.

- **Runs, grouped** (`RunsPaged`, page 4 of 4, 63 runs): the page's runs grouped by ticket, and the control under the
  table ("Showing 61–63 of 63", pages `1 2 3 4`). A group that continues from the previous page shows its header
  again, with the ticket's full "N of max runs" (from `ticketRunCount`). Chip counts (Needs you 1, Active 2, Queued 1,
  Ended 59, All 63, Ignored 3), the "Today: 9 runs, 1 failed" line and the needs-you banner come from `runs.stats`.
- **Runs, flat** (`RunsFlatPaged`, page 51 of 51, 1,004 runs): one page of runs in server order ("Showing
  1,001–1,004 of 1,004", pages `1 … 50 51`).
- **Runs, loading another page** (`RunsPageLoading`): the current page stays on screen, with the table and the control
  `aria-busy` and the control's inputs disabled.
- **Runs, empty** (`RunsEmpty`): the existing "No runs match this filter" empty state with "Show all runs", and no
  control.
- **Ignored** (`RunsProblemsPaged`, page 2 of 2, 27 commands): the ignored rows are paged ("Showing 21–27 of 27"), and
  the silent cap at 100 is gone. The Ignored chip count comes from `runs.stats`. Empty (`RunsProblemsEmpty`): the
  existing "No ignored commands", with no control.
- **Needs you** (`NeedsYouPaged`, page 2 of 2, 21 runs): the run cards are paged ("Showing 21–21 of 21"). The tab
  badge and title count stay on the project's counts. Empty (`NeedsYouEmpty`): the existing "No runs need you right
  now.", with no control.
- **Projects** (`ProjectsPaged`, page 2 of 2, 26 projects): the table is paged ("Showing 21–26 of 26").
- **Desk → Routing rules** (`DeskRulesPaged`, page 2 of 2, 24 rules): the rule list is paged, and the control sits
  between the list and "Guards on every rule". Empty (`DeskRulesEmpty`): the existing "No routing rules yet" with
  "New rule", and no control.
- **Desk → Skills** (`DeskSkillsPaged`, page 2 of 2, 22 skills): the skill list in the left column is paged, and the
  control sits under that list. The editor pane is unchanged. Empty (`DeskSkillsEmpty`): the existing "No skills yet",
  and no control.
- **Desk → Workspace setup, version history** (`DeskSetupPaged`, page 2 of 2, 23 versions): the `VersionHistory` list
  is paged, with the control under it. The header count ("23 versions") is the response's `total`, not the length of
  the page. The existing states stay: loading (`DeskSetupVersionsLoading`, "Loading versions", `aria-busy`), error
  (`DeskSetupVersionsError`, "Could not load the version history. Reload to try again.") and empty
  (`DeskSetupVersionsEmpty`, "0 versions" and "No versions yet. The first save creates version 1."), with no control
  in any of them.
- **Any paged list, first load** (`RouteLoading`): the existing route loading skeleton (`role="status"`,
  `aria-busy`).
- **Any paged list, failed to load** (`RouteError`): the existing route error ("Internal server error", the request ID
  and Retry).

## UI and Storybook

Screens and components this changes:

- New `Pagination` component, with states: middle page with gaps on both sides, first page (Previous disabled), last
  page (Next disabled), few pages (no gaps), many pages, a jump value out of range (clamped), loading between pages
  (every control disabled, `aria-busy`), and hidden (`total` ≤ 20). Each is shown at full width and at the compact
  container widths (under 1070, 790, 590 and 360px).
- Runs screen: grouped and paged (with a continued ticket header), flat and paged, loading another page, empty, first
  load and error. Chip counts, the "Today" line and the banner come from the stats fixture.
- RunsProblems (Ignored): paged, and empty.
- Needs you screen: paged cards, and empty.
- Projects screen: paged.
- DeskRules: paged, and empty.
- DeskSkills: paged, and empty.
- DeskSetup's `VersionHistory`: paged (header count from `total`), loading, error and empty.
- Any paged list's route first load and route error (the existing boundaries).

Prototype: `design/prototype/project/Pagination.dc.html`, `design/prototype/project/RunsPaged.dc.html`,
`design/prototype/project/RunsFlatPaged.dc.html`, `design/prototype/project/RunsPageLoading.dc.html`,
`design/prototype/project/RunsEmpty.dc.html`, `design/prototype/project/RunsProblemsPaged.dc.html`,
`design/prototype/project/RunsProblemsEmpty.dc.html`, `design/prototype/project/NeedsYouPaged.dc.html`,
`design/prototype/project/NeedsYouEmpty.dc.html`, `design/prototype/project/ProjectsPaged.dc.html`,
`design/prototype/project/DeskRulesPaged.dc.html`, `design/prototype/project/DeskRulesEmpty.dc.html`,
`design/prototype/project/DeskSkillsPaged.dc.html`, `design/prototype/project/DeskSkillsEmpty.dc.html`,
`design/prototype/project/DeskSetupPaged.dc.html`, `design/prototype/project/DeskSetupVersionsLoading.dc.html`,
`design/prototype/project/DeskSetupVersionsError.dc.html`, `design/prototype/project/DeskSetupVersionsEmpty.dc.html`,
`design/prototype/project/RouteLoading.dc.html`, `design/prototype/project/RouteError.dc.html`

**Blocker: Storybook first.** Before any task that implements this UI in `apps/web/src/{app,features}` or wires it to
data starts, the related Storybook stories are added or updated and reviewed: every changed or new `ds/`,
`components/` and `screens/` piece has a story for each state above (default, loading, empty, error, and the others the
spec names), fed from `@/mocks` fixtures, matching the approved prototype boards, with each new board registered in
`canvas.json`, `screens/storyIds.ts` and `scripts/parity.mjs` together. No UI implementation work begins until that is
done.

## Testing

- **Contracts:** unit tests for `PageQuery` (defaults, bounds, coercion), `pageOf`, `pageWindow`, `toPage`,
  `slicePage` and `pageRange` (first and last page, past the end, `total` 0).
- **API integration** (each paged route): defaults, `page`/`pageSize` bounds (400 outside them), `total`, a page past
  the end (200, empty `items`), stable order with equal sort keys, and another org's rows never counted or returned.
  Also `runs.stats` (each count, `today` around `since`, `idleRun`, `nextQueuedNumber`, tenant scope) and
  `ticketRunCount`.
- **Web unit and route tests:** `Pagination` behaviour (buttons, gaps, clamping, hidden at ≤ 20), `usePageSize`
  (saved, invalid value → 20, storage blocked), `?page` parsing and the move to the last page, and the reset to page 1
  on filter or size change. MSW handlers and `@/mocks` fixtures return paged responses.
- **E2E** (AGENTS.md: every implementation): a mock Playwright spec per paged screen (moving between pages, jump to
  page, size chooser remembered after a reload, page in the URL, and the control staying on one row at a phone-width
  viewport), plus a local Playwright spec for the Run list with
  more than 20 runs created through the fake provider (page 2 shows the next runs, counts match).

## Left to the builder

- How the work is split into PRs of about 800 lines, within the constraint that each list's contract, API and screen
  land together and the ADR and convention updates go first.
- The exact Drizzle queries for the counts and `ticketRunCount`, provided they are grouped queries with no per-row
  queries (database.md §8).
- How the previous page stays on screen during navigation (router pending behaviour or Query placeholder data).

## Needs approval

None. Everything uses what the repo already has: Zod, Drizzle, TanStack Router and Query, the existing `ds`
components and `localStorage`.

## E2E requirements

These rules are requirements. Each is what a user can see at the UI; the feature is done when every case below passes as an e2e spec. Derived from this spec and the sibling frontend-design spec (§4 route table, §6 states), backend and database conventions (old rule only) and the listed prototype boards, not from the code.

### Rules

| Id    | Category            | Rule                                                                                                                                                                                                                                                  | Source                                   |
| ----- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| BR-1  | limit               | When a member opens any listed screen (Runs, Needs you, Ignored, Projects, Desk Rules, Desk Skills, setup version history) with more than 20 rows and no page size saved in the browser, they see only the first 20 rows → the list holds 20 rows, not all of them. | spec Intent, Goals 2, Web app State      |
| BR-2  | calculation         | When a list has more than one page, the member sees "Showing <first>–<last> of <total>" under the list, with thousands grouped → e.g. "Showing 481–500 of 1,000", "Showing 6,221–6,240 of 12,480", and a last page that is short reads "Showing 61–63 of 63". | spec `Pagination` Range; Pagination board |
| BR-3  | conditional-display | When a list's total is 20 or fewer, the member sees all rows and no pagination control (no buttons, no size chooser); when the total is above 20 the control is shown under the list, including the page-size chooser even when the size is 100.     | spec `Pagination` Hidden; Pagination board |
| BR-4  | conditional-display | When a list has several pages, the member sees page buttons for the first page, the last page and the current page with one neighbour each side, with "…" for gaps and none when every page fits → `1 2 3` for 3 pages, `1 2 … 50` on page 1, `1 … 49 50` on the last page, `1 … 24 25 26 … 50` in the middle; each button is named "Page N" and the current one is marked as the current page. | spec `Pagination` Page buttons; Pagination board |
| BR-5  | navigation          | When a member clicks a page button, they see that page's rows and the range updates → the clicked page is the current page and the address holds `?page=N`; on page 1 the address has no `page` parameter.                                          | spec Web app State Page, `Pagination`    |
| BR-6  | navigation          | When a member clicks Next or Previous, they move one page forward or back; on page 1 Previous is disabled and on the last page Next is disabled.                                                                                                  | spec `Pagination` Previous / Next        |
| BR-7  | navigation          | When a member types a page number in "Go to page" and clicks Go or presses Enter, they see that page; Go is disabled while the box is empty.                                                                                                       | spec `Pagination` Go to page             |
| BR-8  | validation          | When a member types a page number outside 1 to the last page in "Go to page" and goes, they land on the nearest valid page → 80 with 50 pages shows page 50 (and a number below 1 shows page 1).                                                     | spec `Pagination` Go to page; board "Jump out of range, clamped" |
| BR-9  | persistence         | When a member reloads, uses the browser Back button, or opens a shared link whose address has `?page=N`, they see page N of the same list; a missing or invalid `page` value shows page 1.                                                          | spec Web app State Page                  |
| BR-10 | navigation          | When the address names a page beyond the last page (hand-edited URL, or rows deleted meanwhile), the member sees the last page and the address changes to that page.                                                                                 | spec Web app State Past the end; API rule Past the end |
| BR-11 | feedback-state      | When a list has no rows, the member sees that screen's existing empty state and no pagination control → Runs "No runs match this filter" with "Show all runs"; Ignored "No ignored commands"; Needs you "No runs need you right now."; Desk Rules "No routing rules yet" with "New rule"; Desk Skills "No skills yet"; setup history "0 versions" and "No versions yet. The first save creates version 1.". | spec Screens; boards RunsEmpty, RunsProblemsEmpty, NeedsYouEmpty, DeskRulesEmpty, DeskSkillsEmpty, DeskSetupVersionsEmpty |
| BR-12 | limit               | When a member picks 20, 50 or 100 in "Rows per page", the list shows that many rows per page and returns to page 1; no other size is offered.                                                                                                       | spec Decided by the human, `Pagination` Rows per page, Resets |
| BR-13 | persistence         | When a member picks a page size and later reloads or opens another paged list, that size is still used on every paged list (one size for the whole app).                                                                                             | spec Web app State Page size             |
| BR-14 | validation          | When the browser holds an invalid saved page size, the member sees 20 rows per page; when browser storage is blocked, the page size still works for the visit and returns to 20 on the next visit.                                                    | spec Web app State Page size             |
| BR-15 | state-transition    | When a member changes the filter (a status chip or the Ignored chip), the ticket filter text or the "Grouped by ticket" toggle while on a later page, they see page 1 of the new result.                                                              | spec Web app State Resets                |
| BR-16 | feedback-state      | When a member moves to another page and it has not arrived yet, they still see the current page's rows, the list and the control are marked busy, and every control (page buttons, Previous/Next, Go box, Go, size) is disabled until the new page shows. | spec Web app Loading between pages, `Pagination` Loading; boards RunsPageLoading, Pagination |
| BR-17 | feedback-state      | When a paged screen is opened for the first time, the member sees the existing route loading skeleton (a busy status area), not an empty list or the control.                                                                                       | spec Screens Any paged list first load; board RouteLoading; frontend-design §6 Pending |
| BR-18 | feedback-state      | When a paged list fails to load, the member sees the route error ("Internal server error", the request ID and a Retry button), and Retry loads the page again.                                                                                     | spec Screens Any paged list failed; board RouteError; frontend-design §6 |
| BR-19 | calculation         | When an org has more than 1000 runs, the member sees the real total and can reach every run → e.g. "Showing 1,001–1,004 of 1,004" on page 51 with pages `1 … 50 51`; chip counts and "All" are not capped at 1000.                                   | spec How it works today (silent cap), Goals 3, Screens Runs flat |
| BR-20 | calculation         | When a member pages through a list while no rows change, they see each row exactly once, in a fixed order → Runs newest queued first; Ignored newest received first; Projects and Desk Rules oldest created first; Desk Skills by name A to Z; setup versions highest first. | spec Lists and routes table, API rule Ordering |
| BR-21 | conditional-display | When grouped by ticket is on, the member sees the page's runs grouped under ticket headers, and a ticket whose runs cross a page break shows its header again at the top of the next page.                                                          | spec Decided by the human, Screens Runs grouped |
| BR-22 | calculation         | When a ticket group header is shown on any page, the member sees "N of max runs" counting all of that ticket's runs in the project, not only those on the page → the same N on both pages of a split ticket.                                          | spec Runs per ticket, Screens Runs grouped; board RunsPaged ("4 of 10 runs") |
| BR-23 | calculation         | When a member views any page of the Runs screen, the chip counts (Needs you, Active, Queued, Ended, All, Ignored) are totals for the project, not for the page → e.g. Needs you 1, Active 2, Queued 1, Ended 59, All 63, Ignored 3 on page 4 of 4.   | spec Run list numbers from the server, Screens Runs grouped; board RunsPaged |
| BR-24 | calculation         | When a member views any page of the Runs screen, the "Today: N runs, F failed" line counts runs queued since the member's local midnight and how many of those failed, whatever page is shown.                                                         | spec `runs.stats` (`today`, `since`); board RunsPaged |
| BR-25 | conditional-display | When the project has an idle run or queued runs, the member sees the needs-you banner on any page of the Runs screen, naming the newest idle run and the number of the oldest queued run ("Run 63 is waiting").                                       | spec `runs.stats` (`idleRun`, `nextQueuedNumber`); board RunsPaged |
| BR-26 | conditional-display | When a member picks the Ignored chip with more than 20 ignored commands, they see the ignored rows paged with the control under them (e.g. "Showing 21–27 of 27" on page 2), no 100-row cap, and the chip count equals the total.                    | spec Screens Ignored; board RunsProblemsPaged |
| BR-27 | conditional-display | When a member opens Needs you with more than 20 runs needing attention, they see the run cards paged ("Showing 21–21 of 21" on page 2), while the tab badge and title count still show the project's needs-you count.                                  | spec Screens Needs you; board NeedsYouPaged |
| BR-28 | conditional-display | When an org has more than 20 projects, the member sees the Projects table paged ("Showing 21–26 of 26" on page 2) with the control under the table.                                                                                                  | spec Screens Projects; board ProjectsPaged |
| BR-29 | conditional-display | When a project has more than 20 routing rules, the member sees the Desk Rules list paged with the control between the list and "Guards on every rule".                                                                                              | spec Screens Desk Rules; board DeskRulesPaged |
| BR-30 | conditional-display | When a project has more than 20 skills, the member sees the Desk Skills list in the left column paged with the control under that list, and the editor pane unchanged.                                                                               | spec Screens Desk Skills; board DeskSkillsPaged |
| BR-31 | calculation         | When the setup version history has more than 20 versions, the member sees the history paged with the control under it, and the header reads the real count ("23 versions"), not the number of rows on the page; loading, error and empty states show no control. | spec Screens Desk setup; boards DeskSetupPaged, DeskSetupVersionsLoading/Error/Empty |
| BR-32 | limit               | When an org has more than 20 projects, the member sees up to 100 projects in the project switcher menu and in the Needs you page's project list, not only the first 20.                                                                              | spec Readers that need the whole set     |
| BR-33 | limit               | When a project has more than 20 skills or rules, the member sees up to 100 of them in the Rules page's skill picker and in the Skills page's rule references, not only the first 20.                                                                  | spec Readers that need the whole set     |
| BR-34 | validation          | When a member creates a skill or rule in the setup flow whose name matches an existing one beyond the first 20, the "already exists" check still finds it.                                                                                            | spec Readers that need the whole set     |
| BR-35 | limit               | When a ticket has more than 20 runs (up to the per-ticket maximum of 50), the member sees all of the ticket's runs in run detail's runs-of-the-same-ticket section, not 20.                                                                           | spec Readers that need the whole set     |
| BR-36 | side-effect         | When a new run is queued while a member is on page 1 and the runs refetch, the member sees the new run at the top of page 1 and the range total grows by one; when a run on the current page changes status, its row shows the new status without a reload. | spec Web app State Live updates          |
| BR-37 | permission          | When another org has rows in the same kind of list, a member sees totals, ranges, chip counts and pages that count and show only their own org's rows.                                                                                              | spec API rule Scope, Testing (API integration) |
| BR-38 | navigation          | When the Runs screen has more than 20 runs created through the fake provider, a member sees page 2 showing the next runs and the chip counts matching the number of runs created.                                                                    | spec Testing E2E (local spec)            |
| BR-39 | conditional-display | When the pagination control's own container is under 1070px wide, the member sees the "Go to page" and "Rows per page" labels and the "Previous"/"Next" words hidden visually (still announced to screen readers) and square icon arrow buttons, all still on one row. | spec `Pagination` One row at every width |
| BR-40 | conditional-display | When the control's container is under 790px wide, the member sees "Showing" dropped from the range ("481–500 of 1,000") and a narrow page set of first, current and last with "…" between (`1 … 25 … 50`), with a narrower Go box and size select.     | spec `Pagination` One row at every width |
| BR-41 | conditional-display | When the control's container is under 590px wide, the member no longer sees the range, and buttons, Go box and size select use a smaller height and text size with tighter gaps.                                                                      | spec `Pagination` One row at every width |
| BR-42 | conditional-display | When the control's container is under 360px wide, the member sees only the current page number between the arrows.                                                                                                                                   | spec `Pagination` One row at every width |
| BR-43 | conditional-display | When the control's container is wider than 240px, the member sees it on one row at every width; at 240px or below it wraps to a second row.                                                                                                          | spec `Pagination` One row at every width |

### Test cases

Conventions: "member" is a signed-in org member. "Runs screen" is a project's Runs page. Control labels are the spec's: "Previous", "Next", "Go to page", "Go", "Rows per page", page buttons named "Page N". No source states the label of the ticket filter text box; it is named by purpose. Every case sets up its own state and can run alone. "mock" cases use a mocked list of the stated size with default page size 20 and empty browser storage unless the case says otherwise.

#### BR-1: First 20 rows by default

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-1.1 | positive | mock | Runs screen with 63 runs; no page size saved in the browser | 1. Open the Runs screen | The list holds exactly 20 runs; the 21st run is not shown |
| TC-1.2 | boundary | mock | Runs screen with 21 runs; no page size saved | 1. Open the Runs screen | The list holds 20 runs and a pagination control is shown (page 2 exists) |
| TC-1.3 | boundary | mock | Runs screen with 20 runs; no page size saved | 1. Open the Runs screen | The list holds all 20 runs and no pagination control is shown |
| TC-1.4 | positive | mock | 26 projects, 22 skills, 24 routing rules, 23 setup versions, 27 ignored commands, 21 needs-you runs (one screen each); no page size saved | 1. Open Projects 2. Open Desk Rules 3. Open Desk Skills 4. Open Desk setup version history 5. Open the Runs screen and pick the Ignored chip 6. Open Needs you | Each screen's list holds 20 rows on its first page |

#### BR-2: Range text

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-2.1 | positive | mock | Runs screen with 1,000 runs, page size 20 | 1. Open `?page=25` of the Runs screen | Under the list: "Showing 481–500 of 1,000" |
| TC-2.2 | boundary | mock | Runs screen with 12,480 runs, page size 20 | 1. Open `?page=312` | "Showing 6,221–6,240 of 12,480" (thousands grouped) |
| TC-2.3 | boundary | mock | Runs screen with 63 runs, page size 20 | 1. Open `?page=4` | "Showing 61–63 of 63" (short last page) |
| TC-2.4 | boundary | mock | Runs screen with 21 runs, page size 20 | 1. Open the Runs screen 2. Click "Page 2" | First page reads "Showing 1–20 of 21"; page 2 reads "Showing 21–21 of 21" |
| TC-2.5 | positive | mock | Runs screen with 63 runs, page size 20 | 1. Open the Runs screen | "Showing 1–20 of 63" |

#### BR-3: Control hidden at 20 or fewer rows

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-3.1 | boundary | mock | Projects screen with 20 projects | 1. Open Projects | All 20 rows shown; no page buttons, no Previous/Next, no "Go to page", no "Rows per page" chooser, no range text |
| TC-3.2 | boundary | mock | Projects screen with 21 projects | 1. Open Projects | 20 rows shown; the control is shown under the table with page buttons and "Rows per page" |
| TC-3.3 | positive | mock | Runs screen with 63 runs, "Rows per page" saved as 100 | 1. Open the Runs screen | All 63 runs shown on one page and the control is still shown including "Rows per page" |
| TC-3.4 | state | mock | Runs screen with 63 runs, saved size 100 | 1. In "Rows per page" pick 20 | The list shows 20 runs and page buttons for 4 pages appear (the chooser let the member switch back) |
| TC-3.5 | boundary | mock | Runs screen with 15 runs, saved size 20 | 1. Open the Runs screen | All 15 runs shown, no control |

#### BR-4: Page buttons and gaps

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-4.1 | positive | mock | 3 pages (e.g. 41–60 runs, size 20), on page 1 | 1. Open the Runs screen | Buttons "Page 1", "Page 2", "Page 3" and no "…" |
| TC-4.2 | positive | mock | 50 pages (1,000 runs, size 20), page 1 | 1. Open the Runs screen | Buttons read `1 2 … 50`; "Page 1" is marked as the current page |
| TC-4.3 | positive | mock | 50 pages, last page | 1. Open `?page=50` | Buttons read `1 … 49 50`; "Page 50" marked current |
| TC-4.4 | positive | mock | 50 pages, middle page | 1. Open `?page=25` | Buttons read `1 … 24 25 26 … 50`; "Page 25" marked current and the other buttons are not |
| TC-4.5 | boundary | mock | 5 pages (81–100 runs), page 3 | 1. Open `?page=3` | Buttons read `1 2 3 4 5` with no "…" (every page fits the first, last and current-with-neighbours set) |
| TC-4.6 | positive | mock | 50 pages, assistive-technology view | 1. Inspect the page buttons and the gaps | Each page button is named "Page N"; the "…" is hidden from assistive technology |

#### BR-5: Click a page button

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-5.1 | positive | mock | Runs screen with 63 runs, on page 1 | 1. Click "Page 3" | Runs 41–60 shown; range reads "Showing 41–60 of 63"; "Page 3" is the current page; address holds `?page=3` |
| TC-5.2 | positive | mock | Runs screen on `?page=3` | 1. Click "Page 1" | Runs 1–20 shown; the address has no `page` parameter |
| TC-5.3 | positive | mock | Projects screen with 26 projects | 1. Click "Page 2" | Rows 21–26 shown; "Showing 21–26 of 26"; address `?page=2` |

#### BR-6: Previous and Next

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-6.1 | positive | mock | 63 runs, on page 2 | 1. Click "Next" | Page 3 shown ("Showing 41–60 of 63") |
| TC-6.2 | positive | mock | 63 runs, on page 3 | 1. Click "Previous" | Page 2 shown ("Showing 21–40 of 63") |
| TC-6.3 | boundary | mock | 63 runs, on page 1 | 1. Look at "Previous" 2. Try to click it | "Previous" is disabled; the page stays 1 |
| TC-6.4 | boundary | mock | 63 runs, on page 4 (last) | 1. Look at "Next" 2. Try to click it | "Next" is disabled; the page stays 4; "Previous" is enabled |
| TC-6.5 | boundary | mock | 63 runs, on page 2 | 1. Look at both | Both "Previous" and "Next" are enabled |

#### BR-7: Go to page

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-7.1 | positive | mock | 1,000 runs, page 1 | 1. Type `25` in "Go to page" 2. Click "Go" | Page 25 shown ("Showing 481–500 of 1,000"); address `?page=25` |
| TC-7.2 | positive | mock | 1,000 runs, page 1 | 1. Type `10` in "Go to page" 2. Press Enter | Page 10 shown, as with "Go" |
| TC-7.3 | boundary | mock | 1,000 runs, page 1, "Go to page" empty | 1. Look at "Go" 2. Try to click it | "Go" is disabled; the page stays 1 |
| TC-7.4 | state | mock | 1,000 runs | 1. Type `5` in "Go to page" 2. Delete the digit | "Go" is enabled with a number and disabled again when the box is empty again |

#### BR-8: Go to page outside the range

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-8.1 | boundary | mock | 1,000 runs (50 pages), page 1 | 1. Type `80` in "Go to page" 2. Click "Go" | Page 50 shown ("Showing 981–1,000 of 1,000") |
| TC-8.2 | boundary | mock | 50 pages, page 1 | 1. Type `51` 2. Click "Go" | Page 50 shown |
| TC-8.3 | boundary | mock | 50 pages, page 1 | 1. Type `50` 2. Click "Go" | Page 50 shown (the last valid page, not clamped further) |
| TC-8.4 | boundary | mock | 50 pages, on page 25 | 1. Type `0` 2. Click "Go" | Page 1 shown; address has no `page` parameter |
| TC-8.5 | boundary | mock | 50 pages, on page 25 | 1. Type `-3` 2. Click "Go" | Page 1 shown |
| TC-8.6 | boundary | mock | 50 pages, on page 25 | 1. Type `1` 2. Click "Go" | Page 1 shown |
| TC-8.7 | negative | mock | 50 pages, on page 25 | 1. Type `abc` into "Go to page" | The box does not hold the letters (numeric input) and "Go" stays disabled; page stays 25 |

#### BR-9: Page in the address survives reload, Back and shared link

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-9.1 | positive | mock | 63 runs, on page 1 | 1. Click "Page 3" 2. Reload the browser | Page 3 is still shown, same rows and range |
| TC-9.2 | positive | mock | 63 runs, on page 1 | 1. Click "Page 2" 2. Click "Page 3" 3. Press the browser Back button | Page 2 shown; address `?page=2` |
| TC-9.3 | positive | mock | 63 runs | 1. Open the Runs screen address with `?page=2` in a fresh browser tab | Page 2 shown |
| TC-9.4 | negative | mock | 63 runs | 1. Open the Runs screen with `?page=abc` | Page 1 shown |
| TC-9.5 | negative | mock | 63 runs | 1. Open `?page=0` 2. Open `?page=-2` 3. Open `?page=1.5` | Each shows page 1 |
| TC-9.6 | positive | mock | Projects screen with 26 projects | 1. Click "Page 2" 2. Reload | Page 2 of Projects still shown (the rule holds on another list) |

#### BR-10: Page beyond the last page

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-10.1 | negative | mock | 63 runs (4 pages) | 1. Open the Runs screen with `?page=99` | The last page shows ("Showing 61–63 of 63") and the address changes to `?page=4` |
| TC-10.2 | boundary | mock | 63 runs | 1. Open `?page=5` | Page 4 shown, address `?page=4` |
| TC-10.3 | boundary | mock | 63 runs | 1. Open `?page=4` | Page 4 shown with no redirect needed; address `?page=4` |

#### BR-11: Empty states without control

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-11.1 | positive | mock | Runs screen with no runs matching the filter | 1. Open the Runs screen | "No runs match this filter" with "Show all runs"; no pagination control |
| TC-11.2 | positive | mock | No ignored commands | 1. Open Runs, pick the Ignored chip | "No ignored commands"; no control |
| TC-11.3 | positive | mock | No run needs attention | 1. Open Needs you | "No runs need you right now."; no control |
| TC-11.4 | positive | mock | Project with no routing rules | 1. Open Desk Rules | "No routing rules yet" with "New rule"; no control |
| TC-11.5 | positive | mock | Project with no skills | 1. Open Desk Skills | "No skills yet"; no control |
| TC-11.6 | positive | mock | Project with no setup versions | 1. Open Desk setup version history | "0 versions" and "No versions yet. The first save creates version 1."; no control |
| TC-11.7 | positive | mock | Runs screen with no runs matching the filter | 1. Click "Show all runs" | The unfiltered runs list shows (with its own control if above 20) |

#### BR-12: Rows per page choices

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-12.1 | positive | mock | 1,000 runs, page size 20, on page 3 | 1. In "Rows per page" pick 50 | List holds 50 rows; "Showing 1–50 of 1,000"; page 1 shown, address has no `page` parameter |
| TC-12.2 | positive | mock | 1,000 runs, on page 3 | 1. Pick 100 | List holds 100 rows; "Showing 1–100 of 1,000"; page 1 |
| TC-12.3 | positive | mock | 1,000 runs, size 50, on page 3 | 1. Pick 20 | 20 rows; page 1 |
| TC-12.4 | negative | mock | Any list above 20 rows | 1. Open the "Rows per page" chooser | Exactly three choices: 20, 50, 100 |

#### BR-13: Page size remembered across reload and lists

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-13.1 | positive | mock | 63 runs | 1. Pick 50 in "Rows per page" 2. Reload | "Rows per page" shows 50 and the list holds 50 rows |
| TC-13.2 | positive | mock | 63 runs and 26 projects | 1. On the Runs screen pick 50 2. Open Projects | Projects uses 50 per page (all 26 shown, control still shown with "Rows per page" at 50) |
| TC-13.3 | positive | mock | 26 projects, 63 runs | 1. On Projects pick 100 2. Open the Runs screen | Runs shows all 63 runs on one page, "Rows per page" shows 100 |

#### BR-14: Invalid or blocked stored page size

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-14.1 | negative | mock | 63 runs; the browser holds a saved page size of 33 | 1. Open the Runs screen | 20 rows per page; "Rows per page" shows 20 |
| TC-14.2 | negative | mock | Saved page size is the text `abc` | 1. Open the Runs screen | 20 rows per page |
| TC-14.3 | negative | mock | Saved page size is `0` | 1. Open the Runs screen | 20 rows per page |
| TC-14.4 | positive | mock | Saved page size is `100` (valid) | 1. Open the Runs screen | 63 runs on one page |
| TC-14.5 | state | mock | Browser storage blocked; 63 runs | 1. Open the Runs screen 2. Pick 50 3. Open Projects | The size 50 applies for the visit on both screens |
| TC-14.6 | persistence | mock | Browser storage blocked; 63 runs | 1. Pick 50 2. Close and reopen the app (new visit) | 20 rows per page again |

#### BR-15: Reset to page 1 on filter changes

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-15.1 | state | mock | Runs screen with enough runs for 4 pages, on page 3 | 1. Click a status chip (e.g. "Ended") | Page 1 of the chip's result shown; address has no `page` parameter |
| TC-15.2 | state | mock | Runs screen with 63 runs, on page 3 of "All"; the project has 27 ignored commands | 1. Click the Ignored chip | Page 1 of the ignored list shown ("Showing 1–20 of 27"); address has no `page` parameter |
| TC-15.3 | state | mock | Runs on page 3 | 1. Type text in the ticket filter | Page 1 of the filtered result shown |
| TC-15.4 | state | mock | Runs on page 3 | 1. Toggle "Grouped by ticket" | Page 1 shown |

| TC-15.5 | negative | mock | Runs on page 3 | 1. Click "Page 4" | The page moves to 4 and does not reset to page 1 (only filter, ticket text, toggle and size reset) |

#### BR-16: Busy state while the next page loads

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-16.1 | state | mock | 63 runs on page 1; the response for page 2 is held back | 1. Click "Page 2" 2. Before the response arrives, look at the screen | Page 1's rows are still shown; the list and the control are marked busy |
| TC-16.2 | state | mock | Same as TC-16.1 | 1. Click "Page 2" 2. Look at every control while waiting | Page buttons, "Previous", "Next", the "Go to page" box, "Go" and "Rows per page" are all disabled |
| TC-16.3 | state | mock | Same as TC-16.1, then the response is released | 1. Release the held response | Page 2 rows and range show; controls are enabled again; busy mark gone |
| TC-16.4 | state | mock | 63 runs; page-size response held back | 1. Pick 50 in "Rows per page" | Current rows stay visible and the control is disabled until the 50-row page shows |
| TC-16.5 | negative | mock | 63 runs, no request pending | 1. Look at the list and control | Neither is marked busy and all controls are enabled |

#### BR-17: First load shows the route skeleton

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-17.1 | state | mock | Runs list response held back | 1. Open the Runs screen for the first time | A busy status area (the route loading skeleton) shows; no empty-state text and no pagination control |
| TC-17.2 | state | mock | Projects, Desk Rules, Desk Skills and Needs you responses held back (one at a time) | 1. Open each screen | Each shows the busy status area, not an empty list or the control |
| TC-17.3 | state | mock | Runs response then released | 1. Release the response | The skeleton is replaced by the list and the control |

#### BR-18: Failed load shows route error with Retry

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-18.1 | negative | mock | The Runs list request fails with a server error | 1. Open the Runs screen | "Internal server error", the request ID and a Retry button; no pagination control |
| TC-18.2 | positive | mock | Same failure, then the next request succeeds | 1. Click Retry | The list loads and shows the first page |
| TC-18.3 | negative | mock | Same failure on the Projects list | 1. Open Projects | The same route error with Retry |
| TC-18.4 | negative | mock | Same failure persists | 1. Click Retry | The route error shows again (Retry loads the page again, request repeated) |

#### BR-19: Real total beyond 1000 runs

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-19.1 | boundary | mock | Project with 1,004 runs (flat list) | 1. Open `?page=51` | "Showing 1,001–1,004 of 1,004"; buttons `1 … 50 51` |
| TC-19.2 | boundary | mock | Project with 1,004 runs | 1. Read the chip counts | "All" shows the real total 1,004 (number format as the screen shows it), not 1000 |
| TC-19.3 | boundary | mock | Project with exactly 1,000 runs | 1. Open `?page=50` | "Showing 981–1,000 of 1,000" |
| TC-19.4 | positive | mock | 1,004 runs | 1. Go to page 51 via "Go to page" typing 51 | The last four runs are reachable on page 51 |

#### BR-20: Order and no repeats

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-20.1 | positive | local | 45 runs queued one after another through the fake provider, none changing while paging | 1. Open Runs, read pages 1, 2 and 3 in turn | Newest queued run first on page 1; runs descend in queue order across pages; every run appears exactly once across the three pages (20 + 20 + 5) |
| TC-20.2 | positive | local | 27 ignored commands received in sequence | 1. Open Ignored chip, read pages 1 and 2 | Newest received first; 27 distinct rows across both pages |
| TC-20.3 | positive | local | 26 projects created in sequence | 1. Open Projects, read both pages | Oldest created first; each project once |
| TC-20.4 | positive | local | 24 routing rules created in sequence | 1. Open Desk Rules, read both pages | Oldest created first; each rule once |
| TC-20.5 | positive | local | 22 skills with distinct names in the repo | 1. Open Desk Skills, read both pages | Names A to Z across pages; each skill once |
| TC-20.6 | positive | local | 23 setup script versions saved | 1. Open setup version history, read both pages | Highest version first (23 down to 1); each once |

#### BR-21: Grouped by ticket across a page break

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-21.1 | positive | mock | Runs screen with "Grouped by ticket" on; a ticket whose runs sit at positions 18 to 22 | 1. Open page 1 2. Click "Page 2" | Page 1 shows that ticket's header over its runs on that page; page 2 shows the same ticket header again at the top over the remaining runs |
| TC-21.2 | positive | mock | Grouped on | 1. Read page 1 | Runs are under ticket headers; the page still holds 20 runs (paging counts runs) |
| TC-21.3 | negative | mock | Grouped on; a ticket entirely inside page 1 | 1. Click "Page 2" | That ticket's header does not appear on page 2 |
| TC-21.4 | negative | mock | Grouped off | 1. Read page 2 | A flat list with no ticket headers |

#### BR-22: N of max runs on ticket headers

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-22.1 | positive | mock | Grouped on; a ticket with 10 runs, 4 on page 4 and 6 on page 3 | 1. Open page 3 2. Click "Page 4" | The ticket's header shows "N of max runs" with N = 10 (all the ticket's runs in the project) on both pages, not the number of runs on each page (board example: "4 of 10 runs") |
| TC-22.2 | positive | mock | Ticket with a single run | 1. Open the page holding it, grouped | Header shows N = 1 of max runs |
| TC-22.3 | boundary | mock | A ticket at the per-ticket maximum (50 runs) | 1. Open grouped page with it | Header shows N = 50 of max runs |

#### BR-23: Chip counts are project totals

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-23.1 | positive | mock | 63 runs: Needs you 1, Active 2, Queued 1, Ended 59, Ignored 3 | 1. Open `?page=4` | Chips read Needs you 1, Active 2, Queued 1, Ended 59, All 63, Ignored 3 |
| TC-23.2 | positive | mock | Same | 1. Open page 1, then page 4 | Chip counts are identical on both pages |
| TC-23.3 | positive | mock | Same | 1. Click the "Ended" chip | The range total reads 59 and the chip still reads 59 |
| TC-23.4 | boundary | mock | No ignored commands, 0 needs-you runs | 1. Read chips | Zero shows for those chips |

#### BR-24: Today line

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-24.1 | positive | mock | Stats with 9 runs today, 1 failed | 1. Open page 4 | "Today: 9 runs, 1 failed" |
| TC-24.2 | positive | mock | Same | 1. Open page 1 | The same Today line |
| TC-24.3 | boundary | mock | No runs queued today | 1. Open the Runs screen | The Today line shows 0 runs and 0 failed |
| TC-24.4 | positive | local | One run queued through the fake provider just now, none earlier today, and it has not failed | 1. Open the Runs screen | The Today line counts 1 run and 0 failed; runs queued before the member's local midnight are not counted (test environment: no way stated to back-date runs, so the before-midnight side is proven at the mock layer by TC-24.1 fixtures) |

#### BR-25: Needs-you banner on any page

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-25.1 | positive | mock | Project with an idle run and queued runs, oldest queued run number 63 | 1. Open page 4 | The banner names the newest idle run and reads "Run 63 is waiting" |
| TC-25.2 | positive | mock | Same | 1. Open page 1 | The same banner |
| TC-25.3 | negative | mock | No idle run and no queued run | 1. Open the Runs screen | No banner |
| TC-25.4 | positive | mock | Only queued runs, no idle run | 1. Open the Runs screen | The banner shows the waiting run number; no idle run is named (exact copy for this mix is unstated) |
| TC-25.5 | positive | mock | Only an idle run, no queued run | 1. Open the Runs screen | The banner names the idle run and no "is waiting" line |

#### BR-26: Ignored chip paged

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-26.1 | positive | mock | 27 ignored commands | 1. Open Runs, click the Ignored chip 2. Click "Page 2" | 20 rows on page 1; page 2 shows 7 rows and "Showing 21–27 of 27"; control under the rows |
| TC-26.2 | positive | mock | 27 ignored commands | 1. Read the Ignored chip count | It reads 27, equal to the total |
| TC-26.3 | boundary | mock | 130 ignored commands | 1. Click the Ignored chip 2. Open `?page=7` | "Showing 121–130 of 130" (no 100-row cap) |
| TC-26.4 | negative | mock | 20 ignored commands | 1. Click the Ignored chip | 20 rows and no control |

#### BR-27: Needs you paged

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-27.1 | positive | mock | 21 runs need attention | 1. Open Needs you 2. Click "Page 2" | Page 1 holds 20 cards; page 2 holds one card with "Showing 21–21 of 21" |
| TC-27.2 | positive | mock | Same | 1. Read the tab badge and the title count | Both show 21 on every page |
| TC-27.3 | boundary | mock | 20 runs need attention | 1. Open Needs you | 20 cards, no control |

#### BR-28: Projects paged

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-28.1 | positive | mock | 26 projects | 1. Open Projects 2. Click "Page 2" | 20 rows then 6 rows; "Showing 21–26 of 26"; control under the table |
| TC-28.2 | boundary | mock | 20 projects | 1. Open Projects | 20 rows, no control |

#### BR-29: Desk Rules paged

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-29.1 | positive | mock | 24 routing rules | 1. Open Desk Rules 2. Click "Page 2" | 20 rules then 4 rules; "Showing 21–24 of 24" |
| TC-29.2 | positive | mock | 24 routing rules | 1. Look at the layout | The control sits between the list and "Guards on every rule" |
| TC-29.3 | boundary | mock | 20 rules | 1. Open Desk Rules | 20 rules, no control, "Guards on every rule" below the list |
| TC-29.4 | navigation | mock | 24 rules; rule 22 is on page 2 | 1. Open Desk Rules with the address's `rule` parameter naming rule 22 and no `page` | The sources do not say whether the list jumps to page 2; assert the editor shows rule 22 and the list shows a page of rules with a working control. Depends on Q1 |

#### BR-30: Desk Skills paged

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-30.1 | positive | mock | 22 skills | 1. Open Desk Skills 2. Click "Page 2" | 20 skills then 2; "Showing 21–22 of 22" in the left column under the list |
| TC-30.2 | positive | mock | 22 skills; a skill selected in the editor | 1. Click "Page 2" | The editor pane still shows the selected skill, unchanged |
| TC-30.3 | boundary | mock | 20 skills | 1. Open Desk Skills | 20 skills, no control |
| TC-30.4 | navigation | mock | 22 skills; skill 22 on page 2 | 1. Open Desk Skills with the `skill` parameter naming skill 22 and no `page` | Editor shows skill 22; the list shows a page with a working control. Depends on Q1 |

#### BR-31: Setup version history

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-31.1 | positive | mock | 23 versions | 1. Open Desk Workspace setup version history 2. Click "Page 2" | Header reads "23 versions" on both pages; page 2 holds 3 rows; control under the history |
| TC-31.2 | positive | mock | 23 versions | 1. Read page 1 | Header reads "23 versions", not 20 |
| TC-31.3 | state | mock | History response held back | 1. Open the history | "Loading versions" with a busy mark; no control |
| TC-31.4 | negative | mock | History request fails | 1. Open the history | "Could not load the version history. Reload to try again."; no control |
| TC-31.5 | state | mock | 0 versions | 1. Open the history | "0 versions", "No versions yet. The first save creates version 1."; no control |

#### BR-32: Switcher and Needs-you project list up to 100

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-32.1 | boundary | mock | 26 projects | 1. Open the project switcher menu | All 26 projects are listed |
| TC-32.2 | boundary | mock | 100 projects | 1. Open the project switcher menu | 100 projects listed |
| TC-32.3 | boundary | mock | 101 projects | 1. Open the project switcher menu | 100 projects listed (the 101st is not) |
| TC-32.4 | boundary | mock | 26 projects | 1. Open Needs you and read its project list | All 26 listed |

#### BR-33: Skill picker and rule references up to 100

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-33.1 | boundary | mock | 25 skills | 1. On Desk Rules open the skill picker | All 25 skills offered |
| TC-33.2 | boundary | mock | 25 rules | 1. On Desk Skills read the rule references | All 25 rules referenced |
| TC-33.3 | boundary | mock | 100 skills | 1. Open the skill picker | 100 offered |
| TC-33.4 | boundary | mock | 101 skills | 1. Open the skill picker | 100 offered |

#### BR-34: Duplicate name check beyond the first 20

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-34.1 | negative | local | 25 skills in the repo; the 25th by name is "zeta-skill" | 1. In the setup flow create a skill named zeta-skill | The flow reports that the name already exists; no skill is created |
| TC-34.2 | negative | local | 25 routing rules; the 24th created is "late-rule" | 1. In the setup flow create a rule named late-rule | "already exists" is reported |
| TC-34.3 | positive | local | Same skills | 1. Create a skill with a name not in the list | It is accepted (the check is not always on) |
| TC-34.4 | negative | mock | 25 skills, name beyond the first 20 | 1. Create a skill with that name | "already exists" error, as TC-34.1, using mocked responses |

#### BR-35: Same-ticket runs section

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-35.1 | boundary | mock | Ticket with 21 runs | 1. Open run detail of one of them | The runs-of-the-same-ticket section lists all 21 |
| TC-35.2 | boundary | mock | Ticket with 50 runs | 1. Open run detail | Section lists all 50 |
| TC-35.3 | boundary | mock | Ticket with 20 runs | 1. Open run detail | Section lists all 20 |

#### BR-36: Live updates

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-36.1 | side-effect | local | 25 runs, member on page 1 | 1. Queue a new run through the fake provider 2. Wait for the list to refresh | The new run is the first row on page 1; the range total grows by one ("of 26") |
| TC-36.2 | side-effect | local | A queued run visible on page 1 | 1. Let the run move to a new status (fake pod starts it) | The row shows the new status without a reload |
| TC-36.3 | side-effect | mock | 63 runs, member on page 2 | 1. Deliver a status change for a run on page 2 | Its row shows the new status without a reload |

#### BR-37: Tenant isolation

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-37.1 | permission | local | Org A has 25 projects; org B has 30 projects | 1. Sign in as a member of org A 2. Open Projects | "Showing 1–20 of 25"; page 2 shows 5 rows; no org B project |
| TC-37.2 | permission | local | Org A has 25 runs, org B 40 runs in a project | 1. Sign in as org A 2. Open the Runs screen | Total and chip counts count only org A's runs |
| TC-37.3 | permission | local | Org A has 0 projects, org B has 30 | 1. Sign in as org A 2. Open Projects | Empty state and no control |

#### BR-38: Local Runs paging via the fake provider

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-38.1 | positive | local | 25 runs created through the fake provider | 1. Open the Runs screen 2. Click "Page 2" | Page 2 shows the next 5 runs; "Showing 21–25 of 25" |
| TC-38.2 | positive | local | Same | 1. Read the chip counts | "All" reads 25 and the counts add up to the runs created |
| TC-38.3 | boundary | local | 20 runs created | 1. Open the Runs screen | One page, no control |

#### BR-39: Container under 1070px

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-39.1 | boundary | mock | 1,000 runs; control container 1070px wide | 1. Open Runs | Labels "Go to page", "Rows per page" and the words "Previous"/"Next" are visible; one row |
| TC-39.2 | boundary | mock | Container 1069px wide | 1. Open Runs | The two labels and the words are hidden visually (still available to screen readers); Previous/Next are square icon buttons; one row |
| TC-39.3 | positive | mock | Container 900px wide | 1. Open Runs 2. Inspect accessible names | "Previous" and "Next" are still announced |

#### BR-40: Container under 790px

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-40.1 | boundary | mock | 1,000 runs on page 25; container 790px | 1. Open `?page=25` | "Showing 481–500 of 1,000" and the full page set `1 … 24 25 26 … 50` |
| TC-40.2 | boundary | mock | Container 789px, page 25 | 1. Open `?page=25` | "481–500 of 1,000" without "Showing"; buttons `1 … 25 … 50`; narrower Go box and size select; one row |

#### BR-41: Container under 590px

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-41.1 | boundary | mock | 1,000 runs; container 590px | 1. Open Runs | The range text is shown |
| TC-41.2 | boundary | mock | Container 589px | 1. Open Runs | The range is no longer shown; buttons, Go box and size select are smaller in height and text with tighter gaps; one row |

#### BR-42: Container under 360px

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-42.1 | boundary | mock | 1,000 runs, page 25; container 360px | 1. Open `?page=25` | Page buttons are still shown |
| TC-42.2 | boundary | mock | Container 359px, page 25 | 1. Open `?page=25` | Only the current page number "25" is shown between the arrows; "Previous" and "Next" arrows still work |

#### BR-43: One row down to 240px

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-43.1 | boundary | mock | 1,000 runs; container 1400px | 1. Open Runs | The control is on one row |
| TC-43.2 | boundary | mock | Container 241px | 1. Open Runs | One row |
| TC-43.3 | boundary | mock | Container 240px | 1. Open Runs | The control wraps to a second row |
| TC-43.4 | boundary | mock | A phone-width viewport (e.g. 375px) | 1. Open Runs | The control is on one row |

### Open questions

- Q1 (BR-29, BR-30, BR-9; TC-29.4, TC-30.4): What does Desk Rules or Desk Skills show when its `rule` or `skill` address parameter selects an item that is not on the current page? The route table gives these parameters, and the spec says the editor pane is unchanged, not whether the list jumps to the page holding the selected item. Until answered, the cases assert only that the editor shows the selected item and the list stays a working page with its control.
