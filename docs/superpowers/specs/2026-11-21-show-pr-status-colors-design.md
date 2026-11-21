<!-- dev-plan: kind=spec id=show-pr-status-colors rev=2 hash=7687d9a6df33 source=issue#202 -->
# Show PR status colors design

Status: draft. Sensitive paths: a new GitHub API call with the installation token in the board adapter, behind a new
authenticated read endpoint (the PR gets `review:sensitive`, security.md §8). No RLS, auth, webhook, terminal, secrets
change. The one index migration is on a sensitive path (see Data model).
Source: issue #202

## Summary

Every PR icon in the app looks the same today, whatever the PR's state at the ticket source. After this change, anyone
who can read a project's runs sees each PR icon in its live state colour (open green, draft gray, merged purple,
closed red) on the Runs page (list, group headers, Needs-you banner, Ignored rows already shown as PRs) and on Run
detail (top bar, side panel Ticket card, run chain, collapsed rail). The state is read live through a separate request
that never blocks the page; while it loads, or when it fails, the icon stays neutral. Issue icons look as they do today.

## Business rules

Confirmed by the human at planning time.

### Goal

Wherever a person sees a PR icon in the app, they can tell from its colour whether the PR is open, draft, merged or
closed, without opening the ticket source. Issue icons look as they do today.

Every place the app shows a PR icon (the ids below are used throughout this spec):

| Id  | Surface                                                     | Code (`apps/web/src/`)                                   | Gets a state                                                         |
| --- | ----------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------- |
| S1  | Runs page, run rows (grouped and flat, every filter)        | `components/RunRow.tsx:76`                               | yes                                                                  |
| S2  | Runs page, group header led by a PR                         | `components/RunRow.tsx:21` (`TicketGroupRow`)            | yes                                                                  |
| S3  | Runs page, Needs-you banner                                 | `components/NeedsYouBanner.tsx:26` (`runs.stats` `idleRun`) | yes; this run may not be on the current page                      |
| S4  | Runs page, Ignored view (`?filter=ignored`)                 | `components/IgnoredRow.tsx:12` (`screens/RunsProblems.tsx`) | yes, when the row is already a PR (only mock data today, see Edge cases); the PR may never have had a run |
| S5  | Run detail top bar                                          | `screens/RunDetail.tsx:187`                              | yes                                                                  |
| S6  | Run detail side panel, Ticket card                          | `components/TicketSummary.tsx:9` via `screens/RunSidePanel.tsx:110` | yes; same ref as S5                                       |
| S7  | Run detail side panel, run chain                            | `components/ChainTimeline.tsx:28`                        | yes; runs of the same ticket, so the same ref as S5                  |
| S8  | Run detail collapsed side rail                              | `screens/RunSidePanel.tsx:40` (raw `Icon`)               | yes; same ref as S5                                                  |
| S9  | Run detail side panel, "Pull request" section               | `screens/RunSidePanel.tsx:52` (`TicketSummary`)          | it uses the same `TicketSummary` as S6; no real data fills it today  |
| S10 | Sign-in page sample                                         | `screens/SignIn.tsx:67`                                  | no: a fixed illustration with no project and no real PR              |

The Needs-you page and the merged-group chain note show PR numbers as text only ("PR #148"), with no icon.

In scope is every PR icon in the app, surfaces S1 to S8 (human answer T1: "colour whole system"). The colours follow
GitHub's style: open green, draft gray, merged purple, closed red. Issue icons stay unchanged, and an unknown state
shows the neutral icon. The state is fetched live, never stored, and never blocks the page, with a short cache per
project and PR. An ADR covers the new adapter seam, and mock e2e covers each state.

### Actors

| Actor | May do |
| ----- | ------ |
| Anyone who can read the project's runs (today: signed in, a member of the org, the project visible; once RBAC lands: `run:read`, held by owner, admin, project admin, member and viewer, the same permission as `runs.list`) | Sees the colours. No new action or permission (T2; rbac-foundation spec route map). |
| Ticket source (outside party) | Answers the live PR state when asked. It pushes nothing for this feature. |

### Rules

Surface: UI (the colours are only seen on the Runs page (list, banner, Ignored view) and on Run detail; the new read
only feeds them). BR-10 is stated at the API because AGENTS.md rule 7 needs an authz check on every endpoint.

| Id    | Category            | Rule |
| ----- | ------------------- | ---- |
| BR-1  | conditional-display | When the Runs page lists runs on open, draft, merged and closed PRs, a member sees each row's PR icon → in that state's colour (open green, draft gray, merged purple, closed red), grouped or flat. Several rows of one PR show the same colour. |
| BR-2  | conditional-display | When "Grouped by ticket" is on and a group is headed by a PR, a member sees the header's PR icon → in the PR's state colour, the same as its rows. |
| BR-3  | conditional-display | When a member opens a run on a PR, they see the PR icon beside the ticket reference in the Run detail top bar → in the PR's state colour. |
| BR-4  | calculation         | When a PR is merged, a member sees → purple. When it is closed without merging → red, even if it was a draft. An open draft → gray. |
| BR-5  | negative            | When any colour-enabled place (BR-1 to BR-3, BR-14 to BR-16) shows an issue, open or closed, including a merged group led by an issue, a member sees → the issue icon exactly as today. |
| BR-6  | feedback-state      | While PR states are loading, a member sees the page (Runs list, banner, Ignored view or Run detail) → with neutral PR icons, and the colours appear later without a reload. |
| BR-7  | feedback-state      | When the ticket source fails or times out, or the project's connection cannot be used, a member sees → a working page with neutral PR icons, and no error banner or toast. |
| BR-8  | conditional-display | When the source answers for some PRs on the page but not others, a member sees → colours on those PRs and neutral icons on the rest. |
| BR-9  | conditional-display | When a PR icon shows a state colour, a member can read the state in words → "Open", "Draft", "Merged" or "Closed" as a hover title and an accessible name. A neutral icon has no state word. |
| BR-10 | permission          | When a signed-out caller asks for a project's PR states → 401. When the project is not visible to the caller, including another org's project → 404 and no state. Anyone who can open the project's runs list sees the colours. Once RBAC lands, a same-org user without `run:read` → 403. |
| BR-11 | persistence         | When a PR changes state at the source (for example, it is merged), a member who reloads after the short cache window sees → the new colour. |
| BR-12 | negative            | When a merged group's chain note lists its PRs, a member sees → plain text as today, with no state colour. |
| BR-13 | conditional-display | When the member changes page, filter or grouping, opens or pages through the Ignored view, or a new PR run or idle run appears live, they see → the newly shown PR icons get their state colours the same way. |
| BR-14 | conditional-display | When a run on a PR is waiting for input, a member sees the Needs-you banner's PR icon on the Runs page → in the PR's state colour, even when that run is not on the current page of the list. |
| BR-15 | conditional-display | When a member opens a run on a PR, they see the side panel's Ticket card, each step of the run chain, and the collapsed side rail icon → in the same state colour as the top bar. |
| BR-16 | conditional-display | When the Runs page's Ignored view lists a comment on a PR, a member sees that PR's icon → in its state colour, including a PR that never had a run. |

### Not observable

- No stored state (effect: BR-11). The only schema change is one index on `inbound_events` (see Data model); it is proven at the database layer, not e2e.
- The cache is per project and PR, 60 s. It is a timer, so it is proven below e2e (effect: BR-11).
- Request limits: positive digits, 1 to 100 refs, duplicates collapsed. The web splits more than 100 visible refs into
  requests of at most 100 (effect: BR-1, BR-14; contract and API tests, and a web unit test of the query helper for
  the split).
- Only PR refs the project knows (from its runs or its ignored comments), in its own repository, are looked up
  (effect: BR-10, BR-16).
- Values outside the four states count as unknown (effect: BR-8).
- PR numbers are sent as query variables, never as query text (AGENTS.md rule 6). No rule.
- S9 gets no real data today (no rule). S10 is a fixed picture (Agent call below; no rule).

### States

- PR state is read only. Agent Desk never changes it.
- No ticket, run, session or connection state machine changes.
- Display mapping, with precedence merged, then closed, then draft, then open:
  - merged → purple
  - closed (not merged, draft or not) → red
  - open draft → gray
  - open → green
  - unknown → neutral
- `prState` is provider-neutral, one of `open | draft | merged | closed`; absent means unknown. Only PR tickets get a
  state; issues never do, even closed ones.
- Agent call: one PR shows the same colour in every place it appears at the same time (business: they all read the
  same live answer).

### Limits and validation

- No new user input. The page asks for the PR numbers it shows.
- A request takes 1 to 100 positive-digit refs, with duplicates collapsed; anything else returns 400.
- Agent call (confirmed at gate AR): a page that shows more than 100 distinct PR refs splits them into requests of at
  most 100, so every icon gets its colour and the cap holds (business: for example 100 distinct PR rows plus a banner
  PR that is not on the page).
- The cache is 60 s per project and PR. The human gave 30 to 60 s; architecture picked 60 s.
- The lookup timeout is 5 s. The business rule is only that a timeout leaves the icon neutral.
- The source's answer is untrusted: only the four known values are accepted, and anything else counts as unknown
  (neutral). PR numbers are sent as query variables, never as query text (AGENTS.md rules 6 and 11). No ticket title
  or comment text is newly read or shown.
- `prState` uses `open | draft | merged | closed`, which are generic SCM concepts. The route is `tickets.prStates`.
  GitHub code lives only in `packages/core/src/adapters/github`, behind `BoardAdapter` (AGENTS.md rule 3, ADR 0005).

### Edge cases

- While the states load, the page shows with neutral PR icons and the colours fill in afterwards.
- If the ticket source is down, slower than the timeout, rate-limited, or the connection is unusable, the icons stay
  neutral. It is silent: no banner, toast or retry.
- A partial answer gives colours to the PRs that have a state and leaves the rest neutral.
- A PR the source cannot find (deleted, repository transferred) stays neutral.
- The same PR in several places is looked up once and shows the same colour everywhere.
- The banner's PR still gets its colour when it is not on the current page.
- A PR in the Ignored view still gets its colour when it never had a run.
- An Ignored row with no ticket shows no icon, as today.
- Real Ignored rows: the API sends `ticketKind: null` for every ignored row, so the real app shows them with the
  issue icon. They stay as they are (human answer). An Ignored row is coloured only when it is already a PR, which
  today happens only with mock data, so BR-16 is seen with mock data only.
- After a page, filter, grouping or view change, or a live new run or idle run, newly shown icons get their colours.
  Icons already coloured keep their colour.
- If a PR changes state while the page is open, the new colour shows on a reload after the cache window. There is no
  live push.
- A closed draft shows red.
- A page with only issues sends no request.

### Tenancy and permission

- The read is scoped to one project in the caller's org. Signed out gives 401. A project that is not visible,
  including another org's, gives 404, and the source is never asked. Once RBAC lands, the read needs `run:read` and
  403 applies (T2; AGENTS.md rules 4 and 7).
- Only PR refs the project knows are looked up, meaning refs from its runs or its ignored comments (confirmed at gate
  AR). They are looked up only in the project's own repository, through the project's own connection.
- The cache is per project and PR, so one project's answer never serves another.
- No writes.

### Lifecycle, compatibility and side effects

- Lifecycle: nothing is created, changed or deleted. There is no column and no stored state; the only schema change is one index on `inbound_events`. The only data is a short,
  size-bounded in-memory cache. No audit or retention change.
- Compatibility: every existing run, and every existing ignored PR comment, gets its colour at once, because the state
  is live; no back-fill is needed. Existing API responses are unchanged; the state comes from a separate read. A
  project whose source cannot answer keeps the neutral icon.
- Side effects a user sees: none. No comments, status changes, notifications or live events.
- Existing decisions:
  - `docs/superpowers/specs/2026-11-21-group-issue-pr-runs-design.md`: a merged group's header is led by the issue,
    so its icon stays the issue icon. The chain note is text. No conflict.
  - `docs/superpowers/specs/2026-11-20-rbac-foundation-design.md`: run reads need `run:read`. It is not in code yet,
    so the 403 case lands with RBAC (T2).
  - `docs/superpowers/specs/2026-11-12-frontend-design.md` §6: loader errors show banners. This read is not a loader,
    and the human decided failures stay neutral. No conflict.
  - `docs/conventions/frontend.md` §10 ("MUST NOT convey status by color alone"): a coloured icon names its state in
    words (BR-9).
  - ADR 0005: the new ADR 0033 covers the seam. ADR 0015 (SSE) is not used for PR state.

### Out of scope

None stated.

## Architecture

Confirmed by the human at planning time.

### Overview

Every PR icon shows the PR's live state, read from the ticket source when the page asks and never stored, through a
separate request that never blocks the page. Every route that shows a ticket icon is under `/o/$org/p/$project/`, so
every place is scoped to one project; no org-wide or cross-project screen shows a PR icon (`o.$org.index`,
`o.$org.projects.*` show none). Today `TicketDto`/`LinkedTicketDto` (`packages/contracts/src/schemas/runs.ts`) carry
no state, `TicketRef` (`apps/web/src/ds/TicketRef.tsx`) takes only `kind`/`number`, and `BoardAdapter`
(`packages/core/src/adapters/types.ts`) has no way to look up a state.

Layering stays `apps → core → db → contracts`, web → contracts only, and no app imports another app.

- `packages/contracts`: `PrState` enum (`enums.ts`), `PrStatesQuery`/`PrStatesResponse` schemas, route
  `tickets.prStates` in `routes.ts`. Additive only.
- `packages/core`: new method `BoardAdapter.prStates`; GitHub implementation (`adapters/github/board.ts`); fake
  implementation (`adapters/fake/board.ts`, `adapters/fake/store.ts` `StoredTicket.prState?`).
- `apps/api`: new `apps/api/src/tickets/` controller, service and injectable TTL cache, registered in
  `app.module.ts`. In one `withOrg` the service checks the project, keeps only refs the project has a PR run or an
  ignored event for, and finds the board connection. It then serves cache hits and fetches the misses through
  `registry.board(provider)`, outside the transaction, with a time limit. `apps/api/src/dev/fake.controller.ts`
  `DevTicketBody` accepts an optional `prState` (PRs only) for local e2e seeding.
- `apps/web`: a query helper in `features/runs/queries.ts` takes each place's PR refs, splits them into sorted chunks
  of 100 (`useQueries`, one request per chunk); `map.ts` merges the states by ref; `ds/TicketRef` gets an optional
  state prop with a local type (ds must not import contracts, like its existing local `TicketKind`). The rail's raw
  `Icon` (`screens/RunSidePanel.tsx:40`) gets the same treatment. MSW handler in `apps/web/src/mocks/msw/handlers.ts`.
- `apps/worker`, runner: untouched. `packages/db`: one additive index migration (see Data model).

PR icon surfaces and the refs each needs:

| Surface | File | Refs it needs | Max refs |
| ------- | ---- | ------------- | -------- |
| Runs rows (flat and grouped) | `components/RunRow.tsx:76` | PR tickets of the `runs.list` page | pageSize <= 100 |
| Group header (PR-led group) | `components/RunRow.tsx:21` | a subset of the page's row refs | 0 extra |
| Needs-you banner on Runs | `components/NeedsYouBanner.tsx:26` | `runs.stats.idleRun` ticket (may be off the page) | 1 |
| Ignored tab | `components/IgnoredRow.tsx:12` | PR refs of the ignored page | <= 100 |
| Run detail top bar | `screens/RunDetail.tsx:187` | the run's ticket | 1 |
| Run detail side panel ticket | `components/TicketSummary.tsx:9` | same ref | 0 extra |
| Run detail collapsed rail icon | `screens/RunSidePanel.tsx:40` (raw `Icon`, not `TicketRef`) | same ref | 0 extra |
| Run detail chain timeline | `components/ChainTimeline.tsx:28` | `ticketRuns` = runs of the same ticket | 0 extra |
| Needs you page | `screens/NeedsYou.tsx:48` | none: text labels only, no icon | - |
| Sign-in sample | `screens/SignIn.tsx:67` | none: static marketing sample, no real PR | - |

- Agent call: one route keyed by refs serves every place that shows a PR icon (architecture: all of them are
  project-scoped, and the server cache is per ref, so overlapping requests cost GitHub nothing extra).
- Agent call: the web query helper splits any ref list into sorted chunks of 100, one request per chunk
  (architecture: the Runs page can need 101 refs, 100 rows plus an off-page idle run in the banner; the server cap
  stays 100, which is at most 100 aliases in one GraphQL query).
- Ignored tab today: `RunsService.ignored` always returns `ticketKind: null`
  (`apps/api/src/runs/runs.service.ts:537`, "inbound_events does not store the ticket kind"), and `toIgnored` maps
  null to `issue` (`apps/web/src/features/runs/map.ts:304`), so the real app shows no PR icon there today; only mocks
  and stories do. Agent call: no kind resolution for the Ignored tab (architecture: working out the kind would change
  which icon is shown, not its colour, so it is new scope). Ignored rows whose kind is `pr` get the colour through the
  same route. The human confirmed this: real Ignored rows stay as they are, and only rows that are already a PR (mock
  data today) are coloured.
- Run detail: all four places show the run's own ticket, so one ref and one request.
- Agent call: the Needs you page and the sign-in sample are unchanged (architecture: no PR icon there / no real PR
  behind it).

### Data model

No stored state, no column, no backfill (human decision: live, not stored). The only schema change is migration
`0029_inbound_events_ticket_ref_ignored_idx`: a partial index `inbound_events_project_ticket_ref_ignored_idx` on
`(project_id, ticket_ref) WHERE starts_with(outcome, 'ignored_')`, which serves the ignored-event ref lookup (human
decision, database.md §4). It is a plain `CREATE INDEX` because the migrator runs every migration in one transaction
(`packages/db/src/migrate.ts`), so `CONCURRENTLY` cannot be used; the build briefly blocks writes to `inbound_events`
(intake) and the human accepted that. It is additive and safe while the previous app version runs. Reads run under
`withOrg`: `runs` (existing `runs_project_ticket_idx`) and `inbound_events` (the new index).

### API

| Method | Path | Who may call it | Request | Response | Contract |
| ------ | ---- | --------------- | ------- | -------- | -------- |
| GET | `/api/projects/:projectId/tickets/pr-states?ref=12&ref=15` | Session, org member, project visible in the org (else 404); the same check as `runs.list` (`RunsService.requireProject`, `apps/api/src/runs/runs.service.ts:208`). When RBAC lands, the same permission as `runs.list` (`run:read`; 403 for a same-org caller without it). | `PrStatesQuery`: `{ ref: string[] }`, 1 to 100 refs, each `^[1-9]\d{0,9}$` (the shape of `normalizeLinkedRefs`, `packages/core/src/adapters/linked-refs.ts`), deduplicated; one or several repeated `ref` keys, string or string[] normalised to an array | 200 `PrStatesResponse`: `{ items: { ref: string, prState: PrState }[] }`, possibly empty; a ref missing from `items` means unknown. 400 problem+json on bad refs or more than 100. 404 when the project is not visible. | `tickets.prStates` (`params: projectParams`) |

- `PrState = z.enum(['open', 'draft', 'merged', 'closed'])` in `packages/contracts/src/enums.ts`.
- The typed client sends arrays as repeated keys (`packages/contracts/src/client/api.ts:50-58`); Fastify gives a
  string when there is only one key, hence the normalisation.
- Ref filter. Agent call: only refs this project has a PR run for (`runs.project_id` + `ticket_kind = 'pr'` +
  `ticket_ref = any($refs)`) or an ignored inbound event for (`inbound_events.project_id` + `ticket_ref`, with no kind
  filter, because the kind is not stored; human answer), under `withOrg`, are looked up; other refs are left out of `items` (architecture: the installation token cannot be used to
  query arbitrary numbers; every visible PR ref passes because linked tickets always have runs, and an ignored PR with
  no run is not dropped). Issue refs that slip through come back null from the provider and are left out.
- Flow: validate → `withOrg` (project check, ref filter, board connection lookup `projects.board_connection_id` →
  `connections.provider/external_id`, as in `packages/core/src/intake/process-ticket-event.ts:258-273`) → serve cache
  hits → one adapter call for the misses, outside the transaction, bounded by the timeout → cache the states and the not-found refs the provider ruled on → 200.
- Agent call: a provider failure, timeout, rate limit or unregistered adapter returns 200 with those refs left out,
  not a 5xx, and failures are not cached, so the next request retries (architecture: the human said GitHub never
  blocks and the icon stays neutral).
- Agent call: `TicketDto`, `LinkedTicketDto`, `RunListItem` and `RunDto` stay unchanged (architecture: the list never
  fills a state, because the human chose a separate request, so the field would always be empty).
- Agent call: a new `tickets` route group, not `/runs/pr-states` (architecture: avoids the `runs/:number` route-order
  clash the controller already works around for `stats`, `apps/api/src/runs/runs.controller.ts:38`).
- Agent call: `{ items }` with no paging (architecture: ADR 0028 and backend.md §11 cover data lists; this is a
  bounded lookup capped at `PAGE_SIZE_MAX` = 100; the `{ items }` shape follows `RunLogResponse`).
- Agent call: GET, a read that is not audited and has no body (architecture: it only reads). No WebSocket, terminal,
  SSE or webhook change.

### Third-party libraries

| Library | New or existing | Used for | Approval |
| ------- | --------------- | -------- | -------- |
| zod | existing | contract schemas; parsing the GraphQL response and the partial data on a GraphQL error | existing |
| `@octokit/rest` | existing | its built-in `graphql`, already used for closing refs | existing |
| drizzle-orm | existing | the ref filter query | existing |
| TanStack Query | existing | `useQueries` for the chunks in web | existing |

No new dependency.

### Services and integrations

| Service | New or existing | How it is used |
| ------- | --------------- | -------------- |
| GitHub GraphQL API | existing | One query of up to 100 aliases per request that has cache misses, through the existing installation client and the existing App permission Pull requests: read (`docs/runbooks/connect-github-app-local.md:17`). |
| Postgres | existing | One read per request under `withOrg`. |
| Temporal, Kubernetes, SecretStore | existing | Untouched. |

### Other decisions

- Provider adapters: provider code lives only in `packages/core/src/adapters/github/`, with a fake counterpart in the
  same change, resolved through `AdapterRegistry` (AGENTS.md rule 3; ADR 0005).
  - Agent call: the method goes on `BoardAdapter`, not `CodeHostAdapter`:
    `prStates(project: AdapterProject, refs: string[]): Promise<PrStatesResult>` (architecture: PR tickets
    already come from the board seam, where `getTicket` returns kind `pr` and its closing refs, through the project's
    board connection).
  - GitHub: one GraphQL request per call through `clients.installation(externalId).graphql`, like
    `CLOSING_ISSUES_QUERY` (`adapters/github/board.ts`). The query text holds only generated aliases (`p0..pN`) and
    variable names (`$n0: Int!`); owner, repo and numbers go in variables only (AGENTS.md rule 6). Fields:
    `state isDraft merged`.
  - Agent call: state mapping is merged (`merged`/`MERGED`) > closed (`CLOSED`) > draft (`OPEN` + `isDraft`) > open
    (`OPEN`); the response is parsed with Zod, and a null node (not a PR, or not found) is left out (business,
    architecture: the requirement defines red as "Closed (not merged)").
  - Agent call: partial data on a GraphQL error is read by parsing the error's `data` with Zod, without importing
    `@octokit/graphql` (architecture: it is not a direct dependency).
  - Agent call: the fake's `StoredTicket.prState?: PrState` stores the provider-neutral value (no GitHub flags);
    `prStates` returns it for PR tickets that have one, and unset means left out of `states` and listed as `unresolved`; `DevTicketBody` accepts
    `prState` for PRs (architecture, testing T3: keeps existing local data and e2e unchanged and lets local e2e show
    the neutral fallback).
- Worker: no workflow or activity change; the lookup is request-time work, which belongs in api.
- Runner and Kubernetes: no Job spec or KubeGateway change.
- Secrets: no new secret. The installation token stays inside `GithubClients` and is never logged, returned or cached;
  the cache holds only `PrState` values and a not-found marker the adapter vouches for (`unresolved`). Logs carry error names only (precedent `AdapterLog`,
  `adapters/github/board.ts`).
- Events and live updates: no SSE, event or workflow change. "Live" means read from the provider when the page asks,
  through the cache. A state change shows on the next request after its cache entry expires. Reconnect behaviour is
  unchanged. The web query staleTime of 30 s (global default) works with the server TTL of 60 s: a refetch inside 60 s
  hits the cache.
- Config and environment. Agent call: no env var or flag; the cache/lookup service takes an injected `Clock`
  (`@agentdesk/core` `Clock`; production `systemClock`, as in `apps/api/src/adapters/adapter-registry.module.ts`) and
  options `{ ttlMs = 60_000, timeoutMs = 5_000, maxEntries = 10_000 }` through a Nest provider token, which tests set
  (for example `timeoutMs: 50`, like `ticketTimeoutMs` in the intake tests) (architecture, testing T3: tests stay
  deterministic).
  - Agent call: TTL 60 s (architecture: the top of the human's 30-60 s range, to spare the installation's GraphQL rate
    limit, which intake and polling also use).
  - Agent call: timeout 5 s (architecture: the same as `TICKET_TIMEOUT_MS`,
    `packages/core/src/intake/process-ticket-event.ts:49`).
- Failure: when GitHub is down, slow, rate-limited or not configured, the route returns 200 without those refs and the
  icon stays neutral. The Runs list and Run detail never wait on it (separate query). Failures are not cached.
- Logging: one `warn` per failed lookup with `projectId`, ref count and error name. No ticket text, no token.
- Scale. Agent call: the cache key is `projectId:ref`, read only after the project check, with at most 10,000 entries
  and the oldest evicted (architecture: project UUIDs are global, so there is no cross-tenant leak, and memory stays
  flat with many orgs). Each api replica has its own cache (the api is stateless). There is at most one GitHub request
  per project per TTL for the misses, at most 100 aliases each.
  The ignored-event lookup is run only for refs the runs did not match and uses the new partial index, so it does not
  scan all of a project's ignored events.
- Sensitive path: a new GitHub API call with the installation token in the board adapter, behind a new authenticated
  read endpoint, so the PR gets `review:sensitive` (security.md §8; precedent spec 2026-11-21-group-issue-pr-runs). No
  RLS, auth, webhook, terminal or secrets change. The one index migration is a sensitive path too (migrations).
- ADR: needed (human decision). New `docs/adr/0033-live-pr-state-through-the-board-adapter.md` plus a row in
  `docs/adr/README.md`. It covers: a live provider read at request time instead of a stored column; a separate
  non-blocking endpoint; the `BoardAdapter.prStates` seam method; the per-project/PR TTL cache in the API; failure
  means unknown.

## UI and Storybook

Screens and components this changes:

- No new route or screen. Changed, reached as today:
  - Runs (`/o/$org/p/$project/runs`, `app/routes/o.$org.p.$project.runs.index.tsx`), list view: run rows (grouped and
    flat), PR-led group headers and the Needs-you banner get colours (S1 to S3); entry: project sidebar → Runs.
  - Runs Ignored tab (`?filter=ignored`): rows that are already a PR get colours (S4); entry: the "Ignored" chip. Real
    Ignored rows arrive with `ticketKind: null`, show the issue icon and stay as they are, so only mock data shows a
    coloured Ignored row today.
  - Run detail (`/o/$org/p/$project/runs/$run`, `app/routes/o.$org.p.$project.runs.$run.tsx`): top bar, side panel
    Ticket card, run chain and collapsed rail get colours (S5 to S8); entry: a run row.
  - Unchanged: Needs you page, sign-in, Projects, Overview, Desk, Setup (no colourable PR icon; the Needs you page has
    text labels only, the sign-in sample is signed out with no real PR).
- `ds/TicketRef.tsx`: changed. New optional prop `prState?: PrState`, used only when `kind === 'pr'`; absent →
  today's neutral glyph. Only the glyph changes colour; the "PR #148" text stays `--text`.
- Agent call: new small ds primitive `TicketIcon` (`kind`, `prState?`, `size?`) in `ds/TicketRef.tsx`, exported from
  `@/ds`; `TicketRef` renders it, and the collapsed rail (S8) uses it instead of the raw `Icon` (ui-ux: one place maps
  state to colour and label; the rail has no `TicketRef` text).
- `PrState` type and `prStateTokens: Record<PrState, { label; colorVar }>` in `ds/tokens.ts`, exported from `@/ds`,
  like `TicketKind` (declared in ds) and `statusTokens`; ds never imports contracts. `features/runs/map.ts` maps the
  contracts `PrState` to it.
- Agent call: colour only; every state keeps the same pull-request glyph, with no separate merged, closed or draft
  glyphs (ui-ux: the human decision lists only token colours per state).
- Agent call: four semantic tokens in `ds/tokens.css` (group "pull request states"), mirroring the `--label-*`
  aliases: `--pr-open: var(--ok)`, `--pr-draft: var(--faint)`, `--pr-merged: #c8a2f0`, `--pr-closed: var(--fail)`,
  added to `Foundations/Colors` (`ds/Colors.stories.tsx`) and `ds/tokens.test.ts` (ui-ux: `#c8a2f0` already exists as
  `--label-e2e` and `--term-magenta`, so no new colour; draft uses `--faint`, not `--muted` (the neutral glyph), so
  draft stays a shade apart from unknown and is closest to GitHub's draft gray). A token is defined before use, and no
  raw colour appears outside `tokens.css` (frontend.md §5).
- Agent call (convention tension, flagged): the prop is a domain `prState` mapped to tokens in ds, not a `StatusTone`
  (ui-ux: frontend.md §5 asks for `StatusTone` on status props, but it has no purple and the human fixed purple for
  merged).
- Pass-through `prState`, no other change: `RunRow`, `TicketGroupRow` (`components/RunRow.tsx`), `NeedsYouBanner`,
  `IgnoredRow`, `TicketSummary`, `ChainTimeline` (`ChainStep.ticket.prState?`), `screens/RunDetail.tsx`,
  `screens/RunSidePanel.tsx` (the rail title gains the state, see Copy).
- Agent call: the side panel "Pull request" section (S9) needs no work of its own; it accepts the state through
  `TicketSummary`, but no real data fills it today, so only stories show it (business, ui-ux: it reuses the Ticket
  card, so once real data fills it, it shows the state the same way).
- View models (`apps/web/src/mocks/types.ts`): `Ticket.prState?: PrState` (used by `RunSummary.ticket`,
  `TicketGroup.ticket`, `RunDetailData` ticket and pullRequest), `IgnoredCommand.ticket.prState?`,
  `ChainStep.ticket.prState?`.
- Unchanged: the merged-group chain note, the Needs you screen and `SignIn`.
  - Agent call: the merged-group chain note stays plain text (business, ui-ux: it has no icon today and the request is
    about icons; the PR rows under it carry the colour).
  - Agent call: the sign-in sample stays neutral (business, ui-ux: it is a fixed picture, signed out, with no project
    and no real PR).
- States of the glyph (`TicketRef`, `TicketIcon`, every surface): neutral (unknown, loading, error, or an issue),
  open, draft, merged, closed.
  - Loading: neutral glyph, no skeleton or spinner.
  - Error, timeout, partial answer, ref left out: neutral and silent (BR-7, BR-8).
  - Empty: does not apply to the glyph. The Runs, Ignored and Run detail empty, loading and error states are unchanged
    (`RunsEmpty`, `RunsProblemsEmpty`, `RouteLoading`, `RouteError` boards).
  - Stale. Agent call: global Query defaults (staleTime 30 s, no focus refetch); a state changes on screen at the next
    fetch (page change, remount, visible-refs change, reload) (ui-ux: frontend.md §3 says override defaults only with
    a written reason, and BR-11 expects the new colour after a reload).
  - Reconnecting (SSE): colours already shown stay. Disabled and permission-denied do not apply (no control; whoever
    can read the runs sees the colours).
- Data on screen:
  - Route `tickets.prStates` (see Architecture); a ref missing from `items` means unknown.
  - The query helper in `features/runs/queries.ts` sorts the visible PR refs, splits them into groups of at most 100
    and sends one request per group with `useQueries` (human answer). Agent call: each group's `queryOptions` key is
    `['org', org, 'projects', projectId, 'tickets', 'pr-states', <sorted refs of the group>]`, read in the route
    components, never in a loader (ui-ux: the page must never wait on it; frontend.md §3 key rule).
  - Visible refs: list view = PR refs of the page's rows, PR-led headers and the banner's run (S1 to S3); Ignored view
    = refs of the page's ignored rows whose kind is `pr` (S4); Run detail = the run's ticket when it is a PR (S5 to S8,
    one ref).
  - Merge: pure, unit-tested mappers in `features/runs/map.ts` (for example `withPrStates` for groups, rows and
    banner; the ignored rows; the detail view model).
  - No mutation, no optimistic update, no SSE patch (there are no PR-state events).
- Forms and input, role-based UI, layout: not touched. The glyph keeps its size (14px; rail 16px) and gaps; nothing new
  is fixed or scrolling.
- Accessibility (frontend.md §10, BR-9): with `prState` set the glyph gets an accessible name (the state word via
  `Icon aria-label`), so a `TicketRef` reads "Merged PR #148" and the rail item reads "Merged PR #148"; unknown keeps
  the glyph `aria-hidden` as today. Keyboard path and focus order are unchanged (no new focusable element). All four
  tokens are well above 3:1 non-text contrast on `--bg`, `--panel`, `--row-group` and banner backgrounds, checked in
  built Storybook.
  - Agent call: hover tooltip with the same word via `title` on a non-focusable wrapper of the glyph (ui-ux: keyboard
    and screen-reader users get it from the accessible name).
- Stories (fed from `@/mocks`):
  - `ds/Chips.stories.tsx` (`Primitives/Chips`): a row of PR `TicketRef`s in open, draft, merged, closed and unknown
    (plain and linked), an issue with `prState` set (ignored), and `TicketIcon` at 14 and 16 px per state.
  - `components/RunRow.stories.tsx`: `PrStates` (flat rows, one per state plus unknown) and `GroupHeaderPrStates`
    (PR-led headers per state over their rows).
  - `components/NeedsYouBanner.stories.tsx`: `OnMergedPr` (banner on a PR run with a state).
  - `components/IgnoredRow.stories.tsx`: `OnPullRequestStates` (PR rows per state plus unknown).
  - `components/ChainTimeline.stories.tsx`: `OnPullRequest` (steps on a merged PR).
  - `components/SidePanel.stories.tsx`: `PullRequestStates` (Ticket card on a merged PR plus the Pull request section
    with a state) and `CollapsedOnPr` (rail with a coloured PR icon, label "Merged PR #148").
  - `screens/runs.stories.tsx`: `RunsPrStates`, `RunsProblemsPrStates`; `screens/runDetail.stories.tsx`:
    `RunPrMerged`, `RunPrMergedCollapsed`.
  - Agent call: existing screen stories stay unchanged; their fixtures carry no `prState`, so they show neutral icons
    (ui-ux: the new stories show the states, so parity does not drift).
  - `@/mocks`: view fixtures with `prState` per state in `mocks/runs.ts` plus the ignored and detail fixtures. DTO
    fixtures and the MSW handler and scenarios are listed under Testing.
- No prototype board is drawn (the prototype is skipped). The closest existing boards are `Runs.dc.html`,
  `RunsLinked.dc.html`, `RunsProblems.dc.html` and `RunIdle.dc.html` in `design/prototype/project/`.

User flows:

1. Runs list: open Runs → list, group headers and banner render at once with neutral PR glyphs → the PR-state requests
   for the visible PR refs (one per sorted group of at most 100) return → each PR glyph takes its colour; issue glyphs never change.
2. Ignored tab: open "Ignored" → rows render neutral → request for the refs of rows that are already a PR → coloured,
   or neutral when the API leaves a ref out. Real rows (kind null, issue icon) send nothing and stay as they are.
3. Run detail on a PR: the page renders neutral → request for the one PR ref → top bar, Ticket card, chain steps and
   collapsed rail all take the same colour. A run on an issue sends no request, and nothing changes.
4. Failure, timeout, partial answer or a ref left out: those glyphs stay neutral; no banner, toast or retry control.
5. Page change, filter chip, grouping toggle, tab switch, or SSE adding a row with a new PR → the visible refs change
   → a new request; refs already known keep their colour, new ones are neutral until loaded (BR-13).
   Agent call: `placeholderData: keepPreviousData` (TanStack Query, existing) and lookup by ref (ui-ux: known glyphs do
   not flash gray on a page change).
6. No PR ref visible → no request. Agent call: the query is disabled when the ref list is empty (ui-ux: nothing to
   ask for).

Copy:

- Agent call: state words "Open", "Draft", "Merged", "Closed", used as the coloured glyph's accessible name and hover
  tooltip; a `TicketRef` reads "Merged PR #148" (ui-ux: the existing fixture `Ticket.state: 'Open'` in
  `apps/web/src/mocks/runsLinked.ts` already uses "Open").
- Agent call: collapsed rail item title and aria-label "Merged PR #148" (state word plus the existing "PR #148");
  unknown keeps "PR #148" (ui-ux: same order as the `TicketRef` accessible name).
- No new visible text and no error text (failure is silent).

Prototype: skipped by the human at planning time.

**Blocker: Storybook first.** Before any task that implements this UI in `apps/web/src/{app,features}` or wires it to
data starts, the related Storybook stories are added or updated and reviewed: every changed or new `ds/`,
`components/` and `screens/` piece has a story for each state above (default, loading, empty, error, and the others
the spec names), fed from `@/mocks` fixtures. No UI implementation work begins until that is done.

## Testing

Confirmed by the human at planning time.

Every behaviour is pinned at the lowest layer that proves it, and every user-visible or cross-component rule has an
e2e spec or a stated reason. New e2e specs: `apps/web/e2e/mock/pr-state.spec.ts` and
`apps/web/e2e/local/pr-state.spec.ts`. In the table, paths starting `src/` or `e2e/` are under `apps/web/`.

| Rule | Behaviour | Layer | Where the test lives | E2E env |
| ---- | --------- | ----- | -------------------- | ------- |
| BR-1 | Row PR icon in its state colour, flat and grouped; two rows of one PR show the same colour. Mock: each state flat and grouped. Local: four fake PRs (one per state), one comment each, Runs page rows | component/story; unit; e2e | `src/ds/Chips.test.tsx`; `src/features/runs/map.test.ts`; `src/screens/runs.test.tsx`; `src/features/runs/runs.route.test.tsx`; `src/components/RunRow.stories.tsx`; `e2e/mock/pr-state.spec.ts`; `e2e/local/pr-state.spec.ts` | mock, local |
| BR-2 | PR-led group header colour equals its rows. Mock: header against its rows. Local: the BR-1 PRs with grouping on | component/story; unit; e2e | `src/screens/runs.test.tsx`; `src/features/runs/map.test.ts`; `src/components/RunRow.stories.tsx` (`GroupHeaderPrStates`); `e2e/mock/pr-state.spec.ts`; `e2e/local/pr-state.spec.ts` | mock, local |
| BR-3 | Run detail top bar colour. Mock: one run per state. Local: one fake PR run's detail (the same test checks the Ticket card) | component/story; e2e | `src/screens/runDetail.test.tsx`; `src/features/runs/detail.route.test.tsx`; `e2e/mock/pr-state.spec.ts`; `e2e/local/pr-state.spec.ts` | mock, local |
| BR-4 | Merged purple, closed red even if it was a draft, open draft gray; `it.each` over `state`, `isDraft`, `merged`. Mock: merged, closed and draft colours seen. Closed-draft precedence is not e2e (see below) | unit; component/story; e2e | `packages/core/test/adapters/github.test.ts`; `src/ds/Chips.test.tsx`; `e2e/mock/pr-state.spec.ts` | mock |
| BR-5 | Issue icons unchanged; an issue `TicketRef` ignores `prState`. Mock: issue row, issue-led header, issue run detail (card, rail), issue ignored row unchanged, and no request on an issue-only page. Local: an issue run beside PR runs keeps the issue icon | component/story; e2e | `src/ds/Chips.test.tsx`; `src/screens/runs.test.tsx`; `src/screens/runDetail.test.tsx`; `src/features/runs/runs.route.test.tsx`; `e2e/mock/pr-state.spec.ts`; `e2e/local/pr-state.spec.ts` | mock, local |
| BR-6 | Page first, colours fill in. Mock "slow" scenario (3 s) on Runs and Run detail: neutral first, colours without a reload | component/story; e2e | `src/features/runs/runs.route.test.tsx`; `src/features/runs/detail.route.test.tsx`; `e2e/mock/pr-state.spec.ts` | mock |
| BR-7 | Failure or timeout → neutral and silent. API with a throwing and a hanging adapter; mock "error" (500) and "pending" scenarios on Runs and Run detail: neutral, no banner or toast, the page works | integration; unit; component/story; e2e | `apps/api/test/tickets.int.test.ts`; `packages/core/test/adapters/github.test.ts`; `src/features/runs/runs.route.test.tsx`; `src/features/runs/detail.route.test.tsx`; `e2e/mock/pr-state.spec.ts` | mock |
| BR-8 | Partial answer colours what it has. Mock "partial" scenario. Local: a fake PR with no stored state stays neutral beside coloured ones | unit; component/story; e2e | `packages/core/test/adapters/github.test.ts`; `src/features/runs/map.test.ts`; `src/features/runs/runs.route.test.tsx`; `e2e/mock/pr-state.spec.ts`; `e2e/local/pr-state.spec.ts` | mock, local |
| BR-9 | State in words: every coloured icon on every surface has the state word as accessible name and hover title; a neutral icon has none; the rail's raw `Icon` carries colour and accessible name | component/story; e2e | `src/ds/Chips.test.tsx`; `src/screens/runDetail.test.tsx` (rail); `e2e/mock/pr-state.spec.ts` | mock |
| BR-10 | Signed out → 401; another org's project → 404 (never 403), adapter not called; on real Postgres with a session | integration | `apps/api/test/tickets.int.test.ts` | — |
| BR-11 | New state after the cache window, on reload: cache hit at 60 s − 1 ms, miss at 60 s + 1 ms with an injected `Clock`. Local: a fake PR re-added open → merged, `expect.poll` reloading until purple, timeout 90 s | unit; e2e | `apps/api/src/tickets/` (cache unit test); `e2e/local/pr-state.spec.ts` | local |
| BR-12 | Merged group chain note "PR #n" stays plain text, no icon, no colour | unit; e2e | `src/features/runs/map.test.ts`; `e2e/mock/pr-state.spec.ts` | mock |
| BR-13 | Paging, filter and a live new run get colours; known icons keep their colour. Mock: page 2 and a filter change. Local: Runs open, comment on a new fake PR, the live-added run is coloured | component/story; e2e | `src/features/runs/runs.route.test.tsx` (refs asked, previous data kept); `e2e/mock/pr-state.spec.ts`; `e2e/local/pr-state.spec.ts` | mock, local |
| BR-14 | Needs-you banner PR icon colour, including an idle run off the current page. Mock: idle run on a merged PR, also off the current page: purple and "Merged" | component/story; unit; e2e | `src/screens/runs.test.tsx`; `src/features/runs/map.test.ts`; `src/features/runs/runs.route.test.tsx` (off-page idle run); `src/components/NeedsYouBanner.stories.tsx`; `e2e/mock/pr-state.spec.ts` | mock |
| BR-15 | Side panel Ticket card, run chain steps and collapsed rail in the top bar's colour. Mock: merged PR run, card, chain steps and collapsed rail purple with "Merged". Local: the Ticket card in the BR-3 detail test. The "Pull request" section: component test and story only (see below) | component/story; unit; e2e | `src/screens/runDetail.test.tsx`; `src/features/runs/detail.map.test.ts`; `TicketSummary` and `ChainTimeline` stories; `e2e/mock/pr-state.spec.ts`; `e2e/local/pr-state.spec.ts` | mock, local |
| BR-16 | Ignored view PR icon colour for rows that are already a PR, including a PR with no run; the API looks up an ignored-only ref. Mock: ignored PR rows per state. No local e2e (see below) | component/story; integration; e2e | `src/screens/runs.test.tsx` (`RunsProblems`); `src/features/runs/runs.route.test.tsx` (Ignored filter); `apps/api/test/tickets.int.test.ts`; `e2e/mock/pr-state.spec.ts` | mock |
| — | GitHub derivation merged > closed > draft > open; one batched GraphQL call per cache-missing request with aliases `p0..pN`, mapped by number not order (answer order shuffled); null node, unknown value and schema mismatch left out; `unresolved` holds only refs GitHub ruled on (a NOT_FOUND error, or a complete answer), never refs dropped by another error in partial data; owner, repo and numbers only in variables; adapter side of failure, timeout and rate limit | unit | `packages/core/test/adapters/github.test.ts` (undici intercept, new fixture) | — |
| — | Fake `prStates` returns the stored state for PR tickets; unset is left out and listed as `unresolved` | unit | `packages/core/test/adapters/fake.test.ts` | — |
| — | Contracts `PrState`, `PrStatesQuery` (digits `^[1-9]\d{0,9}$`, 1 to 100, deduplicated, one key or repeated keys, string vs array), `PrStatesResponse`, route `tickets.prStates` | contract | contract tests in `packages/contracts/src/` | — |
| — | Cache `projectId:ref`, TTL 60 s, failures not cached, 10,000 entries with the oldest evicted at entry 10,001; project A's entry never served to project B | unit | `apps/api/src/tickets/` (cache unit test, injected `Clock`) | — |
| — | API side of failure, timeout (small injected timeout, never-resolving adapter promise), rate limit and unregistered adapter → 200 with those refs left out and one warn with the error name only; only the project's PR refs (its PR runs and its ignored PR events) reach the adapter; validation; `expectContract` on every response | integration | `apps/api/test/tickets.int.test.ts` (`wrapRegistry` counting, throwing and hanging adapter); a not-found ref is cached for the TTL, a ref the adapter left undecided is asked again | — |
| — | `/dev/fake/tickets` accepts `prState` | integration | `apps/api/test/webhooks.int.test.ts` | — |
| — | The ignored-event ref index exists, leads with `(project_id, ticket_ref)` and has the `ignored_` predicate | integration | `packages/db/test/migrate.int.test.ts` | — |
| — | `TicketRef` state → token variant, accessible name and hover title; absent → neutral, glyph `aria-hidden`; `prStateTokens` and the four `--pr-*` tokens | component/story; unit | `src/ds/Chips.test.tsx`; `src/ds/tokens.test.ts` | — |
| — | Mapper `withPrStates` sets `ticket.prState` on rows, headers, the banner run, ignored items, the detail ticket and the chain | unit | `src/features/runs/map.test.ts`; `src/features/runs/detail.map.test.ts` | — |
| — | The web asks only for PR refs on screen (rows, PR-led headers, the banner idle run even off-page, Ignored rows; Run detail: the run's PR), none → no request; previous states kept while visible refs change | component/story | `src/features/runs/runs.route.test.tsx`; `src/features/runs/detail.route.test.tsx` | — |
| — | The query helper sorts the refs and splits more than 100 into groups of at most 100, one request per group (for example 101 refs → two requests of 100 and 1) | unit | `src/features/runs/queries.test.ts` | — |
| — | Per-surface pass-through: S1 to S4 and S5 to S9 | component/story | `src/screens/runs.test.tsx`; `src/screens/runDetail.test.tsx` | — |
| — | DTO fixtures parse with the contracts schemas, including the state map with `PrStatesResponse` | unit | `src/mocks/msw/contract.test.ts` | — |
| — | Stories pass smoke and axe: `TicketRef` each state, unknown and an issue with a state; RunRow `PrStates` and PR-led header; NeedsYouBanner, IgnoredRow, TicketSummary and ChainTimeline each on a PR in a state; Run detail on a merged PR, panel open and rail collapsed | component/story | existing Storybook smoke and axe test | — |

Agent call: the e2e colour check compares the icon's computed `color` with the `--pr-*` token's computed value read
from `:root` at test time (neutral against `--muted`), plus the variant class (testing: CSS modules are non-scoped,
`apps/web/vite.config.ts:50`, and tokens are read at runtime).
Agent call: the banner, chain and rail are mock-only in e2e; local covers each distinct API path: Runs refs, the Run
detail ref, a live-added run and cache expiry (testing: they use the same request and mapper as the rows and top
bar). The Ignored view has no local e2e (human answer).

### Not provable by e2e

- BR-10 authz: no UI path asks for another org's project. Proved by the API int test on real Postgres with a session.
  The 403 without `run:read` is not in this change: once RBAC lands the route takes `runs.list`'s permission, covered
  by the RBAC route-map test.
- BR-4 closed-draft precedence: only the GitHub adapter derives it (the fake stores the neutral value). Agent call:
  proved by the adapter unit test only (testing: the fake stores the provider-neutral state, so e2e cannot make a
  closed draft).
- BR-7 source failure behind the API, at local: the fake board cannot fail or hang from e2e (the BR-15 precedent of
  group-issue-pr-runs). Proved by the API int test; the UI side is in the mock e2e.
- BR-11 exact cache window: a timer. Proved by the cache unit test with an injected `Clock`. Agent call: the local e2e
  still polls by reload for up to 90 s (testing: the only end-to-end proof that the state is live, not stored).
- BR-15 "Pull request" section: no real data feeds it. Proved by the component test and story.
- BR-16 at local: real Ignored rows arrive with `ticketKind: null` and stay issue icons, so the local stack cannot show
  a coloured Ignored row; the local e2e is dropped (human answer). Proved by the mock e2e, the component and route
  tests, and the API int test (an ignored-only ref is looked up).
- Agent call: the sign-in sample (S10) has no state test (testing: it is static and signed out, with nothing to look
  up).
- Real GitHub GraphQL: no network in tests. Proved by recorded, scrubbed payloads.

### Fakes and fixtures

- GitHub is never called in tests. Existing: undici intercept for GitHub GraphQL; `FakeStore` and fake adapters;
  `wrapRegistry`; MSW node and browser; `FakeEventSource`; `addFakeTicket`, `commentOn`, `/dev/fake/tickets`.
- New: `packages/core/test/fixtures/github/graphql.pr-states.json` (scrubbed; open, draft, merged, closed,
  closed-draft, null node, unknown value; plus an errors-with-partial-data variant).
- New: fake `StoredTicket.prState?`, fake `prStates`, `DevTicketBody.prState`, `addFakeTicket({ prState })` (T3).
- New: injected `Clock` and timeout for the tickets cache and lookup (T3).
- Default MSW handler for `tickets.prStates` in `src/mocks/msw/handlers.ts` (needed: unhandled requests fail tests).
- View fixtures with `Ticket.prState?` per state and surface (`mocks/types.ts`, `mocks/runs.ts`, `mocks/runDetail.tsx`,
  `mocks/runsLinked.ts`).
- DTO fixtures: seeded invoicer-api PR runs per state plus one with no state; an idle PR run for the banner; ignored
  events on PRs (one with no run); the state map parsed with `PrStatesResponse`.
- Scenario key `agentdesk.mock.prStates` (`slow | error | pending | partial`) read by `browser.ts`, and a `setPrStates`
  helper in `e2e/mock/mock.ts`, following the `AGENT_MODELS_SCENARIO_KEY` pattern.
- Run detail run-id constants in `mock.ts`; page-2 PR runs in `e2eLists.ts`.
- Local e2e: no seed; its own user, project and random ticket numbers per test.

### Security tests

- Signed out → 401; another org's project → 404 (never 403), adapter not called (API int).
- 403 without `run:read`: not in this change; with RBAC the route takes `runs.list`'s permission, covered by the RBAC
  route-map test.
- Bad refs (`0`, `-1`, `1.5`, `abc`, 11 digits, 101 refs, none) → 400 problem+json with pointers (contracts and API
  int).
- Refs that are not the project's PR refs (an issue ref, another project's PR, an unknown number) are left out and
  never reach the adapter (API int, counting adapter).
- The adapter gets only the project's own repoPath and board connection (API int).
- The GraphQL query text is identical for any input; numbers only in variables (adapter unit, rule 6).
- Project A's cache entry is never served to project B (cache unit).
- Failure logs carry only the error name, `projectId` and ref count; the response body has no provider text; the cache
  holds only `PrState` or the not-found marker (adapter unit and API int, rule 5).
- A source value outside the four is left out; every response passes `expectContract`.
- Webhook signature, terminal attach and run output redaction: not touched.

### Coverage risks

- No threshold, baseline, exclude or ignore-comment change.
- core 80/70: every branch of GitHub `prStates` and fake `prStates`, by unit tests. If `adapters/github/app.ts`
  changes, the `secrets-tokens` group (84/73) applies.
- api 70/60: the new `apps/api/src/tickets/` controller, service and cache (hit, miss, expiry, eviction, failure not
  cached, timeout) and the dev route field, by the API int and cache unit tests.
- contracts 80/70: the enum, string-vs-array normalisation, limits, response and route entry.
- web 60 lines: `TicketRef`, tokens, mapper, query factory, and the wiring in `RunRow`, `NeedsYouBanner`, `IgnoredRow`,
  `RunDetail`, `TicketSummary`, `ChainTimeline` and the `RunSidePanel` rail (mocks excluded, e2e not measured).
- Patch 80%: every path an e2e reaches is also reached by a lower-layer test.

### Test order and determinism

- Agent call: this is a feature, not a bug fix, but it is still written red first (testing: no state exists to render
  today). First failing tests: `src/ds/Chips.test.tsx` "TicketRef colours a merged PR icon with the merged token";
  `packages/core/test/adapters/github.test.ts` "maps a merged PR to merged".
- The batched answer order is shuffled in the adapter test and asserted by ref.
- Cache: injected `Clock`; 60 s − 1 ms hit, 60 s + 1 ms miss; eviction at entry 10,001.
- Timeout: a small injected timeout with a never-resolving adapter promise, or fake timers restored in `afterEach`.
- Route tests use `findBy*`/`waitFor` and assert the set of refs asked, not call counts a refetch could change.
- Mock e2e: "slow" holds 3 s (existing pattern); neutral is asserted right after render and the colour through
  `expect` auto-retry; colours come from tokens read at runtime.
- Local e2e: its own user, project and random numbers; states are set before the first load so the cache never holds a
  stale value, except BR-11 (bounded 90 s reload poll).
- Worker: not touched. Migrations: one additive index migration (`0029_inbound_events_ticket_ref_ignored_idx`), tested in `packages/db/test/migrate.int.test.ts`.

## Agent calls

- Agent call: S9, the side panel "Pull request" section, needs no work of its own; it accepts the state, but only
  stories show it (business, ui-ux: it reuses `TicketSummary`, so once real data fills it, it shows the state the same
  way; nothing feeds it today).
- Agent call: S10, the sign-in sample, stays neutral and has no state test (business, ui-ux, testing: it is a fixed
  picture, signed out, with no project and no real PR).
- Agent call: the merged-group chain note stays plain text (business, ui-ux: it has no icon today and the request is
  about icons).
- Agent call: precedence is merged, then closed, then draft, then open; GitHub maps `merged`/`MERGED` > `CLOSED` >
  `OPEN` + `isDraft` > `OPEN`, and a null node is left out (business, architecture: the requirement defines red as
  "Closed (not merged)").
- Agent call: one PR shows the same colour in every place it appears at the same time (business: they all read the
  same live answer).
- Agent call: failures stay silent, with no banner or toast (business: the human said only "stays neutral").
- Agent call: a partial answer colours what it can (business: each PR is independent).
- Agent call: newly shown icons (after a page, filter, view or live change) get their colours (business: "visible PR
  refs" means whatever is shown now).
- Agent call: no live push of state changes (business: none was asked for, and the human said "fetched when the page
  loads").
- Agent call: the web splits more than 100 visible refs into sorted chunks of at most 100, one request per chunk
  (business, architecture, confirmed at gate AR: the Runs page can need 101 refs, and the server cap stays 100, one
  GraphQL query).
- Agent call: ignored PR comments count as known refs, so Ignored-view PRs without runs get colours (business,
  architecture, confirmed at gate AR: T1 asks for every PR icon). The human later set the filter to any ignored event's
  `ticket_ref` the project knows, with no kind filter.
- Agent call: one route keyed by refs serves every place that shows a PR icon (architecture: all are project-scoped,
  and the cache is per ref, so overlapping requests cost GitHub nothing extra).
- Agent call: refs are looked up only if the project has a PR run or an ignored event for them (architecture: the
  installation token cannot be used to query arbitrary numbers, and an ignored PR with no run is not dropped).
- Agent call: no kind lookup for the Ignored tab; rows whose kind is `pr` get the colour through the same route
  (architecture: the API always sends `ticketKind: null` there, and working out the kind would change which icon is
  shown, which is new scope). The human confirmed it: real Ignored rows stay as they are, and the Ignored view has
  mock e2e only.
- Agent call: the method goes on `BoardAdapter` (architecture: PR tickets already come from the board seam and the
  board connection).
- Agent call: a new `tickets` route group (architecture: avoids the `runs/:number` route-order clash).
- Agent call: a GitHub failure, timeout, rate limit or missing adapter returns 200 with those refs left out, and
  failures are not cached (architecture: the human said GitHub never blocks and the icon stays neutral).
- Agent call: no env var or flag; TTL 60 s and timeout 5 s, both injectable with the `Clock` (architecture: 60 s is the
  top of the human's range and spares the shared GraphQL rate limit; 5 s matches `TICKET_TIMEOUT_MS`; injection keeps
  tests deterministic, testing T3).
- Agent call: the cache key is `projectId:ref`, read only after the project check, with at most 10,000 entries and the
  oldest evicted (architecture: no cross-tenant leak, and memory stays flat).
- Agent call: `{ items }` with no paging (architecture: a bounded lookup, not a data list, ADR 0028).
- Agent call: GET, not audited, no body (architecture: it only reads).
- Agent call: partial GraphQL data is parsed from the error's `data` with Zod, without importing `@octokit/graphql`
  (architecture: it is not a direct dependency).
- Agent call: the fake stores the provider-neutral `prState`, unset means unknown, and `DevTicketBody` accepts
  `prState` for PRs (architecture, testing T3: existing local data and e2e stay unchanged and local e2e can show the
  neutral fallback).
- Agent call: `TicketDto`, `LinkedTicketDto`, `RunListItem` and `RunDto` are unchanged (architecture: the list would
  never fill the field).
- Agent call: the Needs you page and the sign-in sample are unchanged (architecture, ui-ux: no PR icon / no real PR
  behind it).
- Agent call: colour only; every state keeps the same PR glyph (ui-ux: the human decision lists only colours).
- Agent call: tokens `--pr-open: var(--ok)`, `--pr-draft: var(--faint)`, `--pr-merged: #c8a2f0`,
  `--pr-closed: var(--fail)` (ui-ux: no new colour; draft uses `--faint` so it stays a shade apart from the neutral
  `--muted`).
- Agent call: the prop is a PR state, not a `StatusTone` (ui-ux: `StatusTone` has no purple and the human fixed purple
  for merged; convention tension flagged).
- Agent call: new `TicketIcon` primitive in ds (ui-ux: one place maps state to colour and label; the rail has no
  `TicketRef` text).
- Agent call: state words Open, Draft, Merged, Closed (ui-ux: the existing fixture already uses "Open").
- Agent call: rail label "Merged PR #148" (ui-ux: same order as the `TicketRef` accessible name).
- Agent call: tooltip via `title` on a non-focusable wrapper of the icon (ui-ux: keyboard and screen-reader users get
  the state from the accessible name).
- Agent call: the per-group queries (`useQueries`, one per sorted group of at most 100 refs) are read in the route
  components, never in a loader, with key `['org', org, 'projects', projectId, 'tickets', 'pr-states', <sorted refs
  of the group>]` (ui-ux: the page must never wait on it).
- Agent call: `keepPreviousData` and lookup by ref, and the query is off when no PR is visible (ui-ux: known colours do
  not flash gray on a page change; nothing to ask for otherwise).
- Agent call: global query defaults, 30 s stale and no focus refetch (ui-ux: no written reason to override them).
- Agent call: existing screen stories stay unchanged (ui-ux: new stories show the states, so parity does not drift).
- Agent call: a feature, not a bug fix, still red first, with the first failing tests named under Testing (testing: no
  state exists to render today).
- Agent call: the e2e colour check compares against `--pr-*` tokens read from `:root` at test time, plus the variant
  class (testing: tokens are read at runtime and CSS modules are non-scoped).
- Agent call: the banner, chain and rail are mock-only in e2e; local covers each distinct API path (testing: same
  request and mapper as the rows and top bar).
- Agent call: the BR-11 local e2e polls by reload for up to 90 s (testing: the only end-to-end proof the state is live,
  not stored).
- Agent call: closed-draft precedence is proved by unit test only (testing: the fake stores the neutral state).

## Open questions

None.
