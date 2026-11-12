# Agent Desk Web App (Frontend) — Design

Date: 2026-11-12 · Status: draft for review · Companions: `docs/Agent Desk — PRD (PoC).md`, `docs/Agent Desk — Architecture (PoC).md`, `docs/superpowers/specs/2026-11-12-control-plane-design.md` (backend)

## 1. Intent

Agent Desk has three stacks: frontend (this spec), backend (the control plane spec), and infra (separate spec). `web/` already holds a design system (`ds/`), composites (`components/`) and about 25 presentational screens (`screens/`), all driven by fixtures in `mocks/`, with Storybook and Vitest. It has no router, data layer or app shell.

This spec picks the app stack and wires every PoC screen to the control plane API. It does not redesign screens.

The same roadmap as the backend applies: multi-tenancy (orgs), SSO, RBAC and audit come later, so URLs and caches are org-scoped from the start even though there is no org UI yet.

Success for this spec: every PoC screen runs against the real API on a local kind cluster, run status updates live, the terminal attaches to a running agent, and each layer has automated tests, including a browser end-to-end path.

## 2. Decisions

| Topic | Choice | Alternatives weighed | Why |
|---|---|---|---|
| Rendering and routing | Vite SPA + TanStack Router (file routes) | Vite SPA + React Router v7 data mode; React Router v7 framework mode; TanStack Start; Next.js App Router | Nest owns auth, sessions and the API; every page is behind sign-in, so no SEO; static files on the same origin as `/api`; typed route and search params; `/o/$org` layout ready for tenancy |
| Server state | TanStack Query with `queryOptions` factories over a hand-written contracts client | orval codegen; ts-rest; Router loaders only; SWR; RTK Query | Zod in `packages/contracts` is the one source for Nest (nestjs-zod) and web; no codegen; loaders and components share options; SSE patches the cache |
| Forms | TanStack Form with contracts Zod schemas | React Hook Form + zodResolver; Conform; no library | The composites are already controlled (`value`/`onChange`); Standard Schema validation; problem+json errors map onto fields |
| React | Upgrade 18 → 19 | Stay on 18 | Supported by TanStack, Storybook 10 and Testing Library; cheaper before data wiring than after |
| Run events | Native `EventSource` | `@microsoft/fetch-event-source`; polling | Same-origin cookie, no headers needed; `Last-Event-ID` resume with `seq` as the id |
| Terminal | `@xterm/xterm` + `@xterm/addon-fit` over a WebSocket | ttyd/gotty embed; hterm | Chosen in the Architecture doc |
| Auth client | better-auth React client | Hand-written `/auth/*` calls | Matches the backend; session hook, social sign-in, organization plugin |
| Client-only state | None: typed search params, Query, component state | Zustand; Jotai; Redux | Nothing needs a global store; add Zustand only on a concrete need |
| URL scheme | `/o/$org/p/$project/...` | Flat `/runs`, `/desk`; subdomain per org | Deep links stay valid when orgs arrive; settles the open route-scheme item from the 2026-11-11 decisions log |
| API mocking | MSW, handlers typed by contracts | Storybook-only fixtures; a fake Nest | One handler set for Vitest, Storybook and `dev:mock` |
| End-to-end | Playwright | Cypress | Already a dev dependency (parity script) |
| Serving | Static container behind the same ingress as the API | Nest serves the files; CDN | Same origin: no CORS, first-party cookie; deploys separately from the API. Details in the infra spec |
| Errors and loading | Router `errorComponent` / `pendingComponent`, toasts for inline mutations | Ad hoc per screen | One consistent mapping from problem+json to UI |

## 3. Architecture

### 3.1 Layers

```
apps/web/src
  ds/          design system primitives (unchanged except section 9)
  components/  composites (unchanged except section 9)
  screens/     presentational screens: props and callbacks only
  mocks/       fixtures for stories; MSW handlers and scripted streams
  app/         router, providers, route files, link adapter, boundaries
  features/    per area: auth, projects, setup, desk, runs
    <area>/queries.ts    queryOptions and key factories
    <area>/mutations.ts  useMutation hooks
    <area>/map.ts        DTO → view-model mappers
    <area>/hooks.ts      area hooks (useRunEvents, useTerminal, …)
```

Rules:

- `ds/`, `components/` and `screens/` never import the router, Query, Form or `packages/contracts`. They stay renderable in Storybook with fixtures.
- A route component is the only container: it reads data through `features/*`, maps it, and renders one screen with props and callbacks. Where a screen only has an `href` for an action today, it gains a callback prop.
- `features/*` never renders markup beyond what a hook needs.

### 3.2 View-model mappers

The screen types in `mocks/types.ts` are display-ready (`PollInterval = '5 min'`, `duration`, `ticket.href`, `ConnectionStatus.text`). Contract DTOs are raw (seconds, ISO timestamps, `ticket_ref`, enums). Each `features/<area>/map.ts` converts DTOs to the screen types, applied through Query's `select`. Mappers are pure functions and are unit tested. Relative times ("3 min ago") are computed at render through a shared `useNow()` tick (every 30 s) so cached data does not go stale visually.

### 3.3 Links

`ds` gets a `LinkProvider` context. `Button href` and the anchor-rendering composites read a `Link` component from it; the default renders a plain `<a>`. `app/` provides a TanStack Router link made with `createLink`, so screens get client-side navigation and intent preloading without importing the router. External links (GitHub) keep plain anchors.

### 3.4 Routes

File-based routes with the TanStack Router Vite plugin:

| Path | Screen | Search params |
|---|---|---|
| `/sign-in` | SignIn | `redirect?` |
| `/o/$org` | redirect to `/o/$org/projects` | |
| `/o/$org/projects` | Projects, or ProjectsEmpty when none | |
| `/o/$org/projects/new/$step` | Setup1–Setup4, SetupReady; `$step` ∈ `repo`, `agent`, `skills`, `rules`, `ready` | `project?` (after step 1) |
| `/o/$org/p/$project/runs` | Runs, RunsProblems | `filter?` (Runs filter groups), `ticket?` |
| `/o/$org/p/$project/runs/$run` | RunDetail (all eight states) | |
| `/o/$org/p/$project/needs-you` | NeedsYou | |
| `/o/$org/p/$project/desk/skills` | DeskSkills | `skill?` |
| `/o/$org/p/$project/desk/rules` | DeskRules | `rule?` |
| `/o/$org/p/$project/desk/agent` | DeskAgent | |

`$org` is the organization slug. `$project` is the project id. `$run` is the per-project run number (`runs.number`, section 11). Search params are declared with Zod `validateSearch`; invalid values fall back to defaults.

Root `beforeLoad`: read the session; none → redirect to `/sign-in?redirect=<current>`. At `/`, a signed-in user goes to `/o/<active org slug>/projects`. The `$org` layout's `beforeLoad` resolves the slug among the user's organizations (unknown → not found) and calls better-auth `organization.setActive` when it differs from the session's active org, then clears org-scoped cache.

## 4. Data flow

### 4.1 Contracts client

`packages/contracts` exports `api`, a thin typed wrapper over `fetch` with one function per route (for example `api.runs.list(projectId, query)`):

- `credentials: 'same-origin'`, JSON bodies, `Accept: application/json`.
- In development and tests the response is parsed with the route's Zod schema; production skips the parse (backend contract tests guarantee the shape).
- A non-2xx response throws `ApiError { status, type, title, detail, errors?, requestId }`. `errors[]` entries are `{ pointer, detail }` (JSON Pointer into the request body). `requestId` comes from the `x-request-id` response header.
- Network failures throw `ApiError` with `status: 0`.

### 4.2 Queries

Each area exports key and option factories. Every key starts with `['org', orgSlug]`:

```
projectsQueries.list(org)                    ['org', org, 'projects']
projectsQueries.connection(org, projectId)   ['org', org, 'projects', projectId, 'connection']
deskQueries.skills / skill / rules / agent   ['org', org, 'projects', projectId, 'desk', ...]
runsQueries.list(org, projectId, filter)     ['org', org, 'projects', projectId, 'runs', 'list', filter]
runsQueries.detail(org, projectId, number)   ['org', org, 'projects', projectId, 'runs', number]
runsQueries.events(org, projectId, number)   ['org', org, 'projects', projectId, 'runs', number, 'events']
```

Route loaders call `queryClient.ensureQueryData`; components read the same options with `useSuspenseQuery`. Defaults: `staleTime` 30 s; retry twice for status 0 and 5xx only; `refetchOnWindowFocus` on for runs and connection queries, off elsewhere. Router `defaultPreload: 'intent'`.

### 4.3 Mutations

| Action | Strategy |
|---|---|
| Rule enable toggle | Optimistic on the rules cache; roll back and toast on error |
| Cancel run, finish run | Optimistic status note (`Cancelling…`, `Finishing…`); SSE confirms the final status; roll back and toast on error |
| Project create, rule create/edit/delete, agent limits, trigger mode, skill commit/delete, project delete | Invalidate the affected keys on success |
| Credential replace | Write-only; the response is `{ updatedAt }`; never cached; invalidates the agent query (which shows only "set" and the timestamp) |

Forms (TanStack Form) validate with the contracts request schema and call `mutateAsync`. On `ApiError` with `errors[]`, each `pointer` maps to a field error; anything else shows a form-level `Banner`. Submit buttons show pending state from the form.

### 4.4 Auth

`features/auth` wraps the better-auth React client (`baseURL` same origin, organization plugin). Sign-in calls the GitHub social sign-in with `callbackURL` set to the `redirect` param. The session is also stored in Query under `['session']` so loaders read it synchronously. Sign-out calls `queryClient.clear()` and navigates to `/sign-in`. Any 401 from `api` triggers that sign-out path once (a module-level flag, reset on the next successful sign-in) with the current location as `redirect`.

### 4.5 Setup flow

Each setup step is a route and saves on Continue: step `repo` creates the project (connection, repository, trigger mode), `agent` saves the agent and credential, `skills` commits the chosen templates, `rules` saves the rules, `ready` reads the project. Opening `/projects/new/$step?project=…` for a later step than the furthest finished one redirects to the furthest unfinished step, computed from the project's state on the server. There is no wizard state in memory or storage.

## 5. Realtime

### 5.1 Run events

`useRunEvents(org, projectId, number)` is mounted by the run detail route while the run is not final. It opens `EventSource('/api/runs/{runId}/events?after={lastSeq}')`:

- Events carry `id: <seq>` and an `event` type of `status` or `event`. The hook applies each with `setQueryData` to the run detail, the run's events list, and the matching row in every cached runs list (found by key prefix with `queryClient.setQueriesData`).
- On a dropped connection the browser reconnects and sends `Last-Event-ID`; the backend treats it as `after`. While `readyState` is `CONNECTING`, the screen's `ConnectionIndicator` shows `reconnecting`; when open, `live`.
- A final status sets the indicator to `ended` and closes the stream.

### 5.2 Project events

`useProjectEvents(org, projectId)` is mounted by the `$project` layout. It opens `EventSource('/api/projects/{id}/events')` (section 11) and receives `{ runId, number, status, seq }` for every run status change in the project. It patches runs lists and the needs-you count, and invalidates a run detail query that is cached but not streaming. When the tab has been hidden for 60 s the stream closes; on visibility it reopens and the runs queries refetch to catch up.

### 5.3 Terminal

`LiveTerminal` (new, in `components/`) hosts `@xterm/xterm` with `@xterm/addon-fit`, a theme built from `ds/tokens`, and `screenReaderMode` on. It is loaded with `React.lazy` so xterm only downloads on run detail. It renders inside the existing `TerminalPane`, `TerminalBar` and overlay slots.

`useTerminal(runId, enabled)` opens `new WebSocket('/api/runs/{runId}/terminal')` (scheme follows the page: `wss` on https) when the run is `running` or `idle`:

- Data: binary frames both ways. Keystrokes from xterm `onData` are encoded as UTF-8 and sent as binary.
- Resize: a text frame `{"type":"resize","cols":c,"rows":r}`, sent after open and on container resize (`ResizeObserver` → fit, debounced 100 ms).
- Close codes: 4401 → the 401 path in 4.4; 4403 → "You can't open this terminal" banner, no retry; 4409 → the run is no longer active, refetch the run. Any other close while the run is active → retry with back-off 1 s, 2 s, 4 s, 8 s, 10 s, then show the existing `RunReconnect` state with a manual Reconnect button.

A finished run's final scrollback renders in the same `LiveTerminal` with `disableStdin`, written once from the stored `run_events` entry. The static `Terminal` component stays for Storybook fixtures.

Finish and cancel are REST mutations (4.3); the terminal socket never carries control actions.

## 6. Errors, loading and empty states

| Case | UI |
|---|---|
| Unexpected render or loader crash | Root `errorComponent`: full-page `EmptyState`, Reload button, `requestId` when present |
| Loader `ApiError` 404 (including another org's record, which RLS hides) | Route not-found `EmptyState` with a link to projects |
| Loader `ApiError` 403 | "You don't have access" `EmptyState` |
| Loader `ApiError` 5xx or status 0 | `Banner` tone `err` with `title` and `detail`, Retry button (`router.invalidate()`) |
| 401 anywhere | Sign-out path with `redirect` (4.4) |
| Form mutation error | Field errors from `errors[]`; otherwise a form `Banner` |
| Inline mutation error | Roll back the optimistic change; `Toast` with the problem `title` |
| SSE dropped | Cached data stays; `ConnectionIndicator` `reconnecting` |
| Terminal dropped | Back-off, then `RunReconnect` (5.3) |

Pending: router `pendingComponent` with `pendingMs: 300` and `pendingMinMs: 300`; each area renders a skeleton built from the new `Skeleton` primitive and existing layout parts.

Empty states use the existing screens and components. Their copy was invented without boards (decision 8 in the 2026-11-11 log) and is kept as is; it is listed for a copy pass, not changed here.

## 7. Testing

| Layer | Tool | Covers |
|---|---|---|
| Unit | Vitest | Mappers (durations, intervals, connection tone and text, ticket hrefs), problem+json → field errors, search schemas, key factories |
| Hooks | Vitest, Testing Library, fake `EventSource` and `WebSocket` | `useRunEvents`: backlog, live cache patching of detail and lists, `Last-Event-ID` resume, close on final. `useProjectEvents`: list patching, hidden-tab close and refetch. `useTerminal`: bytes both ways, debounced resize, back-off then `RunReconnect`, 4403 not retried, 4409 refetch |
| Routes | Vitest, Testing Library, MSW (node), memory history | Each route renders its screen from handler data; auth redirect and return; org slug mismatch → `setActive`; 404, 403 and 5xx boundaries; form submit, field errors, invalidation; optimistic cancel rollback; setup resume |
| Contract | Vitest | MSW handlers are typed by contracts, and every fixture they return parses with its response schema |
| Components | Storybook 10, addon-a11y, existing stories smoke test and axe | `LiveTerminal`, `Toast`, `Skeleton`, form `error` props; all screen stories still render with the default `LinkProvider` |
| Visual parity | `pnpm parity` | After the React 19 upgrade and the tone rename; no drift beyond `design/parity-notes.md` |
| E2E, mocked | Playwright, `vite preview`, MSW in the browser | Sign in → setup steps 1–4 → runs list → run detail with a scripted live stream → finish; rule create and edit; trigger mode switch |
| E2E, real | Playwright against the backend's kind e2e (`pnpm test:e2e`) | A `fake`-provider comment → run appears live in the list → terminal attaches and receives bytes → Finish → status `succeeded` |

Scripts in `apps/web`: `dev`, `dev:mock`, `test`, `test:e2e:mock`, `typecheck`, `lint`, `storybook`, `build-storybook`, `parity`. CI wiring belongs to the infra spec.

## 8. Local development

- `pnpm dev`: Vite with `server.proxy` forwarding `/api`, `/auth` and `/webhooks` (with `ws: true`) to the local API, so the browser sees one origin as in production.
- `pnpm dev:mock`: MSW in the browser with the contracts-typed handlers and scripted run streams (SSE via MSW's stream support, terminal via a scripted fake socket), so frontend work needs no backend.
- Storybook keeps fixtures for components and screens; it does not run the router.

## 9. Design system changes

- **React 19**: drop `forwardRef` where `ref` as a prop replaces it; no visual change.
- **Tone vocabulary**: one exported type in `ds`, `StatusTone = 'ok' | 'warn' | 'err' | 'late' | 'idle' | 'off'`, used by every status-bearing prop. Each component keeps its current colors; only names change:

  | Where | Current | New |
  |---|---|---|
  | `Banner` (`BannerTone`) | `warn`, `err`, `late`, `ok`, `off`, `idle` | unchanged (becomes `StatusTone`) |
  | `InlineStatus.tone` | `ok`, `warn`, `fail`, `idle`, `muted` | `fail` → `err`, `muted` → `off` |
  | `ConnectionStatus.tone` (mocks/types) | `ok`, `warn`, `fail` | `fail` → `err` |
  | `DeskLayout` repo status, `SecretField` saved status | `ok`, `warn`, `fail` / `ok`, `fail` | `fail` → `err` |

  Not status tones, left as they are: `Meter.tone` (`run`, `late`: fill variants), `RunFacts.tone` (`muted`, `faint`: text emphasis), `LabelChip.tone`, terminal `TermTone`.
- **New primitives**: `Toast` (a region with `role="status"`, `role="alert"` for errors, auto-dismiss after 5 s except errors, dismiss button, max three visible), `Skeleton` (block and text-line variants, `aria-hidden`, reduced-motion aware), `LinkProvider`.
- **Form composites** (`RuleForm`, `TriggerModeSetting`, `SecretField`, the agent limits fields, setup step fields): an optional `error` (field-level) prop rendered through `Field`'s existing help slot with `aria-invalid` and `aria-describedby`.
- **New composite**: `LiveTerminal` (5.3).

## 10. Scope

In scope: everything in sections 3–9; the backend spec amendments in section 11.

Out of scope: the structured transcript view (MVP approach B; its tab stays "coming in MVP"); org switcher and invitations UI; light theme; mobile layouts beyond what exists; sign-in providers other than GitHub; i18n; the serving container, ingress, CDN and CI (infra spec); rewriting invented empty-state copy.

## 11. Backend spec amendments

Made in `docs/superpowers/specs/2026-11-12-control-plane-design.md` in the same commit as this spec:

1. **`runs.number`**: a per-project sequence, unique on (project_id, number), assigned on insert; run routes accept the number, and URLs use it.
2. **`GET /api/projects/{id}/events`**: SSE of run status changes in the project, fed by the same `LISTEN run_status` connection.
3. **Run events SSE**: each event's `id` is its `seq`; `Last-Event-ID` is treated as `after`.
4. **Terminal relay frames and close codes**: binary data both ways; resize as the text frame `{"type":"resize","cols","rows"}`; close codes 4401, 4403, 4409.
5. **Request id**: every response carries `x-request-id`; problem+json bodies use `errors[]` of `{ pointer, detail }` for validation failures.
6. **Organization slug**: the personal organization created on first sign-in gets a slug from the user's handle (suffix on collision); the web app routes by slug.

## 12. Build order

Frontend work starts after backend build step 1 (workspace, `web/` moved to `apps/web`, `packages/contracts`). Steps 1–7 run on MSW and proceed in parallel with the backend; step 8 needs the real API.

1. Foundation: React 19, tone rename, `Toast`, `Skeleton`, `LinkProvider`, form `error` props; Storybook and parity green.
2. App shell: router with file routes, QueryClient, boundaries, MSW, `dev:mock`, contracts `api` client and `ApiError`.
3. Auth and org: better-auth client, sign-in, root guard, `$org` layout with `setActive`, 401 handling.
4. Projects and setup: projects list and empty state; setup steps with save per step and resume.
5. Desk: skills (editor and commit), rules (TanStack Form with `RuleForm`), agent and settings (limits, trigger mode, credential, danger zone).
6. Runs: list, problems and needs-you with typed search; run detail in all eight states; cancel and finish.
7. Realtime: `useRunEvents`, `useProjectEvents`, `LiveTerminal` and `useTerminal`, reconnect states.
8. Real API: Vite proxy, `pnpm dev` against local Nest, contract fixes, Playwright mocked e2e, then the real kind path.

## 13. Open technical checks

- TanStack Router file routes with the Vite 8 plugin, and `createLink` wrapping the `ds` link contract.
- MSW SSE streaming in the browser for `dev:mock` and Playwright mocked e2e.
- `EventSource` reconnect sending `Last-Event-ID` through the Vite proxy and the production ingress (no buffering on SSE).
- xterm.js rendering of the Claude Code TUI under tmux at small widths, and `screenReaderMode` usefulness there.
- better-auth `organization.setActive` latency on org-slug navigation.
