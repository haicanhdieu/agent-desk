# Agent Desk Web App (Frontend, localhost) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `apps/web` from a Storybook-only screen library into the running SPA: router, data layer, auth, every PoC screen wired to the contracts API, live SSE and terminal, fully working on MSW (`pnpm dev:mock`) while the backend is built in parallel, then against the real localhost API after merge.

**Architecture:** Vite SPA with TanStack Router file routes under `/o/$org/...`; TanStack Query `queryOptions` factories over the typed contracts client; route components are the only containers and render the existing presentational screens through pure DTO → view-model mappers. MSW handlers typed by `@agentdesk/contracts` serve Vitest, Storybook and `dev:mock` from one in-memory store.

**Tech Stack:** React 19, TypeScript 6, Vite 8, TanStack Router (+ Vite plugin), TanStack Query, TanStack Form, Zod, better-auth React client (organization plugin), MSW 2, `@xterm/xterm` + `@xterm/addon-fit`, Vitest + Testing Library, Storybook 10, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-frontend-design.md` (contracts and API from `2026-11-12-control-plane-design.md` §7).

**Companion plan:** `docs/superpowers/plans/2026-11-12-backend-local.md`. Read its **Execution model** section first: this plan starts in worktree `../agent-desk-fe` on branch `feat/frontend`, forked from `main` **after** backend Tasks 1–2 (workspace + contracts) are committed there.

## Ownership rules while parallel

- This plan edits only `apps/web/**` and `packages/contracts/src/client/**`.
- Contract schemas (`packages/contracts/src/schemas/**`, `routes.ts`) are read-only here. When a screen needs data the contracts lack, derive it client-side if possible; otherwise log it in `apps/web/CONTRACT-GAPS.md` (route, field, why) and mock it in MSW only behind a clearly named TODO. Gaps are resolved in Task 16 after the backend merges.
- Do not add root-level scripts or dependencies; add dependencies to `apps/web/package.json` only.

## Global Constraints

- `ds/`, `components/`, `screens/` never import the router, Query, Form or `@agentdesk/contracts`; they stay renderable in Storybook with fixtures.
- A route component is the only container. `features/*` renders no markup beyond what a hook needs.
- Every Query key starts with `['org', orgSlug]` (except `['session']`).
- Query defaults: `staleTime` 30 s; retry twice only for status 0 and 5xx; `refetchOnWindowFocus` on for runs and connection queries only. Router `defaultPreload: 'intent'`, `pendingMs: 300`, `pendingMinMs: 300`.
- `StatusTone = 'ok' | 'warn' | 'err' | 'late' | 'idle' | 'off'`, exported from `ds`; renames only (`fail` → `err`, `muted` → `off`), colors unchanged.
- Toast: `role="status"` (errors `role="alert"`), auto-dismiss 5 s except errors, max three visible, dismiss button.
- Relative times re-render through `useNow()` ticking every 30 s.
- Terminal: resize debounce 100 ms; reconnect back-off 1 s, 2 s, 4 s, 8 s, 10 s then `RunReconnect`; close 4401 → sign-out path, 4403 → banner "You can't open this terminal" (no retry), 4409 → refetch run.
- Project event stream closes after the tab is hidden 60 s; reopens on visibility and refetches runs queries.
- Contract client parses responses with Zod in dev and test, skips parsing in production builds.
- URLs: `$org` = org slug, `$project` = project id, `$run` = per-project run number.
- Empty-state copy stays as is (copy pass is out of scope); no org switcher, no light theme, no structured transcript tab.
- Deferred: web Dockerfile, serving container, ingress, CI, QA env, real-cluster Playwright on the k3s `local` target.

## Review Focus

1. SSE reconnect replays a backlog overlapping already-applied events (same `seq`) → each event appears once in the run's event list.
2. Navigating to `/o/<slug>` for an org the user is not a member of → not-found state; `organization.setActive` is never called.
3. Several queries hit 401 at once (expired session) → exactly one sign-out and one redirect to `/sign-in?redirect=<current>`.
4. The run becomes final while the terminal is attached (server closes 4409) → run refetched, final scrollback shown read-only, no reconnect loop.
5. A rule form submit returns 409 with `errors: [{ pointer: '/command' }]` → the message shows on the command field and the form stays filled.

---

### Task 1: React 19 upgrade and tone vocabulary

**Files:**
- Modify: `apps/web/package.json` (`react`, `react-dom` ^19, `@types/react*` ^19), any component using `forwardRef` or `defaultProps`
- Modify: `apps/web/src/ds/tokens.ts` (add `export type StatusTone`), `ds/Banner.tsx` (`BannerTone = StatusTone`), `ds/InlineStatus.tsx`, `ds/index.ts`, `mocks/types.ts` (`ConnectionStatus.tone`, `AgentSettings.credential.status.tone`), `components/DeskLayout.tsx`, `components/SecretField.tsx`, every fixture and story using `'fail'`/`'muted'` as a status tone
- Test: `apps/web/src/ds/tone.test.tsx`

**Interfaces:**
- Produces: `StatusTone` from `@/ds`; `InlineStatus` CSS classes `.err`, `.off` (renamed from `.fail`, `.muted`, same declarations).

- [ ] **Step 1: Write the failing test** — `tone.test.tsx`: `render(<InlineStatus tone="err">x</InlineStatus>)` has class `err`; `render(<InlineStatus tone="off">x</InlineStatus>)` has class `off`; a `// @ts-expect-error` line with `tone="fail"`.
- [ ] **Step 2:** Run `pnpm --filter @agentdesk/web test src/ds/tone.test.tsx` → FAIL.
- [ ] **Step 3:** Upgrade React, apply renames (leave `Meter.tone`, `RunFacts.tone`, `LabelChip.tone`, `TermTone` untouched).
- [ ] **Step 4:** Run `pnpm --filter @agentdesk/web test && pnpm --filter @agentdesk/web typecheck && pnpm --filter @agentdesk/web parity` → PASS; parity drift no larger than `design/parity-notes.md`.
- [ ] **Step 5: Commit** — `feat(web): React 19 and StatusTone vocabulary`.

---

### Task 2: New primitives — Toast, Skeleton, LinkProvider, form `error` props

**Files:**
- Create: `apps/web/src/ds/{Toast.tsx,Toast.module.css,Toast.stories.tsx,Skeleton.tsx,Skeleton.module.css,Skeleton.stories.tsx,Link.tsx}`
- Modify: `ds/Button.tsx` and anchor-rendering composites (`ProjectRow`, `RunRow`, `SubNav`, `ProjectNav`, `Breadcrumb`, `TopBar`, `EmptyState`, `Banner` actions) to render links through `useLink()`; `ds/Field.tsx` (error slot); `components/{RuleForm,TriggerModeSetting,SecretField}.tsx` and setup field components (optional `error` props)
- Test: `apps/web/src/ds/primitives.test.tsx`

**Interfaces:**
- Produces:
  - `ToastProvider`, `useToast(): { show(t: { tone: StatusTone; title: string; detail?: string }): void }`.
  - `Skeleton({ variant: 'block' | 'text', lines?: number, width?, height? })`, `aria-hidden`, no animation under `prefers-reduced-motion`.
  - `LinkProvider({ component, children })`, `useLink(): LinkComponent` where `LinkComponent = ComponentType<AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }>`; default renders `<a>`.
  - `Field` prop `error?: string` → help slot shows it, input gets `aria-invalid="true"` and `aria-describedby`.
  - `RuleForm` `errors?: Partial<Record<'command'|'labels'|'target'|'skill', string>>`; `TriggerModeSetting` `error?: string`; `SecretField` `error?: string`.

- [ ] **Step 1: Write the failing tests**: toast `show` of 4 toasts → 3 visible; info toast gone after 5 s (fake timers), error toast stays and has `role="alert"`; `Skeleton` has `aria-hidden="true"`; a `Button href="/x"` inside `LinkProvider` with a test component renders that component; `RuleForm errors={{ command: 'Command already used' }}` → command input `aria-invalid` and the message is its description.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; add stories. **Step 4:** `pnpm --filter @agentdesk/web test` (includes stories smoke + axe) → PASS.
- [ ] **Step 5: Commit** — `feat(web): Toast, Skeleton, LinkProvider, form error props`.

---

### Task 3: Contracts client

**Files:**
- Create: `packages/contracts/src/client/{api.ts,error.ts,index.ts}`
- Test: `packages/contracts/src/client/api.test.ts`

**Interfaces:**
- Consumes: `routes`, `ProblemSchema` from `@agentdesk/contracts` (backend Task 2).
- Produces (export path `@agentdesk/contracts/client`):
  - `class ApiError extends Error { status: number; type: string; title: string; detail?: string; errors?: { pointer: string; detail: string }[]; requestId?: string }`.
  - `createApi(opts?: { baseUrl?: string; fetch?: typeof fetch; parse?: boolean; onUnauthorized?: () => void }): Api` where `Api` mirrors the `routes` tree: `api.<area>.<name>(input: { params?, query?, body? }) => Promise<z.infer<response>>`, typed from each route's schemas. `credentials: 'same-origin'`, JSON body, `Accept: application/json`; 204 → `null`.
  - `api` — default instance (`parse: import.meta.env?.MODE !== 'production'`).
  - `apiPath(routeKey, params): string` (used for EventSource and WebSocket URLs: `/api/runs/:id/events`, `/api/projects/:id/events`, `/api/runs/:id/terminal` — add these three as constants `sseRunPath(runId, after?)`, `sseProjectPath(projectId)`, `terminalPath(runId)`).

- [ ] **Step 1: Write the failing tests** (mock `fetch`): `api.runs.byNumber({ params: { projectId: 'p', number: 7 } })` calls `GET /api/projects/p/runs/7`; problem+json 409 → `ApiError` with `errors[0].pointer === '/command'` and `requestId` from `x-request-id`; network throw → `ApiError` status 0; 401 → `onUnauthorized` called and `ApiError` 401 thrown; response not matching schema with `parse: true` → throws, with `parse: false` → passes through; query params serialize (`filter=needs_you&limit=50`).
- [ ] **Step 2:** `pnpm --filter @agentdesk/contracts test` → FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(contracts): typed fetch client and ApiError`.

---

### Task 4: App shell, MSW, `dev:mock`

**Files:**
- Create: `apps/web/src/app/{router.tsx,queryClient.ts,providers.tsx,RouterLink.tsx,boundaries.tsx,useNow.ts}`, `apps/web/src/app/routes/__root.tsx`, `apps/web/src/app/routes/index.tsx`
- Create: `apps/web/src/mocks/dto/{projects,connections,agents,skills,rules,runs,events}.ts` (DTO fixtures matching the existing view fixtures), `apps/web/src/mocks/msw/{db.ts,handlers.ts,auth-handlers.ts,browser.ts,node.ts,scenarios.ts}`
- Modify: `apps/web/src/main.tsx`, `apps/web/vite.config.ts` (TanStack Router plugin: `routesDirectory: './src/app/routes'`, `generatedRouteTree: './src/app/routeTree.gen.ts'`), `apps/web/package.json` (scripts `dev:mock` = `vite --mode mock`, `test:e2e:mock`), `apps/web/src/test/setup.ts` (MSW node server lifecycle), `.storybook/preview.ts` (MSW loader, default `LinkProvider`)
- Test: `apps/web/src/app/shell.test.tsx`, `apps/web/src/mocks/msw/contract.test.ts`, `apps/web/src/test/renderRoute.tsx`

**Interfaces:**
- Produces:
  - `createAppRouter({ queryClient, history? })`, `createAppQueryClient()` (defaults from Global Constraints).
  - `RouterLink` = `createLink` over the `ds` link contract, provided via `LinkProvider` in `providers.tsx`.
  - `RootErrorBoundary` (full-page `EmptyState`, Reload, `requestId`), `NotFound`, `Forbidden`, `LoaderErrorBanner` (5xx/0, Retry = `router.invalidate()`), `toastFromError(e: unknown)`.
  - `useNow(): Date` (30 s tick, shared).
  - MSW: `mockDb` (in-memory, seeded from `mocks/dto`, `reset()`), `handlers` for every route in `routes` plus better-auth endpoints (`GET /auth/get-session`, `GET /auth/organization/list`, `POST /auth/organization/set-active`, `POST /auth/sign-in/social`, `POST /auth/sign-out`), each response built through the route's Zod schema; `scenarios.signedOut()`, `scenarios.serverError(routeKey)`, `scenarios.problem(routeKey, problem)` for tests.
  - `renderRoute(path: string, opts?: { scenario?: () => void }): Promise<{ router, queryClient, user }>` test helper (memory history, MSW node).

- [ ] **Step 1: Write the failing tests**
  - `contract.test.ts`: every DTO fixture parses with its contracts schema; every route key in `routes` has a handler (compare key lists).
  - `shell.test.tsx`: `renderRoute('/unknown')` shows `NotFound`; a loader throwing `ApiError` 500 shows the banner with Retry, Retry re-runs the loader; a render crash shows `RootErrorBoundary` with the `requestId`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; `main.tsx` starts the MSW worker when `import.meta.env.MODE === 'mock'` before rendering.
- [ ] **Step 4:** `pnpm --filter @agentdesk/web test` → PASS; `pnpm --filter @agentdesk/web dev:mock` renders the root without console errors.
- [ ] **Step 5: Commit** — `feat(web): router, query client, boundaries, MSW and dev:mock`.

---

### Task 5: Auth and org layout

**Files:**
- Create: `apps/web/src/features/auth/{client.ts,session.ts,signOut.ts}`, `apps/web/src/app/routes/{sign-in.tsx,o.$org.tsx,o.$org.index.tsx}`
- Modify: `apps/web/src/app/routes/__root.tsx` (`beforeLoad` guard), `routes/index.tsx` (redirect to active org), `screens/SignIn.tsx` (gain `onSignIn` callback alongside `signInHref`)
- Test: `apps/web/src/features/auth/auth.test.tsx`

**Interfaces:**
- Produces:
  - `authClient` = `createAuthClient({ baseURL: window.location.origin, basePath: '/auth', plugins: [organizationClient()] })`.
  - `sessionQuery = queryOptions({ queryKey: ['session'], queryFn })` returning `{ user: { id, name, handle, image }, activeOrganizationId } | null`; `orgsQuery` (`['session','orgs']`) returning `{ id, slug, name }[]`.
  - `signOutAndRedirect(redirect?: string)`: once-guarded (module flag reset on next successful session fetch), calls `authClient.signOut`, `queryClient.clear()`, navigates to `/sign-in?redirect=…`; wired as `onUnauthorized` of the default `api`.
  - Root `beforeLoad`: no session and path ≠ `/sign-in` → redirect `/sign-in?redirect=<current>`. `/` → `/o/<active slug>/projects`. `$org` `beforeLoad`: slug not in `orgsQuery` → `notFound()`; differs from active → `organization.setActive({ organizationId })` then `queryClient.removeQueries({ queryKey: ['org'] })`.
  - Sign-in: `authClient.signIn.social({ provider: 'github', callbackURL: redirect ?? '/' })`; search schema `{ redirect?: string }` (relative paths only, else dropped).

- [ ] **Step 1: Write the failing tests**: signed out at `/o/alice/projects` → lands on `/sign-in?redirect=%2Fo%2Falice%2Fprojects`; signed in at `/` → `/o/alice/projects`; **Review Focus 2:** `/o/stranger/projects` → not found and the `set-active` handler was not called; slug of a second org → `set-active` called once and old `['org','alice',…]` cache removed; **Review Focus 3:** two parallel queries returning 401 → one `sign-out` request and one navigation; `redirect=https://evil.example` → ignored.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(web): auth, root guard, org layout`.

---

### Task 6: Projects list

**Files:**
- Create: `apps/web/src/features/projects/{queries.ts,map.ts,map.test.ts}`, `apps/web/src/app/routes/o.$org.projects.index.tsx`
- Modify: `screens/Projects.tsx`, `screens/ProjectsEmpty.tsx` only if a callback prop is needed (hrefs become route paths via `RouterLink`)
- Test: `apps/web/src/features/projects/projects.route.test.tsx`

**Interfaces:**
- Produces:
  - `projectsQueries.list(org)`, `projectsQueries.detail(org, projectId)`, `projectsQueries.connection(org, projectId)`; keys per spec §4.2.
  - `pollIntervalLabel(seconds: 300|600|900|1800): PollInterval`.
  - `toConnectionStatus(dto: ProjectConnectionDto, project: { triggerMode, pollIntervalSeconds, createdAt }, now: Date): ConnectionStatus` — polling healthy → `ok` "Polling every 5 min"; `pausedReason 'token_revoked'` → `err` "Polling failed: token revoked"; `lastError` → `err` "Polling failed: <lastError>"; webhook with no event for ≥ 2 days (or none and project older than 2 days) → `warn` "No webhooks for 2 days"; webhook otherwise → `ok` "Connected".
  - `toProject(dto: ProjectDto, conn: ConnectionStatus, org: string, now: Date): Project` (`lastRun` relative, "—" when null).
  - Route: list → `Projects`, empty → `ProjectsEmpty`; connection queries fetched in parallel with `useSuspenseQueries`.

- [ ] **Step 1: Write the failing tests**: `pollIntervalLabel(900) === '15 min'`; `toConnectionStatus` table for the five cases above (fixed `now`); route with MSW seed of 2 projects renders both names and links `/o/alice/p/<id>/runs`; empty seed renders `ProjectsEmpty` whose create link is `/o/alice/projects/new/repo`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(web): projects list`.

---

### Task 7: Setup flow with per-step save and resume

**Files:**
- Create: `apps/web/src/features/setup/{steps.ts,mutations.ts,templates.ts,resume.ts,resume.test.ts}`, `apps/web/src/app/routes/o.$org.projects.new.$step.tsx`
- Modify: `screens/Setup1.tsx`…`Setup4.tsx`, `SetupReady.tsx` (controlled values + `onContinue` / `onBack` callbacks + `error` props, replacing internal-only state where it blocks saving)
- Test: `apps/web/src/features/setup/setup.route.test.tsx`

**Interfaces:**
- Consumes: `routes.connections.*`, `projects.create|update`, `agents.put|putCredential`, `skills.put`, `rules.create`.
- Produces:
  - `SETUP_STEPS = ['repo','agent','skills','rules','ready'] as const`; search schema `{ project?: string, connection?: string }`.
  - `resolveStep(requested: SetupStepParam, project: ProjectDto | null): SetupStepParam` — no project → `repo`; requested later than `project.setupStep` → `project.setupStep`; otherwise requested.
  - `SKILL_TEMPLATES` (moved from `mocks/skills.ts` template list, with bodies) used by step `skills`.
  - Step saves: `repo` → `projects.create` then navigate `agent?project=<id>`; `agent` → `agents.put` + `agents.putCredential` + `projects.update({ setupStep: 'skills' })`; `skills` → `skills.put` per chosen template + `update({ setupStep: 'rules' })`; `rules` → `rules.create` per rule + `update({ setupStep: 'ready' })`; `ready` reads the project. Connect button calls `connections.install` and assigns `window.location` to the returned URL.

- [ ] **Step 1: Write the failing tests**: `resolveStep('rules', { setupStep: 'agent' })` → `'agent'`; full flow on MSW: pick repo `dev/demo`, polling 10 min → project created with `pollIntervalSeconds: 600`; enter credential → agent step saved and URL is `/new/skills?project=…`; reload of `/new/rules?project=<id>` while server says `skills` → redirected to `/new/skills`; credential save 400 with pointer `/value` shows on the secret field.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(web): setup flow with resume`.

---

### Task 8: Project layout and Desk — skills

**Files:**
- Create: `apps/web/src/app/routes/{o.$org.p.$project.tsx,o.$org.p.$project.desk.skills.tsx}`, `apps/web/src/features/desk/{queries.ts,mutations.ts,map.ts,map.test.ts}`
- Modify: `screens/DeskFrame.tsx` (take `project`/`connection` props instead of importing fixtures), `screens/DeskSkills.tsx` (callbacks `onSelect`, `onCommit(body, message)`, `onDelete`)
- Test: `apps/web/src/features/desk/skills.route.test.tsx`

**Interfaces:**
- Produces:
  - `$project` layout: loads `projectsQueries.detail` and `connection`; renders children (the project-events hook is added in Task 13).
  - `deskQueries.skills(org, projectId)`, `deskQueries.skill(org, projectId, name)`, `deskQueries.rules`, `deskQueries.agent`; keys under `['org', org, 'projects', projectId, 'desk', …]`.
  - `toSkill(dto: SkillDto, rules: RuleDto[]): Skill` (`ruleSummary` from rules using the skill, `lastCommit` "message · relative").
  - Mutations `useCommitSkill`, `useDeleteSkill` — invalidate `desk.skills` and `desk.skill`; 409 (stale sha) → toast "Skill changed elsewhere — reload" and refetch.
  - Search `{ skill?: string }` selects the open skill (default first).

- [ ] **Step 1: Write the failing tests**: route lists MSW skills; `?skill=code-review` opens it; commit sends `{ body, message, sha }` and the list refetches; 409 → toast and refetch; delete dialog lists rules using the skill.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(web): project layout and desk skills`.

---

### Task 9: Desk — rules

**Files:**
- Create: `apps/web/src/app/routes/o.$org.p.$project.desk.rules.tsx`, `apps/web/src/features/desk/{rules.form.ts,problem.ts,problem.test.ts}`
- Modify: `screens/DeskRules.tsx` (callbacks `onToggle(id, enabled)`, `onEdit`, `onCreate`, `onDelete`; form slot)
- Test: `apps/web/src/features/desk/rules.route.test.tsx`

**Interfaces:**
- Produces:
  - `fieldErrorsFromProblem(e: unknown, map: Record<string, string>): { fields: Record<string, string>; form?: string }` — maps JSON Pointers (`/command` → `command`) via `map`; unmapped or non-`ApiError` → `form`.
  - `useRuleForm(initial?: RuleDto)` — TanStack Form validated with `CreateRuleRequest`; submit calls create/update `mutateAsync`; errors via `fieldErrorsFromProblem`.
  - `toRule(dto: RuleDto, agent: AgentDto): Rule` (`stats` "N runs in 30 days · last <relative>").
  - Toggle: optimistic update of `desk.rules` cache; rollback + error toast on failure.
  - Search `{ rule?: string }` (`new` or a rule id) opens the form.

- [ ] **Step 1: Write the failing tests**: `fieldErrorsFromProblem` for pointer `/command`, an unknown pointer, and a plain `Error`; **Review Focus 5:** create with a duplicate command → 409 → message under the command field, input values kept; toggle with `scenarios.serverError('rules.update')` → switch flips, then flips back and an error toast appears; edit saves and the list shows the new sentence.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(web): desk rules with TanStack Form`.

---

### Task 10: Desk — agent and project settings

**Files:**
- Create: `apps/web/src/app/routes/o.$org.p.$project.desk.agent.tsx`, `apps/web/src/features/desk/agent.form.ts`
- Modify: `screens/DeskAgent.tsx` (callbacks for limits save, trigger mode change, credential replace, delete project; `error` props)
- Test: `apps/web/src/features/desk/agent.route.test.tsx`

**Interfaces:**
- Produces:
  - `toAgentSettings(agent: AgentDto, project: ProjectDto): AgentSettings` (minutes from seconds; credential `setAt` relative, `setBy`).
  - Mutations: limits → `projects.update({ maxConcurrentRuns, maxRunsPerTicket })` + `agents.put({ timeoutSeconds })`; trigger mode → `projects.update({ triggerMode, pollIntervalSeconds })`; credential → `agents.putCredential` (never cached; invalidates `desk.agent`); delete → `projects.remove` then navigate to `/o/$org/projects` and invalidate `projects.list`.
  - Invalidations: `desk.agent`, `projects.detail`, `projects.connection`, `projects.list`.

- [ ] **Step 1: Write the failing tests**: timeout 60 min → 400 pointer `/timeoutSeconds` shown on the field; switching to polling 30 min sends `pollIntervalSeconds: 1800` and the connection status refetches; credential replace sends `{ type, value }`, the response value is not present in any Query cache entry (`JSON.stringify(queryClient.getQueryCache().getAll().map(q => q.state.data))` lacks it); delete navigates to projects.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(web): desk agent and settings`.

---

### Task 11: Runs list, problems, needs-you

**Files:**
- Create: `apps/web/src/features/runs/{queries.ts,map.ts,map.test.ts}`, `apps/web/src/app/routes/{o.$org.p.$project.runs.index.tsx,o.$org.p.$project.needs-you.tsx}`
- Modify: `screens/RunsPage.tsx`, `Runs.tsx`, `RunsProblems.tsx`, `NeedsYou.tsx` (data via props; filter chips as links with search params)
- Test: `apps/web/src/features/runs/runs.route.test.tsx`

**Interfaces:**
- Produces:
  - `runsQueries.list(org, projectId, filter)`, `runsQueries.detail(org, projectId, number)`, `runsQueries.events(org, projectId, number)` (keys per spec §4.2), `runsQueries.ignored(org, projectId)` (`['org', org, 'projects', projectId, 'ignored']`).
  - `toRunSummary(dto: RunDto, now: Date): RunSummary` (`id` = run number, `command` = `'/' + command`, `ticket.href` = `dto.ticket.url`, `startedAt` local `HH:mm`, `duration` "12m 04s" for final runs, `statusNote` for `queued` "Waiting for a slot").
  - `groupByTicket(runs: RunSummary[], maxRunsPerTicket: number): TicketGroup[]` (order by newest run).
  - `toIgnored(dto: IgnoredEventDto, repoUrl: string): IgnoredCommand` (reason text per outcome: `ignored_unauthorized` → "Not a collaborator", `ignored_no_rule` → "No rule for this command", `ignored_labels` → "Ticket labels don't match", `ignored_target` → "Rule doesn't apply to this ticket kind", `ignored_max_runs` → "Ticket reached its run limit", `ignored_active_run` → "Same skill already running", `ignored_rule_disabled` → "Rule is off", `ignored_no_command` → "Not a command").
  - Search schema `{ filter?: RunsFilter (default 'all'), ticket?: string }`; `filter=ignored` renders `RunsProblems`; connection warnings derived from `toConnectionStatus` tone `warn`/`err`.

- [ ] **Step 1: Write the failing tests**: `toRunSummary` duration for a 724 s run → `'12m 04s'`; `groupByTicket` groups two runs of ticket 12 with `runsUsed 2`, `runsMax 10`; route `?filter=needs_you` requests `filter=needs_you` and shows only idle runs; `?filter=bogus` falls back to `all`; `?filter=ignored` shows the ignored rows with reason text; needs-you page lists idle runs with links to `/runs/<number>`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(web): runs list, problems and needs-you`.

---

### Task 12: Run detail, cancel and finish

**Files:**
- Create: `apps/web/src/app/routes/o.$org.p.$project.runs.$run.tsx`, `apps/web/src/features/runs/{detail.map.ts,detail.map.test.ts,mutations.ts}`
- Modify: `screens/RunDetail.tsx`, `RunTerminalArea.tsx`, `RunSidePanel.tsx` (callbacks `onCancel`, `onFinish`, `onReconnect`; a `terminal` slot prop for Task 14)
- Test: `apps/web/src/features/runs/detail.route.test.tsx`

**Interfaces:**
- Produces:
  - `runDetailKey(status: RunStatus, terminalState?: 'reconnect'): RunDetailKey` (`queued`/`starting` → `RunStarting`, … final statuses → their keys).
  - `toRunDetail(run: RunDto, events: RunEventDto[], project: ProjectDto, ticketRuns: RunDto[], now: Date): RunDetailData` — `chain` from `ticketRuns` ordered by number; `lifecycle` from `lifecycle` events; `startup` checklist from lifecycle/status events (`queued` → slot, `starting` → pod, `session started` → agent); `idle` (since `idleSince`, ends at +10 min); `time` (elapsed / `timeoutSeconds`, percent); `endNote` per final status (failed shows `failureReason` and exit code).
  - `useCancelRun`, `useFinishRun`: optimistic `statusNote` "Cancelling…" / "Finishing…" on the detail and every cached list row (`setQueriesData` on prefix `['org', org, 'projects', projectId, 'runs']`); rollback + toast on error. Final status arrives via SSE (Task 13) or refetch.
  - Finished runs load `runs.log` once into `runsQueries.events`.

- [ ] **Step 1: Write the failing tests**: mapper for each of the 8 statuses yields the matching `RunDetailKey`; route renders `RunIdle` for an idle run with Finish enabled; Finish posts and shows "Finishing…"; cancel with `scenarios.problem('runs.cancel', { status: 409, title: 'Run already ended' })` → note removed and toast "Run already ended"; succeeded run shows the stored scrollback text from `runs.log`; `/runs/999` → not found.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(web): run detail with cancel and finish`.

---

### Task 13: Realtime — run events and project events

**Files:**
- Create: `apps/web/src/features/runs/{useRunEvents.ts,useProjectEvents.ts,applyEvents.ts,applyEvents.test.ts}`, `apps/web/src/test/fakeEventSource.ts`
- Modify: run detail route (mount `useRunEvents` while not final), `$project` layout (mount `useProjectEvents`)
- Test: `apps/web/src/features/runs/realtime.test.tsx`

**Interfaces:**
- Produces:
  - `applyRunEvent(list: RunEventDto[], e: RunEventDto): RunEventDto[]` — insert by `seq`, ignore duplicate `seq`.
  - `applyRunStatus(queryClient, org, projectId, e: RunStatusEvent)` — patches detail and every cached list row (`setQueriesData` by key prefix).
  - `useRunEvents(org, projectId, number, runId): ConnectionState` — `EventSource(sseRunPath(runId, lastSeq))`; `status`/`event` listeners; `CONNECTING` → `reconnecting`, `OPEN` → `live`, final status → `ended` and `close()`.
  - `useProjectEvents(org, projectId)` — `EventSource(sseProjectPath(projectId))`, `run` events patch lists and invalidate a cached-but-not-streaming detail; adjusts `projectsQueries.detail` `counts.needsYou`; closes after `document.hidden` for 60 s, reopens on `visibilitychange` and invalidates runs queries.
  - `FakeEventSource` (test double: `emit(type, data, id)`, `fail()`, `open()`, static `instances`).
  - MSW streaming handlers for both SSE paths driven by `scenarios.runScript(runId, steps)` (status `starting → running → idle`, lifecycle lines) for `dev:mock`.

- [ ] **Step 1: Write the failing tests**: **Review Focus 1:** emitting seq 3, 4, then (after `fail()`/`open()`) 3, 4, 5 → events list `[3,4,5]`; status `idle` updates the detail and the runs list row; indicator goes `live` → `reconnecting` → `live`; status `succeeded` → `ended` and the source is closed; project event for a run in a cached list updates its status; hidden 60 s (fake timers) → closed; visible → new instance and runs queries invalidated.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(web): live run and project events`.

---

### Task 14: Live terminal

**Files:**
- Create: `apps/web/src/components/{LiveTerminal.tsx,LiveTerminal.module.css,LiveTerminal.stories.tsx}`, `apps/web/src/features/runs/{useTerminal.ts,terminalTheme.ts}`, `apps/web/src/test/fakeWebSocket.ts`, `apps/web/src/mocks/msw/fakeTerminal.ts`
- Modify: run detail route (lazy `LiveTerminal` in the terminal slot; `RunReconnect` when retries are exhausted)
- Test: `apps/web/src/features/runs/useTerminal.test.tsx`, `apps/web/src/components/LiveTerminal.test.tsx`

**Interfaces:**
- Produces:
  - `LiveTerminal({ onData?, onResize?, initial?: string, readOnly?: boolean, ref })` exposing `write(data: Uint8Array | string)`; xterm with `@xterm/addon-fit`, theme from `ds/tokens`, `screenReaderMode: true`, `disableStdin` when `readOnly`. Default export for `React.lazy`.
  - `useTerminal(runId: string, enabled: boolean, term: RefObject<LiveTerminalHandle>): { state: 'connecting'|'open'|'retrying'|'gave_up'|'forbidden'; reconnect(): void }` — URL from `terminalPath(runId)` with `ws`/`wss` by page scheme; `binaryType = 'arraybuffer'`; input encoded UTF-8 binary; resize text frame after open and on `ResizeObserver` (100 ms debounce); close-code handling and back-off per Global Constraints.
  - `FakeWebSocket` test double; `fakeTerminal` for `dev:mock` (echoes input, prints a banner) installed by replacing `window.WebSocket` for `/api/runs/*/terminal` in mock mode.

- [ ] **Step 1: Write the failing tests**: bytes from the socket reach `term.write`; typing sends a binary frame; two resizes within 100 ms send one `{"type":"resize","cols","rows"}`; abnormal closes retry after 1, 2, 4, 8, 10 s then `gave_up` (fake timers); 4403 → `forbidden`, no retry; **Review Focus 4:** 4409 → the run detail query is invalidated, no retry, and once the refetched run is final the terminal renders read-only with the stored scrollback; 4401 → `signOutAndRedirect` called; `LiveTerminal` story renders under axe.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(web): live terminal over WebSocket`.

---

### Task 15: Dev proxy and mocked end-to-end

**Files:**
- Modify: `apps/web/vite.config.ts` (`server.proxy` for `/api`, `/auth`, `/webhooks`, `/dev` → `http://localhost:3000`, `ws: true` on `/api`; no proxy in `mock` mode)
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/mock/{setup.spec.ts,rules.spec.ts,run.spec.ts,trigger.spec.ts}`
- Modify: `apps/web/package.json` (`test:e2e:mock` = `vite build --mode mock && playwright test e2e/mock`, served by `vite preview --mode mock`)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the specs**: sign in (MSW signed-out → click GitHub → MSW signs in) → setup steps 1–4 → ready → runs list; rule create then edit; on a run detail, the scripted stream moves `starting → running → idle`, the terminal shows the fake banner, Finish → `succeeded`; trigger mode switch webhook → polling 5 min shows "Polling every 5 min".
- [ ] **Step 2:** Run `pnpm --filter @agentdesk/web test:e2e:mock` → PASS.
- [ ] **Step 3:** Run `pnpm --filter @agentdesk/web test && pnpm --filter @agentdesk/web typecheck && pnpm --filter @agentdesk/web lint && pnpm --filter @agentdesk/web build-storybook` → PASS.
- [ ] **Step 4: Commit** — `test(web): Vite proxy and Playwright mocked e2e`. Stop here until the backend branch is merged to `main`.

---

### Task 16: Post-merge — real localhost integration (on `feat/frontend` rebased on `main`)

**Files:**
- Create: `apps/web/e2e/local/run.spec.ts`
- Modify: whatever `apps/web/CONTRACT-GAPS.md` lists (now edit contracts if the backend agreed fields are missing; additive only), MSW handlers to match
- Delete: `apps/web/CONTRACT-GAPS.md` once empty

**Interfaces:**
- Consumes: the running backend from `pnpm dev` (`KUBE_MODE=fake`, `ENABLE_FAKE_PROVIDER=true`, `AUTH_DEV_LOGIN=true`), dev routes `/auth/dev-login`, `/dev/fake/comments`.

- [ ] **Step 1:** `git rebase main`, `pnpm install`, `pnpm test && pnpm typecheck` at the root → PASS (fix any contract drift; MSW contract test catches it).
- [ ] **Step 2: Write `e2e/local/run.spec.ts`**: `page.goto('/auth/dev-login?handle=e2e-<rand>&redirect=/')` → setup with the fake connection (`dev/demo`, webhook) → credential, `code-review` template, rule `code-review` → `request.post('/dev/fake/comments', { repoPath: 'dev/demo', ticketNumber: 1, body: '/code-review', deliver: 'webhook' })` → the run appears in the list without reload → open it → status reaches Idle → terminal shows the fake banner, typing `ok` + Enter echoes `ok` → Finish → status `Succeeded` and the final scrollback is shown read-only.
- [ ] **Step 3:** With `pnpm dev` running at the root, run `pnpm --filter @agentdesk/web exec playwright test e2e/local` → PASS. Also click through every route manually at `http://localhost:5173` and note any console error.
- [ ] **Step 4: Commit** — `test(web): real localhost end-to-end`, then merge `feat/frontend` into `main` and run `pnpm test && pnpm test:e2e:local` on `main` → PASS.
