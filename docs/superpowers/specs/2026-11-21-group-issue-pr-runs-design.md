<!-- dev-plan: kind=spec id=group-issue-pr-runs rev=2 hash=9759ce583d9d source=issue#198 -->
# Group issue and related PR runs design

Status: draft. Sensitive paths: migrations (new column `runs.linked_issue_refs`); webhooks (the intake pipeline writes
the new column on PR runs; security.md §8); plus a new GitHub API call in the board adapter.
Source: issue #198

## Summary

With "Grouped by ticket" on, the Runs page shows an issue's runs and its pull request's runs in separate groups.
After this change, a PR run that carries a link to an issue with runs shows in that issue's group (only PR runs
created after the change carry a link), and the group header shows each ticket's own count in the chain note, "Issue #142 (1 of 10 runs) → PR #148
(1 of 10 runs)". Run counts and the run limit stay per ticket. Everyone who can read the project's runs sees it.

## Business rules

Confirmed by the human at planning time.

### Goal

With "Grouped by ticket" on, a person sees an issue's runs and its PR's runs in one group, with each ticket's own
"N of max runs" in the chain note.

### Actors

| Actor | May do |
| ----- | ------ |
| Everyone with `run:read` on the project (owner, admin, project admin, member, viewer) | Sees the grouping. No new action or permission (rbac-foundation spec route map). |
| Ticket source (outside party) | Supplies the link: the PR description and the issue's linked-PR fields (T1). |

### Rules

Surface: UI (the Runs page's grouped list is the only place the grouping is seen; no new endpoint, and the API change
only feeds that list).

| Id    | Category            | Rule |
| ----- | ------------------- | ---- |
| BR-1  | conditional-display | When "Grouped by ticket" is on and a PR run linked to an issue that has runs is listed, a member sees one group holding the issue's runs and the PR's linked runs, each row still showing its own ticket (#142 / PR #148). |
| BR-2  | calculation         | When a merged group shows, the member sees each ticket's own count in the chain note, "Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs)", and no count on the right; never a sum. |
| BR-3  | calculation         | When a merged group's runs cross a page break, the member sees on every page holding any of its runs the same header led by the issue (number, title, labels) with the same counts, even on a page with only the PR's runs or only the issue's runs. |
| BR-4  | conditional-display | When an issue has several related PRs with linked runs, the member sees one group whose chain note lists each PR in number order with its own count, "Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs), PR #150 (2 of 10 runs)", on every page of that group. |
| BR-5  | ordering            | When a merged group shows, its runs are listed oldest first across the tickets, and the group sits in the list by its newest run. |
| BR-6  | negative            | When a PR has no related issue, the member sees its runs in their own group headed by the PR with "N of max runs" on the right, as today. |
| BR-7  | negative            | When an issue and a PR are not related (including the same number on a host with separate numbering), the member sees separate groups. |
| BR-8  | negative            | When "Grouped by ticket" is off, the member sees the flat list unchanged. |
| BR-9  | business-rule       | When a PR has used its run limit and someone comments a command on it, no run starts and the Ignored list shows "Ticket reached its run limit", even if the related issue has runs left; and the reverse. |
| BR-10 | tenancy             | When a PR names an issue in another repository, the member sees the PR's runs in their own group. |
| BR-11 | edge                | When a PR is related to several issues, its linked runs appear once, under the lowest-numbered related issue that has runs. |
| BR-12 | edge                | When a PR's related issue has no runs in the project, the member sees the PR's runs in their own group as today, with no chain note. |
| BR-13 | business-rule       | When a PR's description names the issue it closes (e.g. "Closes #142") and a run starts on the PR, the member then sees that run under issue #142's group. |
| BR-14 | business-rule       | When the issue's linked-PR fields list the PR (its description does not name the issue) and a run starts on the PR, the member then sees that run under the issue's group. |
| BR-15 | edge                | When the link cannot be read (ticket source down or slow) as a PR run starts, the run still starts and the member sees it in the PR's own group. |
| BR-16 | compatibility       | When PR runs were created before this change, the member sees them in the PR's own group, even after a newer run of that PR has merged into the issue's group (T6). |
| BR-17 | edge                | When a PR's linked runs name different issues (its description changed between runs), the member sees all of that PR's linked runs in one group, the lowest-numbered related issue that has runs; its runs without a link stay in the PR's own group. |
| BR-18 | negative            | When a group holds a single ticket, the member sees "N of max runs" on the right as today. |
| BR-20 | edge                | When a link is added at the ticket source after the PR's runs started, the member sees them merged only from the PR's next run (earlier runs stay in the PR's own group). |
| BR-21 | conditional-display | When a page holds only the issue's runs of a merged group, the member sees the same merged header with each PR's count in the chain note. |

BR-19 and BR-22 are not used: BR-19 (link kept after the source drops it) was replaced by per-run snapshots (T6), and
BR-22 (old runs of an already linked pair) is covered by BR-16 (T6).

### Not observable

- The run-count identity stays the ticket ref per project (effect: BR-2, BR-9).
- The link is stored as numbers only, never text (AGENTS.md rule 6; effect: BR-10, BR-13).
- The cap of 10 refs per PR run has no realistic UI case (effect: BR-11).

### States

No state change.

### Limits and validation

No new user input. Link data from the ticket source is untrusted: only same-repo positive ticket numbers are kept, at
most 10 per PR run (AGENTS.md rules 4, 6).

### Edge cases

- The issue has no runs in the project: the PR shows as today, with no chain note and its count on the right (T2, T5).
- A page holds only the PR's linked runs: the header is led by the issue, with all counts (T5).
- A page holds only the issue's runs: the same merged header, with the PR counts (same header on every page, T5).
- An issue with several related PRs: one group, chain note "Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs),
  PR #150 (2 of 10 runs)", PRs in number order.
- A page holds only PR #148's runs and issue #142 also has PR #150: the header lists every PR linked to the issue that
  has linked runs, so it is the same on every page (T5).
- A PR related to several issues: it joins the lowest-numbered related issue that has runs; if none has runs, it shows
  as today.
- A PR without a link, or the link lookup failed or timed out: the run still starts and stays in the PR's own group.
- A link to another repository: ignored.
- PR runs created before the change: the PR's own group (T3, T6), even if later runs of that PR merge.

### Tenancy and permission

Links and linked counts are only within the same project and repo; reads go through `withOrg` (AGENTS.md rule 4,
ADR 0006). There is no new endpoint, so there is no new authz case (rule 7 unchanged). Everyone with `run:read` on the
project sees the same grouping.

### Lifecycle, compatibility and side effects

- The link is saved on each PR run created after the change. Existing runs get none; there is no back-fill (T3, T6).
- No delete, retention or audit change; the link goes with its run.
- Existing runs keep their groups (T3, T6).
- Merged group header: counts move into the chain note and the right side is empty (T4). Single-ticket groups are
  unchanged.
- The prototype's summed "2 of 10 runs" is superseded (the newer doc wins); boards `Runs.dc.html` and
  `RunsPaged.dc.html` are superseded by the approved boards in `## UI and Storybook` and stay untouched.
- Side effects a user sees: none. No comments, status changes, notifications or events change.
- Existing decisions kept: shared-pagination spec BR-21 and BR-22 (paging counts runs, a run appears in exactly one
  group, the header repeats per ticket); prototype `Runs.dc.html` chain note kept, its count replaced by T4; ADR 0005,
  0006, 0028. There is no ADR on ticket linking.

### Out of scope

Grouping runs created before this change (human answers T3, T6).

## Architecture

Confirmed by the human at planning time.

### Overview

An issue and its PR never share a number on GitHub (one number space, `ticketRef = String(issue.number)` for both),
and the fake store keeps one ticket per number, so dropping `kind` from the web's `ticketKey` would group nothing.
Nothing stored links a PR to an issue today, so the link is read from the ticket source and stored on each new PR run
as a snapshot. Layering stays `apps → core → db → contracts`, web → contracts only.

- `packages/contracts`: new `LinkedTicketDto`; `RunListItem.linkedTickets`.
- `packages/db`: column `runs.linked_issue_refs` and its migration.
- `packages/core`: `Ticket.linkedRefs` on the adapter type. The GitHub and fake adapters fill it for PRs. Intake
  (`intake/process-ticket-event.ts`) writes it on the PR run row from the ticket it already prefetches.
- `apps/api`: `RunsService.listItems` attaches `linkedTickets` (runs list and `stats.idleRun` both use `listItems`).
  `ticketRunCountsFor` keeps its meaning (count per `ticketRef`). `apps/api/src/dev/fake.controller.ts`
  `DevTicketBody` accepts linked numbers for e2e seeding.
- `apps/web`: `features/runs/map.ts` gets a group identity separate from the count identity (`ticketKey` unchanged).
  The group key is the issue in the run's `linkedTickets` when present, else the run's own ticket. It builds the chain
  note from `linkedTickets`. Rendering is in `## UI and Storybook`.
- `apps/worker`, runner: untouched (polling reaches the same core intake).

Flow: a command on a PR → intake prefetches the ticket (with `linkedRefs`) outside the DB transaction → the PR run row
is written with `linked_issue_refs` → the runs list adds `linkedTickets` per item → the web groups by the lead issue
and builds the chain note.

### Data model

- Migration `0022_runs_add_linked_issue_refs.sql` adds `runs.linked_issue_refs text[] not null default '{}'`
  (precedent: the text-array column at `packages/db/src/schema/app.ts:143`). `NOT NULL DEFAULT <constant>` is the
  safe add-column pattern; the migration is new and forward-only.
- It is set at intake on PR runs only. Refs are positive-integer strings, same repo, at most 10.
- Tenant scope: `runs` already has `orgPolicy()`; reads stay inside the existing `withOrg` in `RunsService`. No new
  table, RLS policy or foreign key.
- No backfill (T3): existing rows keep `'{}'` and group as today.
- Migration `0023_runs_add_linked_issue_refs_idx.sql` adds a partial GIN index `runs_linked_issue_refs_idx` on
  `runs (linked_issue_refs) where ticket_kind = 'pr'`. The reverse lookup (issue → PRs) filters `project_id` +
  `ticket_kind = 'pr'` + `linked_issue_refs && $refs`, so it finds candidate PRs through the index before it picks
  each PR's newest link.

### API

| Method | Path | Who may call it | Request | Response | Contract |
| ------ | ---- | --------------- | ------- | -------- | -------- |
| GET | `/api/projects/:projectId/runs` (`runs.list`) | `run:read` on the project, existing guards (unchanged) | Unchanged (offset pagination, ADR 0028; `?ticket=` filter unchanged) | Each `RunListItem` gains `linkedTickets` | `packages/contracts/src/schemas/runs.ts` |
| GET | `/api/projects/:projectId/runs/stats` (`runs.stats`) | `run:read` on the project, existing guards (unchanged) | Unchanged | `idleRun` (a `RunListItem`) gains `linkedTickets` | `packages/contracts/src/schemas/runs.ts` |

No new endpoint or route. `RunDto` (run detail), `TicketDto`, `ticketRunCount` and the route table are unchanged.
The dev-only fake controller's `POST dev/fake/tickets` body (`DevTicketBody`) accepts `linked` numbers on PRs and
issues. No WebSocket, terminal or webhook change.

Contract (`packages/contracts/src/schemas/runs.ts`):

- `LinkedTicketDto = { ref: string, kind: TicketKind, number: int, title: string, url: string,
  labels: TicketDto['labels'], ticketRunCount: int ≥ 1 }`.
- `labels` is taken from the same newest-run snapshot (`runs.ticket_labels`, already stored).
- Each PR belongs to exactly one issue group, its **lead issue**: the lowest-numbered issue with at least one run in
  the project among the issues its newest linked run lists. The API picks the lead, not the web, so every page agrees.
- `RunListItem.linkedTickets: z.array(LinkedTicketDto)` is required and `[]` when none. The issue comes first, then
  PRs by number:
  - A PR run whose own snapshot has a link and whose PR has a lead issue: `[lead issue, …the lead's other PRs]`, with
    their counts, so a page holding only PR #148's runs shows the same chain note as every other page.
  - A PR run with an empty snapshot (made before the change, or the lookup failed), or with no lead (no linked issue
    has runs): `[]`, so it stays in the PR's own group (T2, T3, T6, BR-15, BR-16).
  - An issue run: the PRs whose lead is this issue, so an issue-only page names its PRs and their counts too (BR-3,
    shared-pagination BR-21/BR-22).
  - Title, url and labels come from that ticket's newest run snapshot. The count is its `ticketRunCount` (per ref).

`RunsService.listItems` adds 3 constant queries inside the existing `withOrg` transaction, bounded by page size:

1. the newest PR run with a link per PR ref (`distinct on (ticket_ref)`), for the page's PR refs and for PRs whose
   newest links overlap the page's issue refs or the issues linked from the page's PRs (sibling PRs);
2. counts per linked ref through the existing `ticketRunCountsFor`, which also decides each PR's lead issue;
3. the newest snapshot (kind, number, title, url, labels) per linked ref (`distinct on (ticket_ref) … order by
   ticket_ref, queued_at desc`).

Refs with count 0 are dropped (T2). Counts and the run limit stay per `ticketRef`.

### Third-party libraries

| Library | New or existing | Used for | Approval |
| ------- | --------------- | -------- | -------- |
| zod | existing | `LinkedTicketDto`, `linkedTickets` | existing |
| drizzle-orm / drizzle-kit | existing | the column, the migration, the three list queries | existing |
| `@octokit/rest` | existing | its built-in `octokit.graphql` for one GraphQL query per PR ticket fetch (first use of `graphql` in the repo) | existing |

### Services and integrations

| Service | New or existing | How it is used |
| ------- | --------------- | -------------- |
| GitHub API | existing | REST `GET issues/{n}` as today, plus one GraphQL query per PR ticket fetch, with the existing client and App permissions (Issues and Pull requests read). |
| Postgres | existing | One new column; three extra reads per runs-list page. |
| Temporal, Kubernetes, SecretStore | existing | Untouched. |

### Other decisions

- Provider adapters: `Ticket` (`packages/core/src/adapters/types.ts`) gains `linkedRefs: string[]`, the issue refs a PR
  is linked to in the same repo (`[]` for issues). `getTicket` fills it, so it rides the existing prefetch outside the
  DB transaction (`process-ticket-event.ts:150-161`) under `TICKET_TIMEOUT_MS`. Provider code stays in
  `adapters/github/`, behind the generic seam; the fake changes with the seam.
- GitHub (`packages/core/src/adapters/github/board.ts`), PR tickets only:
  - the PR description's same-repo closing keywords (`close[sd]?|fix(e[sd])?|resolve[sd]?` + `#<n>`, from the `body`
    the REST call already returns);
  - union with GraphQL `pullRequest.closingIssuesReferences`, which also returns links made from the issue's own
    "Development" field, so it covers T1's issue side;
  - one GraphQL request through the existing `@octokit/rest` client (`octokit.graphql`), with variables only; issue
    tickets make no extra call; cross-repo refs are dropped, refs must be positive integers, capped at 10;
  - if the GraphQL call fails, the adapter keeps the description refs and `getTicket` still succeeds; a warning is
    logged with the error name only.
- Fake: `StoredTicket` gains optional `linked: number[]`, settable on a PR (description side) or on an issue
  (issue-side field). A PR's `linkedRefs` = its own `linked` ∪ issues whose `linked` lists it. `DevTicketBody`
  accepts `linked`.
- Failure: a failed or slow link lookup never blocks a run. The run is stored with `'{}'` and shows in the PR's own
  group (BR-15).
- Snapshot: the link is a snapshot taken when a PR run is created (like title and labels). A later source change shows
  from the PR's next run; the newest run with a link decides for that PR's linked runs (BR-17).
- Worker: no workflow or activity change. Runner and Kubernetes: no change.
- Events and live updates: no change. Project SSE patches status in place; a new run and its link arrive through the
  list refetch; reconnect catch-up invalidates the runs queries as today.
- Config and env: no new env var, setting or flag.
- Secrets: none touched. The token stays inside the adapter client. PR description and link fields are untrusted: only
  parsed integers are stored, never text, and they are never interpolated (Drizzle parameters, GraphQL variables).
- Observability and scale: one warn on a link lookup failure (error name only); three extra queries per list page; the
  reverse lookup uses the partial GIN index `runs_linked_issue_refs_idx`; one extra GitHub request per PR command comment.
- Sensitive paths: a migration on `runs`, the intake pipeline, and a new GitHub API call in the board adapter
  (security.md §8), so the PR gets `review:sensitive` and a security review. No RLS policy, auth, webhook
  verification, terminal or secrets change.
- ADR: none needed.

## UI and Storybook

Screens and components this changes:

- Runs screen (`/o/$org/p/$project/runs`, grouped view), reached as today (project sidebar → Runs, "Grouped by
  ticket" on). No new route or screen. Not touched: run detail (ChainTimeline still lists runs of the same ticket
  only), Needs you, flat view, Ignored list. Runs screen first-load, empty and error states are unchanged and not
  redrawn (route `pendingComponent` + Skeleton, `EmptyState` "No runs match this filter", `Banner` err with Retry;
  existing boards `RouteLoading`, `RunsEmpty`, `RouteError`).
- `TicketGroupRow` (`components/RunRow.tsx`): changed. With linked tickets it shows the chain note with per-ticket
  counts and hides the right-side "N of max runs"; single-ticket groups are unchanged. Its states, each drawn on an
  approved board:
  - merged, one PR: header "Issue #142", title, labels, chain note "Issue #142 (1 of 10 runs) → PR #148 (1 of 10
    runs)", external link, nothing on the right; rows `#142` and `PR #148` (`RunsLinked`);
  - merged, several PRs: chain note lists each PR in number order with its own count (`RunsLinkedSeveralPrs`);
  - merged, chain note cut off: a long title gives way first, then the chain note ends in an ellipsis; both carry
    their full text in a `title` tooltip (`RunsLinkedLongChain`);
  - merged, lead's runs not on this page: header led by the issue over only PR rows (`RunsPagedLinkedPrOnly`);
  - merged, only the lead's runs on this page: the same header over only issue rows (`RunsPagedLinkedIssueOnly`);
  - merged, under a status filter: the "Needs you" chip on, the merged group keeps only its matching PR run and the
    header keeps the full chain note and counts (`RunsLinkedFiltered`);
  - one PR in two groups: the merged group holds the new PR run, and PR #148's own single-ticket group (header
    "PR #148", its title, "2 of 10 runs" on the right) holds its older unlinked run; the merged chain note shows the
    same "PR #148 (2 of 10 runs)" (`RunsLinkedSplitPr`, T6);
  - busy page load over a merged group: the current page stays shown with `aria-busy` while the next page loads
    (`DataTable busy`, unchanged behaviour) (`RunsPageLoadingLinked`).
  The chain note's full text is in a `title` tooltip on every merged header. The single-ticket state is unchanged and
  is also used for a PR's old unlinked runs (T6). Disabled, permission-denied and reconnecting do not apply (no
  control; SSE reconnect keeps cached data).
- `RunRow`: reused unchanged. Its Ticket column shows `#142` for an issue and `PR #148` for a PR, so a merged group's
  rows tell issue runs from PR runs.
- `TicketGroup` view model (`mocks/types.ts`): keeps `ticket` + `runsUsed` for the lead (the issue) and adds
  `linked?: { ticket: { kind; number }; runsUsed: number }[]` for the other tickets in the group. `chainNote` stays a
  display-ready string built in `features/runs/map.ts`. The header hides the right-side count when `linked` is
  non-empty.
- `features/runs/map.ts` `groupByTicket`: group key = the lowest-numbered issue in the PR run's own `linkedTickets`
  (else its own `ticketKey`, so unlinked PR runs keep the PR group, T6); lead ticket data from an issue run on the
  page, else from `linkedTickets` (url through `safeHref`); counts per `ticketKey` from `ticketRunCount` /
  `LinkedTicketDto.ticketRunCount`. Grouping stays a pure mapper with a unit test; no new query or mutation, no
  optimistic update.
- `Runs.tsx`: the header React key is the group identity (lead kind + number), not `g${ticket.number}`, which also
  keeps the merged `issue:142` group and the PR's own `pr:148` group apart when both are on a page (T6).
- No new ds primitive and no new shared component.
- Visual: tokens only; the chain note keeps `.chain` (`--fs-12_5`, `--faint`) in
  `apps/web/src/components/RunList.module.css`, and the counts inside it use the same style.
- Layout: the header stays one line; the title gives way first (existing `.grpTitle` ellipsis), then the chain note
  shrinks with an ellipsis (`RunsLinkedLongChain`). The table scrolls inside its panel as today; nothing new is
  fixed.
- Accessibility: the chain note is plain text in DOM order (TicketRef, title, labels, chain note, external link); no
  colour-only meaning; the icon link keeps its `aria-label`; stories go through the axe smoke test; keyboard path
  unchanged.
- Stories:
  - `components/RunRow.stories.tsx`: update the `group()` helper (linked PR + per-ticket chain note); add
    `GroupHeaderIssueAndPr`, `GroupHeaderSeveralPrs`, `GroupHeaderLongChain` (narrow artboard, ellipsis) and
    `GroupHeaderSplitPr` (merged #142 group with new PR #148 runs, then PR #148's own group with its old runs, T6);
    `Connectors` mixes `#142` and `PR #148` rows; add a header-over-PR-runs-only case (lead issue, only `PR #148`
    rows).
  - `screens/runs.stories.tsx`: `Runs` (via `@/mocks` `ticketGroups`: #142 + PR #148, #131 + PR #133) and
    `RunsPaged` (`lastPageGroups` #139 + PR #140) show the new chain note and nothing on the right.
  - `@/mocks`: `runs.ts` `ticketGroups` gains `linked` and the new `chainNote`; `mocks.test.ts` checks each linked
    `runsUsed <= runsMax`; DTO fixtures and MSW gain `linkedTickets` (see `## Testing`).
- Boards `Runs.dc.html` and `RunsPaged.dc.html` draw the summed count; the approved boards below supersede them, and
  they stay untouched.

User flows:

1. Happy path: open Runs with grouped on → one header led by issue #142 (TicketRef, title, labels), chain note
   "Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs)", nothing on the right → under it the page's runs of both
   tickets, oldest first, each row's Ticket column showing `#142` or `PR #148`.
2. Page holds only PR #148's runs (issue #142's runs on another page) → header led by issue #142, title and url from
   the PR run's `linkedTickets`, same chain note and counts (T5; board `RunsPagedLinkedPrOnly`: page 4 of 4, "Issue
   #12 (1 of 10 runs) → PR #13 (2 of 10 runs)" over only `PR #13` rows).
3. Page holds only issue #142's runs → the same header with the chain note and both counts (the issue run's
   `linkedTickets` lists PR #148) (board `RunsPagedLinkedIssueOnly`: "Issue #12 (2 of 10 runs) → PR #13 (1 of 10
   runs)" over only `#12` rows).
4. Issue has no runs at all → the API leaves it out of `linkedTickets` → the PR heads its own group with "N of 10
   runs" on the right and no chain note (T2, BR-12).
5. PR with no link, link unreadable, or runs from before this change → the PR's own group as today (BR-6, BR-15,
   BR-16).
6. One PR with old unlinked runs and new linked runs on the same page → two groups: the issue-led merged group holds the
   new PR runs; PR #148's own group holds the old ones with "N of 10 runs" on the right. Both show the same PR count
   (the ticket's total per ref). Each group sits by its own newest run (board `RunsLinkedSplitPr`).
7. PR linked to several issues → its runs join the lowest-numbered linked issue that has runs (BR-11).
8. Issue with several PRs → one group; the chain note lists each PR with its own count (BR-4; board
   `RunsLinkedSeveralPrs`).
9. Status chip filter → a merged group keeps only matching runs and disappears when none match (`Runs.tsx`
   `filterGroups`); counts stay all-status (shared-pagination BR-22); the header is unchanged by the filter (counts
   and chain note come from the API) (board `RunsLinkedFiltered`: "Needs you" on, only run 62 `PR #148` under the
   full "Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs)" header).
10. Page break → the header repeats on every page holding the group's runs, identical on each (T5, shared-pagination
    BR-21/BR-22).
11. Grouped off → the flat list is unchanged (BR-8). The `?ticket=` filter is not changed.
12. Moving to another page while a merged group is shown → the current page stays shown, busy, until the next page
    arrives (board `RunsPageLoadingLinked`).
13. List load error or empty list → the screen's existing error and empty states.

Copy:

- Merged chain note: "Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs)"; nothing on the right.
- Several PRs: "Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs), PR #150 (2 of 10 runs)", PRs in number order.
- Always "runs", also for one ("1 of 10 runs").
- Single-ticket header: unchanged "N of 10 runs" on the right (BR-18).
- External link label: "Open #142 in GitHub" for the lead ticket (existing `TicketGroupRow`).
- Header ticket reference: "Issue #142" for a merged group; "PR #148" for a PR's own group.
- Chain note tooltip: the full chain note text, on every merged header.

Prototype (approved; supersede `Runs.dc.html` and `RunsPaged.dc.html`, which stay untouched):

- `design/prototype/project/RunsLinked.dc.html`: merged group, one PR (#142 + PR #148, #131 + PR #133).
- `design/prototype/project/RunsLinkedSeveralPrs.dc.html`: merged group, issue with several PRs.
- `design/prototype/project/RunsLinkedSplitPr.dc.html`: one PR in two groups (older runs unlinked).
- `design/prototype/project/RunsLinkedFiltered.dc.html`: "Needs you" filter on a merged group.
- `design/prototype/project/RunsLinkedLongChain.dc.html`: long chain note cut off, with tooltip.
- `design/prototype/project/RunsPagedLinkedPrOnly.dc.html`: page 4 of 4, only the PR runs of a merged group.
- `design/prototype/project/RunsPagedLinkedIssueOnly.dc.html`: page 4 of 4, only the issue runs of a merged group.
- `design/prototype/project/RunsPageLoadingLinked.dc.html`: loading page 3 from page 4, merged group.

**Blocker: Storybook first.** Before any task that implements this UI in `apps/web/src/{app,features}` or wires it to
data starts, the related Storybook stories are added or updated and reviewed: every changed or new `ds/`,
`components/` and `screens/` piece has a story for each state above (default, loading, empty, error, and the others
the spec names), fed from `@/mocks` fixtures, matching the approved prototype boards, with each new board registered
in `canvas.json`, `screens/storyIds.ts` and `scripts/parity.mjs` together. No UI implementation work begins until
that is done.

## Testing

Confirmed by the human at planning time.

Every behaviour is pinned at the lowest layer that proves it. E2E runs on mock when the web alone proves it and on
local when it crosses API, intake and the fake board.

| Rule | Behaviour | Layer | Where the test lives | E2E env |
| ---- | --------- | ----- | -------------------- | ------- |
| BR-1 | An issue's runs and its PR's linked runs sit in one group; the group identity comes from `linkedTickets` and is separate from `ticketKey`; #142 and PR #148 under one header; a fake issue, then a fake PR with `linked` naming it, each commented, show one header | unit; component/story; e2e | `apps/web/src/features/runs/map.test.ts`; `apps/web/src/features/runs/runs.route.test.tsx`; `apps/web/e2e/mock/runs-board.spec.ts`; `apps/web/e2e/local/ticket-groups.spec.ts` (new) | mock, local |
| BR-2 | Per-ticket counts in the chain note (T4), right side empty for a merged header; a second PR comment raises only the PR's count | unit (chain note builder); component/story; e2e | `map.test.ts`; `apps/web/src/components/RunList.test.tsx` (`TicketGroupRow` merged); `runs-board.spec.ts`; `ticket-groups.spec.ts` | mock, local |
| BR-3 | The same issue-led header and counts on every page; a page with only the PR's linked runs is led by the issue; page 1 only PR runs, page 2 only issue runs (seedLists split pair); locally an issue run, then 20 runs on other tickets (`queueRuns`), then a linked PR run | unit; component/story; integration; e2e | `map.test.ts` (T5 lead); `runs.route.test.tsx`; `apps/api/test/runs.int.test.ts` (small `pageSize`, a page holding only PR runs still lists the issue); `apps/web/e2e/mock/runs-paging.spec.ts`; `ticket-groups.spec.ts` | mock, local |
| BR-4 | Several PRs, one chain note; a linked PR run's `linkedTickets` lists the lead issue, then the lead's other PRs with their counts; a page holding only one of several PRs' runs shows the full chain note | unit; integration; e2e | `map.test.ts`; `runs.int.test.ts` (the other-PRs list); `runs-board.spec.ts` (an issue with two PRs); `runs-paging.spec.ts` (a page holding only one of several PRs' runs) | mock |
| BR-5 | Runs oldest first; the group placed by its newest run | unit; e2e | `map.test.ts`; `runs-board.spec.ts` | mock |
| BR-6 | An unlinked PR keeps its own header | unit; e2e | `map.test.ts`; `runs-board.spec.ts` | mock |
| BR-7 | Unrelated tickets stay apart | unit; e2e | `map.test.ts`; `runs-board.spec.ts` | mock |
| BR-8 | Grouping off shows the flat list | e2e | `runs-board.spec.ts` | mock |
| BR-9 | The run limit stays per ref: `runsForTicket` counts only the PR's ref; with `maxRunsPerTicket` 2 a third PR comment shows "Ticket reached its run limit" in Ignored and an issue comment still starts a run | integration; e2e | `packages/core/test/intake.int.test.ts`; `ticket-groups.spec.ts` | local |
| BR-10 | A cross-repo ref is dropped | unit; integration | `packages/core/test/adapters/github.test.ts`; `intake.int.test.ts` | — |
| BR-11 | A PR linked to several issues joins the lowest-numbered issue with runs | unit; e2e | `map.test.ts`; `runs-board.spec.ts` (a PR linked to two issues with runs sits under the lower-numbered one) | mock |
| BR-12 | A linked issue with zero runs is dropped, so the PR shows as today | unit; integration; e2e | `map.test.ts`; `runs.int.test.ts`; `runs-board.spec.ts`; `ticket-groups.spec.ts` | mock, local |
| BR-13 | Link from the PR description (body closing keywords) | unit; e2e | `github.test.ts`; `ticket-groups.spec.ts` (fake PR with `linked`) | local |
| BR-14 | Link from the issue's link fields: refs from `closingIssuesReferences` only, with no body keyword; a fake PR's `linkedRefs` = its own `linked` ∪ the issues listing it; locally the fake issue's `linked` names the PR and the PR names nothing | unit; e2e | `github.test.ts`; `packages/core/test/adapters/fake.test.ts`; `ticket-groups.spec.ts` | local |
| BR-15 | The lookup fails or hangs: the run starts with `'{}'` and shows in the PR's own group; a GraphQL failure keeps body refs and `getTicket` resolves | integration; unit | `intake.int.test.ts`; `github.test.ts` | — |
| BR-16 | Runs from before the change (`'{}'`) stay in the PR's own group; one PR with old unlinked and new linked runs shows the PR's own group plus the issue group, with distinct group keys; a `'{}'` PR run gets `[]` even when a newer run of the same PR is linked; existing rows read `'{}'`; locally a PR with no link is commented, re-added with `linked` and commented again: two groups | unit; component/story; integration; e2e | `map.test.ts`; `runs.route.test.tsx` (two headers); `runs.int.test.ts`; `packages/db/test/migrate.int.test.ts`; `runs-board.spec.ts`; `ticket-groups.spec.ts` | mock, local |
| BR-17 | The PR's newest linked run decides for all its linked runs; a new PR run without a link sits in the PR's own group while earlier linked runs stay merged | unit; integration; e2e | `map.test.ts`; `runs.int.test.ts` (the newest linked run's refs decide; newest run `'{}'`, earlier linked runs keep the issue); `runs-board.spec.ts` | mock |
| BR-18 | A single-ticket group keeps "N of max runs" on the right | component/story; e2e | `RunList.test.tsx` (single: unchanged); `runs-board.spec.ts` | mock |
| BR-20 | A link added at the source merges from the next PR run onward, and only that run: PR-only group "PR #… · 2 of 10 runs" holds run 1, the issue's group holds run 2 with "PR #… (2 of 10 runs)" in its note | e2e | `ticket-groups.spec.ts` | local |
| BR-21 | A page with only the issue's runs shows the merged header with the PR counts; an issue run lists the PRs whose newest linked run names it | unit; integration; e2e | `map.test.ts`; `runs.int.test.ts`; `runs-paging.spec.ts` (page 2) | mock |
| — | Each item's own `ticketRunCount` is unchanged; counting and the limit stay per `ticketRef` | integration | `runs.int.test.ts`; `intake.int.test.ts` | — |
| — | A linked entry's kind, number, title, url and labels come from the newest snapshot; its count is over all statuses whatever the filter; several entries come in the contract's order: the issue first, then PRs by number | integration | `runs.int.test.ts`, every response through `expectContract('runs.list' \| 'runs.stats')`, `insertRun` setting `linkedIssueRefs` | — |
| — | `stats.idleRun` carries `linkedTickets` | integration | `runs.int.test.ts` | — |
| — | Every `LinkedTicketDto` field is required and `ticketRunCount` 0 is rejected; `RunListItem.linkedTickets` is required (`[]` parses, a missing field fails); `RunStatsDto.idleRun` parses with it | contract | `packages/contracts/src/schemas/runs.test.ts` | — |
| — | Only integers are stored, and only on PR runs: a PR run stores `linked_issue_refs` from the prefetched ticket; an issue run stores `'{}'` even when the fake issue has `linked`; positive integers only, capped at 10; union and dedupe | integration; unit | `intake.int.test.ts`; `github.test.ts` | — |
| — | An issue fetch makes no GraphQL call and returns `linkedRefs: []`; a fake issue's `linkedRefs` is `[]`; the existing "getTicket maps issues and PRs" test gains the PR's GraphQL intercept | unit | `github.test.ts`; `fake.test.ts` | — |
| — | `runs.linked_issue_refs` is `text[] not null default '{}'`; rows inserted before the migration read `'{}'` (same style as "the pause and resume migration changes no runs rows"); the app role writes it | integration | `migrate.int.test.ts` | — |
| — | `DevTicketBody` accepts `linked` on PRs and issues | integration | API dev fake controller test | — |
| — | MSW computes `linkedTickets` by the API rules (own link, newest linked run, reverse for issues, drop zero, order) | unit | `apps/web/src/mocks/msw/contract.test.ts` | — |
| — | `seedLists` links option; each linked `runsUsed <= runsMax` in mocks | unit | `apps/web/src/mocks/msw/e2eLists.test.ts`; `apps/web/src/mocks/mocks.test.ts` | — |
| — | Stories in `RunRow.stories.tsx` and `screens/runs.stories.tsx` pass the axe smoke test | component/story | existing axe smoke test | — |

### Not provable by e2e

- BR-10 cross-repo: the fake provider has one repo (`FAKE_REPOS = ['dev/demo']`). Proved by the GitHub adapter unit
  test and the intake int test.
- BR-15 lookup down or slow: the fake `getTicket` cannot be made to fail from e2e. Proved by the intake int tests
  (error, hang) and the GraphQL failure unit test.
- BR-16 for rows that existed before the migration: they cannot be made in e2e. Proved by the migration int test
  (`'{}'`), the API int test (`'{}'` gives `[]`) and the web unit test. The same behaviour for unlinked runs is shown
  end to end by the mock case and the local BR-20 case.
- BR-17 with the description edited to drop the issue: proved by the API int test (newest run `'{}'`, earlier linked
  runs keep the issue) and the web unit test. The local BR-20 case drives the opposite edit (adding the link) through
  the same path.
- Real GitHub REST and GraphQL: no network in tests. Proved by recorded payloads.

### Fakes and fixtures

- GitHub: undici `MockAgent` (existing) for REST and `POST /graphql`. New scrubbed fixtures in
  `packages/core/test/fixtures/github/`: `graphql.pr-closing-issues.json`, and a `pull.json` variant whose body has
  closing keywords.
- Fake provider (changed): `StoredTicket.linked` and `DevTicketBody.linked`.
- Mock db (changed): each `RunDto` gains a mock-only `linkedIssueRefs`; PR #148 runs list `142` and PR #133 runs list
  `131`. The MSW list and stats handlers derive `linkedTickets` from them.
- `mocks/runs.ts` `ticketGroups` and `runs.stories.tsx` `lastPageGroups` move to the T4 chain note (ui-ux view model).
- `mocks/msw/e2eLists.ts` `seedLists` (changed) gets a links option, tested in `e2eLists.test.ts`, covering pairs, an
  issue with two PRs, an issue with two PRs whose runs are split across pages (BR-4), a PR with two issues, a PR linked
  to a zero-run issue, a split pair across pages, and a PR with old unlinked and new linked runs.
- Local e2e (new helpers): next to `commentOnNewTicket` in `apps/web/e2e/local/helpers.ts`, a fake issue and a fake PR
  with `linked` on either side, with random numbers.
- Backend data goes through `insertRun` and intake. No new dependency.

### Security tests

- Tenant scope (rule 4), API int: a P1 PR run with refs `['142']` where #142 has runs only in P2 gets `[]`; a P2 issue
  run never lists P1 PRs. Reads stay inside `withOrg`; `runs` RLS is unchanged and already tested (`runs` stays in
  "rls is forced on every org table" and the existing leak tests). No new RLS test: no new table.
- Untrusted text (rule 6), GitHub unit: a hostile or very long body yields only positive same-repo integers; `#0`,
  `#-1`, `owner/repo#5`, markdown/HTML around the number; the GraphQL request carries the number only in `variables`
  (assert the intercepted body).
- Logs (rule 5): the intake warn on a lookup failure carries the error name only, no body text.
- Authz (rule 7): no new endpoint; `runs.list` and `runs.stats` keep their 401/404 tests.

### Coverage risks

- Web (baseline 95.4/88.1): each branch of the group identity, the T5 lead, the T6 split, the chain note and the
  merged/single header.
- Core (80/70): each link source, the fallback, the cap, cross-repo, issue-no-call, the intake PR-only write and the
  failure paths.
- API (70/60): `linkedTickets` assembly (own link, newest linked run, reverse, drop zero, order).
- No sensitive coverage group moves (intake is sensitive for review only). Patch coverage is 80%, including the dev
  fake controller. Thresholds and the baseline are never lowered.

### Test order and determinism

- First failing tests: `map.test.ts` › groupByTicket › "puts runs of an issue and its linked PR under one group, each
  with its own run count" (two groups today), and `runs.route.test.tsx` › "shows issue #142 and PR #148 under one
  ticket header". Every other layer is written red first.
- The existing route-test group-order and "#131 2 of 10 runs" assertions are updated, never deleted.
- "Newest linked run" is ordered by `queued_at desc` with an id tiebreak; the API int test inserts runs with explicit,
  distinct `queuedAt`. Group order follows run numbers, and TZ stays pinned.
- The local spec uses random tickets in its own project, asserts only there, and has no sleeps.
- Worker: not touched; polling reaches the same intake, which the intake int test covers.

## Agent calls

- Agent call: flat view, ticket filter/search, run detail chain, Ignored list and run limits stay unchanged (business,
  ui-ux: the requirement names only the grouped Runs list).
- Agent call: the issue's runs of any age lead the group (business: the link lives on the PR run, the issue's run
  normally comes before its PR, and T2 needs the issue's runs).
- Agent call: the link is a snapshot taken when a PR run is created, and a source change shows from that PR's next run;
  the newest run with a link decides for the PR's linked runs (business, architecture: like title and labels).
- Agent call: only same-repo positive ticket numbers are kept, at most 10 per PR run (business, architecture: the link
  data is untrusted).
- Agent call: a page holding only the issue's runs shows the same merged header with the PR counts (business, ui-ux:
  T5's same header on every page, and board `RunsPaged.dc.html` shows the continued header with its chain note).
- Agent call: in a chain note with several PRs, the PRs are in number order (business, ui-ux: matches the contract's
  PR order).
- Agent call: `linkedTickets` on a PR run also lists the lead issue's other PRs that have linked runs, with their
  counts, so the header is the same on every page (business, architecture: BR-4 and T5; cheap, the reverse lookup is
  already in query 1 and only its input set grows).
- Agent call: a PR run whose link is missing or whose lookup failed or timed out still starts and stays in the PR's own
  group (business, architecture: grouping is never worth a lost run).
- Agent call: `LinkedTicketDto` includes `labels`, from the same newest-run snapshot (business, architecture, ui-ux: T5
  wants the same issue-led header on every page, today's header shows labels, and it costs nothing).
- Agent call: the `LinkedTicketDto` and `RunListItem.linkedTickets` contract as written in Architecture › API
  (architecture: the API sends everything the header needs, with no new endpoint).
- Agent call: each PR has exactly one lead issue, the lowest-numbered issue with at least one run among the issues its
  newest linked run lists, picked by the API (architecture: every page agrees).
- Agent call: migration `0022_runs_add_linked_issue_refs.sql` adds the per-run `runs.linked_issue_refs` column
  (architecture: a per-run snapshot keeps runs from before the change ungrouped, T3).
- Agent call: migration `0023_runs_add_linked_issue_refs_idx.sql` adds a partial GIN index for the reverse lookup
  (review finding: without it the lookup scans every linked PR run in the project; plain `CREATE INDEX`, as in
  `0020_inbound_events_ignored_idx.sql`).
- Agent call: `RunsService.listItems` adds 3 constant queries inside the existing `withOrg` transaction, bounded by
  page size (architecture: database.md §8).
- Agent call: `Ticket` gains `linkedRefs`, filled by `getTicket` so it rides the existing prefetch under
  `TICKET_TIMEOUT_MS` (architecture: no new fetch step, outside the DB transaction).
- Agent call: GitHub links come from PR description closing keywords ∪ GraphQL `closingIssuesReferences`, in one
  GraphQL request via `octokit.graphql`, keeping description refs when GraphQL fails (architecture: GitHub's own link
  fields, the only way to know the issue from a PR, and the App already has Issues and Pull requests read).
- Agent call: the fake's `StoredTicket.linked` can be set on a PR or an issue, and `DevTicketBody` accepts it
  (architecture: the fake changes with the seam and covers both T1 sides).
- Agent call: no ADR (architecture: the change reuses the adapter seam and the intake snapshot pattern, with no new
  mechanism).
- Agent call: when one PR's old and new runs sit in two groups, both show the same PR count (ui-ux: the limit counts
  every run of the ticket).
- Agent call: `TicketGroup` keeps `ticket` + `runsUsed` for the lead, adds `linked?`, and `chainNote` stays a string
  built in `map.ts` (ui-ux: mappers own display text, frontend.md §3, and existing single-ticket groups and stories
  stay valid).
- Agent call: the header React key is the group identity (lead kind + number) (ui-ux: keeps the merged group and the
  PR's own group apart on one page, T6).
- Agent call: always "runs", also for one (ui-ux: as the board and today's header).
- Agent call: the header stays one line; the title gives way first, then the chain note with an ellipsis; the chain
  note's full text is in a `title` tooltip on every merged header, as the approved boards draw it (ui-ux: the chain
  note is longer now that it holds counts).
- Agent call: the mock db keeps the link as a field on each mock run (testing: it mirrors the per-run column, so MSW
  applies the same rules as the API).
- Agent call: reuse #142/#148 and #131/#133 and add the edge cases through `seedLists` (testing: the many base-fixture
  tests stay untouched).
- Agent call: the contract and API tests cover every `LinkedTicketDto` field, labels included (testing: the spec takes
  `labels`, so the test design does not change).
- Agent call: the BR-4 mock e2e for a page holding only one of several PRs' runs lives in `runs-paging.spec.ts`, seeded
  through `seedLists` (spec writer: that spec already holds the split-across-pages cases).

## Open questions

None.

## E2E requirements

These rules are requirements. Each is what a user can see at the Runs page's grouped list (UI; no new endpoint); the feature is done when every case below passes as an e2e spec. Derived from this spec's business rules and the sibling sources it cites (shared-pagination spec BR-21/BR-22, prototype boards `RunsLinked*`/`RunsPaged*`), not from the code.

### Rules

| Id    | Category            | Rule                                                                                                                                                                                                                                                                      | Source                         |
| ----- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| BR-1  | conditional-display | When "Grouped by ticket" is on and a PR run linked to an issue that has runs is listed, a member sees one group holding the issue's runs and the PR's linked runs, each row still showing its own ticket (#142 / PR #148).                                                | spec ## Business rules › Rules |
| BR-2  | calculation         | When a merged group shows, the member sees each ticket's own count in the chain note, "Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs)", and no count on the right; never a sum.                                                                                       | spec ## Business rules › Rules |
| BR-3  | calculation         | When a merged group's runs cross a page break, the member sees on every page holding any of its runs the same header led by the issue (number, title, labels) with the same counts, even on a page with only the PR's runs or only the issue's runs.                       | spec ## Business rules › Rules |
| BR-4  | conditional-display | When an issue has several related PRs with linked runs, the member sees one group whose chain note lists each PR in number order with its own count, "Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs), PR #150 (2 of 10 runs)", on every page of that group.            | spec ## Business rules › Rules |
| BR-5  | ordering            | When a merged group shows, its runs are listed oldest first across the tickets, and the group sits in the list by its newest run.                                                                                                                                         | spec ## Business rules › Rules |
| BR-6  | negative            | When a PR has no related issue, the member sees its runs in their own group headed by the PR with "N of max runs" on the right, as today.                                                                                                                                 | spec ## Business rules › Rules |
| BR-7  | negative            | When an issue and a PR are not related (including the same number on a host with separate numbering), the member sees separate groups.                                                                                                                                    | spec ## Business rules › Rules |
| BR-8  | negative            | When "Grouped by ticket" is off, the member sees the flat list unchanged.                                                                                                                                                                                                 | spec ## Business rules › Rules |
| BR-9  | business-rule       | When a PR has used its run limit and someone comments a command on it, no run starts and the Ignored list shows "Ticket reached its run limit", even if the related issue has runs left; and the reverse.                                                                 | spec ## Business rules › Rules |
| BR-10 | tenancy             | When a PR names an issue in another repository, the member sees the PR's runs in their own group.                                                                                                                                                                         | spec ## Business rules › Rules |
| BR-11 | edge                | When a PR is related to several issues, its linked runs appear once, under the lowest-numbered related issue that has runs.                                                                                                                                               | spec ## Business rules › Rules |
| BR-12 | edge                | When a PR's related issue has no runs in the project, the member sees the PR's runs in their own group as today, with no chain note.                                                                                                                                      | spec ## Business rules › Rules |
| BR-13 | business-rule       | When a PR's description names the issue it closes (e.g. "Closes #142") and a run starts on the PR, the member then sees that run under issue #142's group.                                                                                                                | spec ## Business rules › Rules |
| BR-14 | business-rule       | When the issue's linked-PR fields list the PR (its description does not name the issue) and a run starts on the PR, the member then sees that run under the issue's group.                                                                                               | spec ## Business rules › Rules |
| BR-15 | edge                | When the link cannot be read (ticket source down or slow) as a PR run starts, the run still starts and the member sees it in the PR's own group.                                                                                                                          | spec ## Business rules › Rules |
| BR-16 | compatibility       | When PR runs were created before this change, the member sees them in the PR's own group, even after a newer run of that PR has merged into the issue's group (T6).                                                                                                       | spec ## Business rules › Rules |
| BR-17 | edge                | When a PR's linked runs name different issues (its description changed between runs), the member sees all of that PR's linked runs in one group, the lowest-numbered related issue that has runs; its runs without a link stay in the PR's own group.                     | spec ## Business rules › Rules |
| BR-18 | negative            | When a group holds a single ticket, the member sees "N of max runs" on the right as today.                                                                                                                                                                                | spec ## Business rules › Rules |
| BR-20 | edge                | When a link is added at the ticket source after the PR's runs started, the member sees them merged only from the PR's next run (earlier runs stay in the PR's own group).                                                                                                 | spec ## Business rules › Rules |
| BR-21 | conditional-display | When a page holds only the issue's runs of a merged group, the member sees the same merged header with each PR's count in the chain note.                                                                                                                                 | spec ## Business rules › Rules |

### Test cases

Common to every case: signed in as a member with `run:read` on the project, on the project's Runs page with "Grouped by ticket" on, unless the case says otherwise. "Merged header" means the group header led by "Issue #N", the issue's title and labels, with the chain note and nothing on the right. Mock cases use a seeded list scenario; local cases use random ticket numbers in their own project (the numbers below are examples).

#### BR-1: One group holds the issue's runs and its PR's linked runs

| Case   | Type     | Env   | Given                                                                                                               | Steps                                                                                                                                                      | Expected                                                                                                                                                                                                                          |
| ------ | -------- | ----- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-1.1 | positive | mock  | Issue #142 has 1 run; PR #148 has 1 run linked to #142 (the mock #142 + PR #148 pair)                                | 1. Open the Runs page with "Grouped by ticket" on.                                                                                                         | 1. One group header "Issue #142" with its title and labels. 2. Under it two rows: one with Ticket `#142`, one with Ticket `PR #148`. 3. No separate group headed "PR #148".                                                          |
| TC-1.2 | positive | local | A fake issue exists; a fake PR exists whose description-side link names the issue (`linked`); the issue is commented so it has a run | 1. Comment a command on the fake PR. 2. Open the Runs page with "Grouped by ticket" on.                                                                    | 1. One group header led by the issue. 2. Both the issue's run and the PR's run are rows in it, each Ticket column showing its own ticket. 3. No separate group headed by the PR.                                                    |

#### BR-2: Each ticket's own count in the chain note, never a sum

| Case   | Type     | Env   | Given                                                                                           | Steps                                                                                                  | Expected                                                                                                                                                                                              |
| ------ | -------- | ----- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-2.1 | positive | mock  | Issue #142 has 1 run; PR #148 has 1 linked run; run limit 10                                    | 1. Open the Runs page. 2. Read the merged header.                                                      | 1. Chain note reads "Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs)". 2. Nothing on the right side of the header (no "N of 10 runs").                                                            |
| TC-2.2 | boundary | mock  | Issue #142 has 2 runs; PR #148 has 1 linked run                                                 | 1. Open the Runs page. 2. Read the merged header.                                                      | 1. Chain note reads "Issue #142 (2 of 10 runs) → PR #148 (1 of 10 runs)". 2. No "3 of 10 runs" appears anywhere on the page. 3. Nothing on the right of the header.                                  |
| TC-2.3 | state    | local | A merged group of a fake issue (1 run) and a fake PR linked to it (1 run)                       | 1. Comment a command on the PR a second time. 2. Open (or reload) the Runs page.                       | 1. Chain note reads "Issue #N (1 of 10 runs) → PR #M (2 of 10 runs)": only the PR's count changed. 2. Nothing on the right of the header.                                                            |

#### BR-3: The same header on every page of a merged group

| Case   | Type     | Env   | Given                                                                                                                                                                       | Steps                                                                                                                         | Expected                                                                                                                                                                                                                                                       |
| ------ | -------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-3.1 | positive | mock  | A merged group, issue #12 (1 run) and PR #13 (2 runs), split so page 4 of 4 holds only PR #13's runs (board `RunsPagedLinkedPrOnly`)                                         | 1. Open the Runs page. 2. Go to page 4.                                                                                       | 1. Page 4 shows a header led by "Issue #12", with its title and labels. 2. Chain note reads "Issue #12 (1 of 10 runs) → PR #13 (2 of 10 runs)". 3. Under it only `PR #13` rows. 4. Nothing on the right.                                                      |
| TC-3.2 | state    | mock  | Same scenario; the merged group has runs on two consecutive pages                                                                                                           | 1. Open the Runs page and read the merged header. 2. Go to the next page and read the merged header.                           | 1. Both pages show a header with identical issue number, title, labels and chain note counts.                                                                                                                                                                  |
| TC-3.3 | positive | local | A fake issue is commented first (1 run); then enough runs on other tickets are created (the spec uses 20) that the next run falls on another page; then a linked fake PR is commented (1 run) | 1. Open the Runs page. 2. Move to the page that holds only the PR's run.                                                      | 1. That page shows a header led by the issue with "Issue #N (1 of 10 runs) → PR #M (1 of 10 runs)". 2. Under it only the `PR #M` row.                                                                                                                         |

#### BR-4: Several PRs in one chain note, in number order

| Case   | Type     | Env  | Given                                                                                                                                  | Steps                                                                    | Expected                                                                                                                                                                                                       |
| ------ | -------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-4.1 | positive | mock | Issue #142 has 1 run; PR #148 has 1 linked run; PR #150 has 2 linked runs (board `RunsLinkedSeveralPrs`)                                | 1. Open the Runs page.                                                   | 1. One merged group led by "Issue #142". 2. Chain note reads "Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs), PR #150 (2 of 10 runs)", PR #148 before PR #150. 3. No separate group for either PR.       |
| TC-4.2 | state    | mock | Same issue with two PRs, runs split across pages so that one page holds only PR #148's runs                                              | 1. Open the Runs page. 2. Go to the page that holds only PR #148's runs. | 1. The header is led by "Issue #142". 2. Chain note shows the full "Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs), PR #150 (2 of 10 runs)", including PR #150 though none of its rows are on this page. |

#### BR-5: Oldest first inside the group; group placed by its newest run

| Case   | Type     | Env  | Given                                                                                                                                                              | Steps                                              | Expected                                                                                                                                                                              |
| ------ | -------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-5.1 | positive | mock | A merged group with issue run created first, a PR run second, another issue run third                                                                               | 1. Open the Runs page. 2. Read the rows in the group. | 1. Rows are listed oldest first across `#142` and `PR #148` rows, interleaved by creation time, not issue rows before PR rows.                                                       |
| TC-5.2 | positive | mock | Two groups: a merged group whose newest run is the most recent run on the page, and a single-ticket group whose newest run is older                                 | 1. Open the Runs page. 2. Read the order of group headers. | 1. The merged group is listed by its newest run (the PR's), in the same position rule as a single-ticket group with that newest run. 2. The older single-ticket group sits after it.     |

#### BR-6: A PR with no related issue keeps its own group

| Case   | Type     | Env  | Given                                                                | Steps                  | Expected                                                                                                                                                  |
| ------ | -------- | ---- | -------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-6.1 | negative | mock | A PR with 2 runs and no link to any issue (no issue shares a group)   | 1. Open the Runs page. | 1. A group headed "PR #N" with its title. 2. "2 of 10 runs" on the right. 3. No chain note. 4. Rows show Ticket `PR #N`.                                    |

#### BR-7: Unrelated tickets stay in separate groups

| Case   | Type     | Env  | Given                                                                                                              | Steps                  | Expected                                                                                                                                                       |
| ------ | -------- | ---- | ------------------------------------------------------------------------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-7.1 | negative | mock | Issue #131 with runs and PR #148 with runs, no link between them                                                    | 1. Open the Runs page. | 1. Two separate groups: "Issue #131" and "PR #148". 2. Each shows "N of 10 runs" on the right. 3. No chain note on either.                                     |
| TC-7.2 | boundary | mock | An issue and a PR with the same number (for example #148 and PR #148), no link between them                         | 1. Open the Runs page. | 1. Two separate groups, one headed for the issue, one headed "PR #148". 2. Rows of each stay in their own group. 3. No chain note on either.                    |

#### BR-8: Grouping off shows the flat list unchanged

| Case   | Type     | Env  | Given                                                                                       | Steps                                                                                          | Expected                                                                                                                                                                  |
| ------ | -------- | ---- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-8.1 | negative | mock | Issue #142 and linked PR #148 each have runs (merged group visible with grouping on)         | 1. Open the Runs page with "Grouped by ticket" on. 2. Turn "Grouped by ticket" off.             | 1. The list is flat: no group headers, no chain note. 2. Every run of #142 and PR #148 is a row, each with its own Ticket value. 3. Same rows and order as the flat list before this change. |

#### BR-9: Run limit is per ticket

| Case   | Type     | Env   | Given                                                                                                                                                                              | Steps                                                                                                                                                           | Expected                                                                                                                                                                              |
| ------ | -------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-9.1 | negative | local | Run limit per ticket is 2. A fake issue is linked from a fake PR; the issue has 1 run; the PR has 2 runs (limit used)                                                                | 1. Comment a command on the PR (third time). 2. Open the Ignored list.                                                                                           | 1. No third PR run starts: the PR's run count stays 2. 2. The Ignored list shows "Ticket reached its run limit" for that comment.                                                       |
| TC-9.2 | positive | local | Same state as TC-9.1                                                                                                                                                                | 1. Comment a command on the issue. 2. Open the Runs page.                                                                                                       | 1. A new issue run starts. 2. The merged header chain note shows "Issue #N (2 of 2 runs) → PR #M (2 of 2 runs)" (issue count rose to 2, PR count unchanged). 3. Nothing about the limit in Ignored for this comment. |
| TC-9.3 | negative | local | Run limit per ticket is 2. A fake issue has 2 runs (limit used); a linked fake PR has 1 run                                                                                          | 1. Comment a command on the issue (third time). 2. Open the Ignored list.                                                                                        | 1. No third issue run starts: the issue's count stays 2. 2. The Ignored list shows "Ticket reached its run limit", although the PR has a run left.                                      |

#### BR-10: Cross-repository link

Not e2e: the fake provider has one repo (`dev/demo`), so a cross-repo ref cannot be made; proved by the GitHub adapter unit test and the intake int test (spec ## Testing).

#### BR-11: A PR related to several issues joins the lowest-numbered one with runs

| Case    | Type     | Env  | Given                                                                                                        | Steps                  | Expected                                                                                                                                                                                                                              |
| ------- | -------- | ---- | ------------------------------------------------------------------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-11.1 | positive | mock | Issues #142 and #150 both have runs; PR #148 has a linked run listing both #142 and #150                       | 1. Open the Runs page. | 1. PR #148's run is a row in the "Issue #142" group. 2. Chain note of that group includes "PR #148 (1 of 10 runs)".                                                                                                                  |
| TC-11.2 | negative | mock | Same scenario                                                                                                  | 1. Open the Runs page. 2. Read the "Issue #150" group. | 1. The "Issue #150" group has only issue #150's own runs. 2. PR #148's run appears exactly once on the page (not in both groups). 3. "Issue #150" shows "N of 10 runs" on the right and no chain note.                              |

#### BR-12: Linked issue with no runs

| Case    | Type     | Env   | Given                                                                                                           | Steps                                                                                       | Expected                                                                                                                                     |
| ------- | -------- | ----- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-12.1 | negative | mock  | PR #148 has a linked run whose linked issue has no runs in the project                                           | 1. Open the Runs page.                                                                      | 1. A group headed "PR #148" with "N of 10 runs" on the right. 2. No chain note. 3. No group headed by the linked issue.                       |
| TC-12.2 | negative | local | A fake PR whose link names a fake issue that has never been commented (no runs)                                  | 1. Comment a command on the PR. 2. Open the Runs page.                                       | 1. The PR's run is in a group headed by the PR with "1 of 10 runs" on the right. 2. No chain note, no issue group.                            |

#### BR-13: Link from the PR description

| Case    | Type     | Env   | Given                                                                                                                                                               | Steps                                                                                      | Expected                                                                                                                              |
| ------- | -------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| TC-13.1 | positive | local | A fake issue #N with 1 run; a fake PR created with the description-side link naming the issue (as "Closes #N"), the issue's own link fields empty                  | 1. Comment a command on the PR. 2. Open the Runs page.                                      | 1. The new PR run is a row (Ticket `PR #M`) under the "Issue #N" group. 2. Chain note includes "PR #M (1 of 10 runs)".                |

#### BR-14: Link from the issue's linked-PR fields

| Case    | Type     | Env   | Given                                                                                                                              | Steps                                                | Expected                                                                                                                                  |
| ------- | -------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| TC-14.1 | positive | local | A fake issue #N with 1 run whose linked-PR field lists the PR; a fake PR that names nothing in its description                      | 1. Comment a command on the PR. 2. Open the Runs page. | 1. The PR run is a row (Ticket `PR #M`) under the "Issue #N" group. 2. Chain note includes "PR #M (1 of 10 runs)".                         |

#### BR-15: Link cannot be read

Not e2e: the fake provider's ticket read cannot be made to fail or hang from e2e; proved by the intake int tests (error, hang) and the GraphQL failure unit test (spec ## Testing).

#### BR-16: PR runs from before linking stay in the PR's own group

| Case    | Type     | Env   | Given                                                                                                                                                                                  | Steps                                                                                                                                                                  | Expected                                                                                                                                                                                                                                                                                             |
| ------- | -------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-16.1 | state    | mock  | PR #148 has an older run with no link and a newer run linked to issue #142 (which has a run); board `RunsLinkedSplitPr`                                                                | 1. Open the Runs page.                                                                                                                                                 | 1. Two groups: the merged "Issue #142" group holding the new `PR #148` run and #142's run; and a group headed "PR #148" holding the older run with "2 of 10 runs" on the right. 2. The merged chain note shows "PR #148 (2 of 10 runs)". 3. Each group sits by its own newest run.                      |
| TC-16.2 | state    | local | A fake PR with no link, commented once (1 run); a fake issue with 1 run exists                                                                                                          | 1. Re-add the fake PR with a link naming the issue. 2. Comment a command on the PR again. 3. Open the Runs page.                                                        | 1. Two groups: the PR's own group (header with the PR, "2 of 10 runs" on the right) holding the first run, and the issue's merged group holding the second PR run. 2. The merged chain note shows "PR #M (2 of 10 runs)".                                                                                |

#### BR-17: Linked runs of one PR naming different issues; unlinked newest run

| Case    | Type  | Env  | Given                                                                                                                                              | Steps                  | Expected                                                                                                                                                                                              |
| ------- | ----- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-17.1 | state | mock | Issues #142 and #150 both have runs; PR #148 has two linked runs, one naming #150 and a newer one naming #142                                       | 1. Open the Runs page. | 1. Both PR #148 linked runs are rows in the one "Issue #142" group. 2. None of PR #148's runs is in the "Issue #150" group. 3. PR #148 appears once in the chain note.                                 |
| TC-17.2 | state | mock | PR #148 has earlier runs linked to issue #142 (which has runs) and a newest run with no link                                                       | 1. Open the Runs page. | 1. The "Issue #142" group still holds PR #148's earlier linked runs. 2. A group headed "PR #148" holds only the newest unlinked run, with "N of 10 runs" on the right. 3. The two groups are separate. |

#### BR-18: A single-ticket group keeps "N of max runs" on the right

| Case    | Type     | Env  | Given                                                              | Steps                  | Expected                                                                                                              |
| ------- | -------- | ---- | ------------------------------------------------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| TC-18.1 | negative | mock | Issue #139 has 3 runs and no PR linked to it with runs               | 1. Open the Runs page. | 1. A group headed "Issue #139" with "3 of 10 runs" on the right. 2. No chain note.                                     |

#### BR-20: A link added at the source merges from the PR's next run

| Case    | Type  | Env   | Given                                                                                                                                | Steps                                                                                                                                      | Expected                                                                                                                                                                                                                                                      |
| ------- | ----- | ----- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-20.1 | state | local | A fake issue with 1 run; a fake PR with no link, commented once (run 1)                                                              | 1. Open the Runs page and see the PR's group. 2. Add the link at the source (re-add the PR with a link naming the issue). 3. Comment on the PR again (run 2). 4. Open the Runs page. | 1. Before the link (step 1): the PR's own group shows "1 of 10 runs" on the right. 2. After run 2: the PR's own group "PR #M · 2 of 10 runs" holds run 1. 3. The issue's group holds run 2, with "PR #M (2 of 10 runs)" in its chain note. |

#### BR-21: A page with only the issue's runs shows the merged header

| Case    | Type  | Env  | Given                                                                                                                                | Steps                                                                    | Expected                                                                                                                                                                       |
| ------- | ----- | ---- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TC-21.1 | state | mock | Issue #12 has 2 runs and PR #13 has 1 linked run, split so page 4 of 4 holds only #12's runs (board `RunsPagedLinkedIssueOnly`)      | 1. Open the Runs page. 2. Go to page 4.                                  | 1. Header "Issue #12" with title and labels. 2. Chain note reads "Issue #12 (2 of 10 runs) → PR #13 (1 of 10 runs)". 3. Under it only `#12` rows. 4. Nothing on the right.        |

### Open questions

- Q1 (BR-3, TC-3.1, TC-3.2, TC-3.3, TC-4.2, TC-21.1): the control and label used to move between pages, and the page size, are not stated in this spec. Until answered, the cases assert only that the user moves to the page holding the named runs (TC-3.3 relies on the spec's "20 runs on other tickets" to force a page break).
- Q2 (BR-9, TC-9.1, TC-9.2, TC-9.3): the command text commented on a ticket and how the Ignored list is reached are not stated here. Until answered, the cases say "comment a command" and "open the Ignored list" and assert only the stated "Ticket reached its run limit" text.
