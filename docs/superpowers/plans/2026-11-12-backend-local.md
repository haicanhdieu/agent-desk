# Agent Desk Control Plane (Backend, localhost) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the whole control plane (api, worker, db, contracts) so the full comment → run → idle → finish flow, SSE and the terminal work on localhost with `pnpm dev`, without a Kubernetes cluster or GitHub credentials.

**Architecture:** pnpm + Turborepo monorepo. `apps/api` (NestJS on Fastify) does sync work; `apps/worker` (Temporal TS worker in a Nest application context) does durable work. `packages/db` (Drizzle + RLS), `packages/contracts` (Zod), `packages/core` (router, provider adapters, KubeGateway, SecretStore) are shared. Locally, `KUBE_MODE=fake` runs each "Job" as a scripted child process with file-backed state, and the `fake` provider stands in for GitHub, so every flow is exercisable on one laptop.

**Tech Stack:** Node 22, TypeScript 6, pnpm, Turborepo, NestJS + `@nestjs/platform-fastify`, `nestjs-zod`, Zod, Drizzle ORM + drizzle-kit, `pg`, better-auth (+ organization plugin), Temporal TS SDK (`@temporalio/*`), `@kubernetes/client-node`, `@fastify/websocket`, pino, Vitest, Testcontainers, `@temporalio/testing`, docker compose.

**Spec:** `docs/superpowers/specs/2026-11-12-control-plane-design.md` (plus the backend amendments in `2026-11-12-frontend-design.md` §11 and `2026-11-12-infra-design.md` §13).

**Companion plan:** `docs/superpowers/plans/2026-11-12-frontend-local.md` runs in parallel in another worktree.

## Execution model (two agents, two worktrees)

1. **Bootstrap on `main` (this plan, Tasks 1–2).** First merge `spec/control-plane` into `main`. Then one agent runs Tasks 1–2 directly on `main` and commits. These tasks create the workspace and the full `packages/contracts` schema set, the interface both sides code against.
2. **Fork.** From that commit: `git worktree add ../agent-desk-be -b feat/backend` and `git worktree add ../agent-desk-fe -b feat/frontend`. The backend agent runs Tasks 3–19 in `agent-desk-be`; the frontend agent runs the frontend plan in `agent-desk-fe`.
3. **File ownership while parallel** (prevents merge conflicts):
   - Backend owns: `apps/api/**`, `apps/worker/**`, `packages/db/**`, `packages/core/**`, `packages/contracts/src/schemas/**`, `packages/contracts/src/routes.ts`, `docker-compose.yml`, root config files, `.env.example`, `scripts/**`.
   - Frontend owns: `apps/web/**`, `packages/contracts/src/client/**`.
   - Contract changes on the backend branch are **additive only** (new optional fields, new schemas, new routes). Renames or removals wait until after merge. The frontend records any contract gap it hits in `apps/web/CONTRACT-GAPS.md` instead of editing schemas.
4. **Merge.** Backend merges to `main` first (after Task 19), then frontend rebases on `main`, resolves `pnpm-lock.yaml` by re-running `pnpm install`, runs the frontend plan's post-merge task, and merges.

## Global Constraints

- Nothing in table, column, route, module or file names is provider-named (`github_*` forbidden); GitHub specifics live only in `packages/core/src/adapters/github/`.
- Every application table has `org_id uuid not null` (except `inbound_events.org_id`, nullable), `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy `org_id = current_setting('app.org_id')::uuid`.
- App connects as `agentdesk_app` (no `BYPASSRLS`, not owner); migrations as `agentdesk_owner`.
- Request and activity code get a DB handle only through `withOrg(orgId, fn)`; the two cross-tenant entry points are `resolve_project` and `queued_runs_without_workflow` (`SECURITY DEFINER`).
- Run status set: `queued`, `starting`, `running`, `idle`, `succeeded`, `failed`, `cancelled`, `timed_out`. Only the `setRunStatus` activity writes `runs.status` after insert.
- Command regex `^/([a-z0-9-]+)(\s+.*)?$` on the comment's first line; authorized when author is the bot or `authorAssociation` ∈ `OWNER`, `MEMBER`, `COLLABORATOR`.
- `timeout_seconds` ≤ 3300; `poll_interval_seconds` ∈ {300, 600, 900, 1800}; idle end 10 min; pod Pending limit 2 min; outbox sweep every 30 s for runs queued > 30 s; activity retry initial 1 s, max 1 min, 5 attempts; `followPodLogs` heartbeat 10 s, heartbeat timeout 60 s; gate `continueAsNew` after 1000 events; `resumed` signal at most once per 5 s; SSE heartbeat 15 s; WS ping 30 s; `activeDeadlineSeconds = timeout_seconds + 120`.
- Temporal ids: task queue `agentdesk`; workflow ids `run-{runId}`, `gate-{projectId}`; schedule ids `poll-{projectId}`, `outbox-sweep`, `reconcile-daily`.
- Kubernetes names: namespace `agentdesk-runs`; Job and Secret `run-{runId}`; labels `agentdesk/run-id`, `agentdesk/project-id`, `agentdesk/org-id`; credential Secret `org-{orgId}-agent-{agentId}`.
- Errors are RFC 9457 `application/problem+json`; validation errors carry `errors[]` of `{ pointer, detail }`; every response has `x-request-id`.
- Credential values and workspace tokens never reach Postgres, logs, API responses, `run_events` or `audit_log`.
- Dev-only surfaces (`/dev/*` routes, `/auth/dev-login`, the `fake` provider) are registered only when `NODE_ENV !== 'production'`; config validation fails at startup if `AUTH_DEV_LOGIN=true` or `ENABLE_FAKE_PROVIDER=true` with `NODE_ENV=production`.
- Tests that use Testcontainers need a Docker-compatible engine; Podman users export `DOCKER_HOST=unix://$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}')` and `TESTCONTAINERS_RYUK_DISABLED=true`.
- Deferred (not in this plan): Dockerfiles, Helm chart, k3s `local` target, cluster e2e (spec step 11), QA env, CI workflows, manual runs (P1).

## Spec gaps this plan fills (additive, flagged for spec update after merge)

1. `CodeHostAdapter.listRepos(connection)` and `GET /api/connections/{id}/repos` (Setup step `repo` needs a repository picker).
2. `GET /api/projects/{id}/agent` (DeskAgent needs to read settings; spec lists only `PUT`).
3. `GET /api/runs/{id}/log` returns stored `run_events` as JSON (finished runs show final scrollback without SSE).
4. `GET /api/projects/{id}/ignored` lists `inbound_events` with an `ignored_*` outcome (RunsProblems screen); `inbound_events` gains `ticket_ref`, `author`, `command`, `detail`.
5. `projects.setup_step` (`agent` | `skills` | `rules` | `ready`), forward-only via `PATCH`, for setup resume.
6. `runs` gains snapshot columns `command`, `ticket_number`, `ticket_title`, `ticket_url`, `ticket_labels jsonb`; `agents` gains `credential_type`, `credential_updated_at`, `credential_set_by`.
7. `user.handle` (better-auth additional field; GitHub `login`, or the dev-login handle).
8. Dev-only: `GET /auth/dev-login?handle=&redirect=`, `/dev/fake/*` routes, the `fake` provider with file-backed state.

## Review Focus

1. The same comment arriving by webhook and by poll (or a redelivered webhook) produces exactly one run and one start comment.
2. A cancel arriving while the run is `starting` (Job created, no log line yet) deletes the Job, ends `cancelled`, and posts the finish comment once.
3. A worker restart mid-run resumes `followPodLogs` without duplicate `run_events` rows and without a second `setRunStatus(running)` regression.
4. A comment whose command is on the second line, has uppercase letters, or comes from a `CONTRIBUTOR` produces no run and an `ignored_*` outcome visible in `/ignored`.
5. The agent credential value never appears in any API response, log line, `run_events` row or `audit_log` payload.

---

### Task 1: Workspace bootstrap (on `main`)

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.npmrc`, `.nvmrc` (`22`), `docker-compose.yml`, `.env.example`, `vitest.workspace.ts`
- Create: `packages/contracts/package.json`, `packages/db/package.json`, `packages/core/package.json`, `apps/api/package.json`, `apps/worker/package.json` (each with `src/index.ts` placeholder and `tsconfig.json` extending base)
- Move: `web/` → `apps/web/` (`git mv`); delete `apps/web/package-lock.json`; rename package to `@agentdesk/web`
- Modify: `.gitignore` (`web/` paths → `apps/web/`, add `.agentdesk/`, `.env`), `apps/web/scripts/parity.mjs` and `apps/web/README.md` (prototype path `../design` → `../../design`, `npm run` → `pnpm`)

**Interfaces:**
- Produces: package names `@agentdesk/contracts`, `@agentdesk/db`, `@agentdesk/core`, `@agentdesk/api`, `@agentdesk/worker`, `@agentdesk/web`; turbo tasks `build`, `dev`, `test`, `typecheck`, `lint`; root scripts `dev`, `test`, `typecheck`, `lint`, `db:migrate`; compose services `postgres` (host port 54329) and `temporal` (7233, UI 8233).

- [ ] **Step 1:** `git mv web apps/web`, remove the lockfile, set `"name": "@agentdesk/web"`, fix the paths listed above. Internal packages use `"exports": { ".": "./src/index.ts" }` (source-consumed, no build step for libraries).
- [ ] **Step 2:** Root `package.json`: `"packageManager": "pnpm@10"`, scripts `dev` = `docker compose up -d --wait && turbo run dev --filter=@agentdesk/api --filter=@agentdesk/worker --filter=@agentdesk/web`, `test` = `turbo run test`, `typecheck`, `lint`, `db:migrate` = `pnpm --filter @agentdesk/api migrate`.
- [ ] **Step 3:** `docker-compose.yml`: `postgres:18` with `POSTGRES_PASSWORD=postgres`, port `54329:5432`, healthcheck `pg_isready`, named volume; `temporalio/temporal` running `server start-dev --ip 0.0.0.0 --ui-port 8233 --namespace agentdesk --db-filename /data/temporal.db`, ports 7233/8233, healthcheck. `.env.example` lists every variable of Task 5's config schema with localhost defaults (`KUBE_MODE=fake`, `ENABLE_FAKE_PROVIDER=true`, `AUTH_DEV_LOGIN=true`, `PUBLIC_ORIGIN=http://localhost:5173`, `TEMPORAL_NAMESPACE=agentdesk`, `FAKE_STATE_DIR=.agentdesk/fake`).
- [ ] **Step 4: Verify the moved web app is untouched**

Run: `pnpm install && pnpm --filter @agentdesk/web test && pnpm --filter @agentdesk/web typecheck && pnpm typecheck`
Expected: all existing web tests PASS; typecheck clean in every package.

- [ ] **Step 5: Verify compose**

Run: `docker compose up -d --wait && docker compose ps`
Expected: `postgres` and `temporal` healthy; `http://localhost:8233` serves the Temporal UI.

- [ ] **Step 6: Commit** — `git commit -m "chore: pnpm/turbo workspace, move web to apps/web, local compose"`

---

### Task 2: Contracts — shared schemas and route table (on `main`)

**Files:**
- Create: `packages/contracts/src/{index.ts,enums.ts,problem.ts,routes.ts}`
- Create: `packages/contracts/src/schemas/{connections,projects,agents,skills,rules,runs,events}.ts`
- Create: `packages/contracts/package.json` exports `"."` (schemas, enums, routes) and `"./client"` (`./src/client/index.ts`, created by the frontend plan; add a placeholder `export {}`)
- Test: `packages/contracts/src/routes.test.ts`

**Interfaces:**
- Produces (exact names, camelCase JSON, ISO 8601 strings for timestamps, ids are uuid strings):
  - `enums.ts`: `RunStatus` (8 values), `FINAL_RUN_STATUSES`, `ACTIVE_RUN_STATUSES` (`starting`,`running`,`idle`), `TriggerMode` (`webhook`,`polling`), `POLL_INTERVALS = [300,600,900,1800]`, `Provider` (`github`,`fake`), `TicketKind` (`issue`,`pr`), `RuleTarget` (`issue`,`pr`,`any`), `TriggerSource` (`webhook`,`polling`,`manual`), `SetupStep` (`agent`,`skills`,`rules`,`ready`), `RunListFilter` (`needs_you`,`active`,`queued`,`ended`,`all`), `CredentialType` (`oauth_token`,`api_key`).
  - `problem.ts`: `ProblemSchema { type, title, status, detail?, instance?, requestId?, errors?: { pointer, detail }[] }`.
  - `connections.ts`: `ConnectionDto { id, provider, capabilities: { code, board }, accountName, status: 'active'|'suspended'|'revoked', createdAt }`; `InstallResponse { url }`; `RepoDto { repoPath, private, defaultBranch }`.
  - `projects.ts`: `ProjectDto { id, name, repoPath, codeConnectionId, boardConnectionId, triggerMode, pollIntervalSeconds, maxConcurrentRuns, maxRunsPerTicket, setupStep, createdAt, counts: { needsYou, running, queued }, lastRunAt: string|null }`; `CreateProjectRequest { name?, connectionId, repoPath, triggerMode, pollIntervalSeconds? }`; `UpdateProjectRequest` (partial: `name, triggerMode, pollIntervalSeconds, maxConcurrentRuns (1..10), maxRunsPerTicket (1..50), setupStep`); `ProjectConnectionDto { mode, webhook: { lastEventAt, lastEventAction }|null, polling: { intervalSeconds, lastCheckedAt, lastError, pausedReason, nextPollAt }|null }`; `IgnoredEventDto { id, receivedAt, ticketRef, ticketKind, command, author, outcome, detail }`.
  - `agents.ts`: `AgentDto { id, projectId, name, provider: 'claude', model, maxTurns, timeoutSeconds, credential: { set: boolean, type: CredentialType|null, updatedAt: string|null, setBy: string|null } }`; `PutAgentRequest { model, maxTurns?, timeoutSeconds (60..3300) }`; `PutCredentialRequest { type, value (min 1) }`; `PutCredentialResponse { updatedAt }`.
  - `skills.ts`: `SkillSummaryDto { name, description, path, lastCommit: { sha, message, at }|null }`; `SkillDto = SkillSummaryDto & { body, sha }`; `PutSkillRequest { body, message, sha? }`; `PutSkillResponse { commitSha }`; skill name regex `^[a-z0-9-]+$`.
  - `rules.ts`: `RuleDto { id, projectId, command, labelFilter: string[], target, agentId, skillName, enabled, stats: { runs30d, lastRunAt } }`; `CreateRuleRequest { command (^[a-z0-9-]+$), labelFilter, target, skillName, enabled }`; `UpdateRuleRequest` partial.
  - `runs.ts`: `TicketDto { ref, kind, number, title, url, labels: { name, color }[] }`; `RunDto { id, number, projectId, ruleId, command, skillName, agent: { name, model }, ticket: TicketDto, args, status, triggerSource, triggeredBy, queuedAt, startedAt, finishedAt, exitCode, failureReason, costUsd, timeoutSeconds, idleSince: string|null }`; `RunListQuery { filter?: RunListFilter, ticket?: string, cursor?: string, limit?: 1..100 (default 50) }`; `RunListResponse { items: RunDto[], nextCursor: string|null }`; `RunEventDto { seq, ts, type: 'lifecycle'|'status'|'scrollback'|'comment', payload: Record<string, unknown> }`; `RunLogResponse { items: RunEventDto[] }`.
  - `events.ts` (SSE payloads): `RunStatusEvent { runId, number, status, seq, exitCode, failureReason }` (SSE `event: status`), `RunEventMessage = RunEventDto` (SSE `event: event`), `ProjectRunEvent { runId, number, status, seq }` (SSE `event: run`).
  - `routes.ts`: `export const routes = { … } as const`, one entry per route of spec §7.2 plus the gap routes, each `{ method, path, params?, query?, body?, response }`, with keys: `connections.list|install|repos`, `projects.list|create|get|update|remove|connection|ignored`, `agents.get|put|putCredential`, `skills.list|get|put|remove`, `rules.list|create|update|remove`, `runs.list|byNumber|get|log|cancel|finish`. Paths use `:param` syntax, e.g. `/api/projects/:projectId/runs/:number`. Empty-body responses use `z.null()` (204).

- [ ] **Step 1: Write the failing test** — `routes.test.ts`:

```ts
it('every route has method, /api path and a response schema', () => {
  for (const [key, r] of Object.entries(flattenRoutes(routes))) {
    expect(['GET','POST','PUT','PATCH','DELETE']).toContain(r.method);
    expect(r.path.startsWith('/api/')).toBe(true);
    expect(r.response).toBeDefined();
  }
});
it('rejects timeoutSeconds above 3300', () => {
  expect(PutAgentRequest.safeParse({ model: 'sonnet', timeoutSeconds: 3301 }).success).toBe(false);
});
it('accepts only allowed poll intervals', () => {
  expect(UpdateProjectRequest.safeParse({ pollIntervalSeconds: 120 }).success).toBe(false);
  expect(UpdateProjectRequest.safeParse({ pollIntervalSeconds: 600 }).success).toBe(true);
});
it('rule command must be lowercase slug without slash', () => {
  expect(CreateRuleRequest.safeParse({ ...validRule, command: '/Review' }).success).toBe(false);
});
```

- [ ] **Step 2:** Run `pnpm --filter @agentdesk/contracts test` → FAIL (module not found).
- [ ] **Step 3:** Implement the schemas and `routes` as listed; export `flattenRoutes(routes): Record<string, RouteDef>` from `routes.ts`.
- [ ] **Step 4:** Run `pnpm --filter @agentdesk/contracts test && pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(contracts): shared Zod schemas and route table"`. **Then fork the worktrees (Execution model, step 2).**

---

### Task 3: Database schema, roles and migrate entrypoint

**Files:**
- Create: `packages/db/src/schema/{auth.ts,app.ts,index.ts}`, `packages/db/drizzle.config.ts`, `packages/db/migrations/*` (generated + one hand-written SQL migration for roles grants, functions and policies), `packages/db/src/bootstrap.ts`, `apps/api/src/migrate.ts`
- Test: `packages/db/test/migrate.test.ts`, `packages/db/test/helpers/pg.ts`

**Interfaces:**
- Produces: `bootstrapDatabase(adminUrl: string, passwords: { owner, app, temporal }): Promise<void>` (idempotent `CREATE ROLE … IF NOT EXISTS` equivalent, databases `agentdesk`, `temporal`, `temporal_visibility`, grants); `runMigrations(ownerUrl: string): Promise<void>`; Drizzle tables exported from `@agentdesk/db`: `user, session, account, verification, organization, member, invitation, connections, projects, agents, rules, runs, runEvents, inboundEvents, pollCursors, auditLog`; test helper `startPg(): Promise<{ adminUrl, ownerUrl, appUrl, stop }>` (Testcontainers `postgres:18`, runs bootstrap + migrations).
- `apps/api` script `migrate` = `tsx src/migrate.ts` (reads `DATABASE_ADMIN_URL`, role passwords from env).

- [ ] **Step 1: Write the failing test** — `migrate.test.ts`:
  - `bootstrap is idempotent`: call `bootstrapDatabase` twice, no throw; `select rolbypassrls from pg_roles where rolname='agentdesk_app'` → `false`.
  - `all app tables have org_id not null` (except `inbound_events`) via `information_schema.columns`.
  - `rls is forced on every org table`: `select relname from pg_class where relrowsecurity and relforcerowsecurity` contains all nine app tables.
  - `runs unique constraints`: inserting two runs with same `(project_id, trigger_comment_id)` fails with code `23505`; same for `(project_id, number)`.
- [ ] **Step 2:** Run `pnpm --filter @agentdesk/db test` → FAIL.
- [ ] **Step 3:** Implement schema per spec §4.1 plus gap columns (Spec gaps 4–7). `runs.number` assigned on insert by a `BEFORE INSERT` trigger using `coalesce(max(number),0)+1` under a per-project advisory lock (`pg_advisory_xact_lock(hashtext(project_id::text))`). `rules` unique `(project_id, command)`; `connections` unique `(provider, external_id)`; `inbound_events` unique `(provider, delivery_id)`; `run_events` PK `(run_id, seq)`; `poll_cursors` PK `project_id`. Policies declared with Drizzle `pgPolicy`; FORCE RLS, grants and the two functions in the hand-written migration. better-auth tables are generated with `npx @better-auth/cli generate` for the Drizzle adapter (organization plugin, `user.handle` additional field) and kept in `schema/auth.ts` (no `org_id`, no RLS).
- [ ] **Step 4:** Run tests → PASS. Run `pnpm db:migrate` against compose → exits 0 twice in a row.
- [ ] **Step 5: Commit** — `feat(db): schema, roles, migrations`.

---

### Task 4: Tenant isolation — `withOrg`, cross-tenant functions, NOTIFY

**Files:**
- Create: `packages/db/src/{client.ts,withOrg.ts,functions.ts,notify.ts}`
- Test: `packages/db/test/rls.test.ts`, `packages/db/test/functions.test.ts`

**Interfaces:**
- Produces:
  - `createDb(appUrl: string): Db` (pg Pool + drizzle; the only exported handle type is `Tx`, not `Db`'s query methods).
  - `withOrg<T>(db: Db, orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T>` — transaction + `set_config('app.org_id', $1, true)`.
  - `resolveProject(db, provider, externalId, repoPath): Promise<{ orgId, projectId } | null>`
  - `queuedRunsWithoutWorkflow(db, olderThanSeconds: number): Promise<{ orgId, runId }[]>` (returns `queued` runs with `workflow_id is null` older than the interval; the sweep sets `workflow_id` after a successful start).
  - `notifyRunStatus(tx, { orgId, runId, seq }): Promise<void>` (`pg_notify('run_status', json)`), `listenRunStatus(url, onMsg): Promise<() => Promise<void>>` (dedicated client, auto-reconnect).

- [ ] **Step 1: Write the failing tests**
  - `rls.test.ts` — seed org A and B with one row in every app table (as owner). For each table: `withOrg(A)` select returns only A rows; `withOrg(A)` insert with `org_id = B` → error `42501` (new row violates policy); a raw query without `withOrg` returns 0 rows.
  - `functions.test.ts` — `resolveProject('fake','acct-1','dev/demo')` returns A's ids; unknown repo → `null`; `queuedRunsWithoutWorkflow(30)` returns only runs from both orgs queued > 30 s with null `workflow_id`; `notifyRunStatus` inside `withOrg` is received by `listenRunStatus` only after commit.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `feat(db): withOrg, RLS leak tests, resolve_project, notify`.

---

### Task 5: API skeleton — config, logging, errors, health

**Files:**
- Create: `apps/api/src/{main.ts,app.module.ts}`, `apps/api/src/config/{config.schema.ts,config.module.ts}`, `apps/api/src/common/{request-context.ts,problem.filter.ts,zod-validation.ts,logger.ts}`, `apps/api/src/db/db.module.ts`, `apps/api/src/temporal/temporal-client.module.ts`, `apps/api/src/health/health.controller.ts`
- Test: `apps/api/test/skeleton.test.ts`, `apps/api/test/helpers/app.ts`

**Interfaces:**
- Produces:
  - `ConfigSchema` (Zod) keys: `NODE_ENV`, `PORT` (3000), `PUBLIC_ORIGIN`, `DATABASE_APP_URL`, `DATABASE_OWNER_URL`, `DATABASE_ADMIN_URL`, `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `BETTER_AUTH_SECRET` (min 32), `GITHUB_APP_ID?`, `GITHUB_APP_SLUG?`, `GITHUB_PRIVATE_KEY?`, `GITHUB_WEBHOOK_SECRET?`, `GITHUB_CLIENT_ID?`, `GITHUB_CLIENT_SECRET?` (all-or-none), `KUBE_MODE` (`fake`|`kubeconfig`|`incluster`), `KUBECONFIG?`, `RUNS_NAMESPACE` (`agentdesk-runs`), `APP_NAMESPACE` (`agentdesk`), `RUNNER_IMAGE`, `RUN_POD_*` (resources, ephemeral storage, workspace size, node selector/tolerations/runtime class as JSON), `FAKE_STATE_DIR`, `ENABLE_FAKE_PROVIDER`, `AUTH_DEV_LOGIN`, `POLL_MAX_BACKOFF_SECONDS` (3600), `OTEL_EXPORTER_OTLP_ENDPOINT?`, `BOT_NAME`, `BOT_EMAIL`. Shared by worker: put it in `packages/core/src/config.ts` and re-export.
  - `TEMPORAL_CLIENT` provider token (`@temporalio/client` `Client`); `DB` provider token (`Db`).
  - `createTestApp(overrides?): Promise<{ app: NestFastifyApplication, db, temporal: FakeTemporalClient, close }>` — Nest testing module with Testcontainers Postgres and a `FakeTemporalClient` recording `start`/`signal`/`signalWithStart` calls (`calls: { kind, workflowId, args }[]`).

- [ ] **Step 1: Write the failing tests**
  - `config fails on missing value`: `parseConfig({})` throws listing `DATABASE_APP_URL`.
  - `dev flags rejected in production`: `parseConfig({ ...valid, NODE_ENV: 'production', AUTH_DEV_LOGIN: 'true' })` throws.
  - `GET /healthz` → 200 with `x-request-id` header; incoming `x-request-id` is echoed.
  - `GET /readyz` → 503 `application/problem+json` when the fake Temporal client reports unavailable; 200 otherwise.
  - `unknown route` → 404 problem+json with `requestId`.
  - `validation`: a test-only route with a Zod body returns 400 with `errors: [{ pointer: '/name', detail: … }]`.
  - `GET /api/docs/json` returns an OpenAPI 3.1 document (generated from the contracts schemas via `nestjs-zod` + `@nestjs/swagger`; UI at `/api/docs`, public, no session).
- [ ] **Step 2:** Run `pnpm --filter @agentdesk/api test` → FAIL. **Step 3:** Implement (Fastify adapter, `nestjs-zod` pipe, global problem filter, pino with `requestId`/`orgId`/`runId` from AsyncLocalStorage). **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(api): skeleton with config, problem+json, health`.

---

### Task 6: Auth, personal org, org context, audit

**Files:**
- Create: `apps/api/src/auth/{auth.ts,auth.module.ts,auth.controller.ts,session.guard.ts,org-context.ts,dev-login.controller.ts,slug.ts}`, `apps/api/src/audit/audit.interceptor.ts`
- Test: `apps/api/test/auth.test.ts`, `apps/api/src/auth/slug.test.ts`

**Interfaces:**
- Consumes: `withOrg`, tables from Task 3.
- Produces:
  - better-auth instance mounted at `/auth/*` (Fastify catch-all forwarding to `auth.handler`), GitHub provider only when GitHub config is present, `organization` plugin, `emailAndPassword` enabled only when `AUTH_DEV_LOGIN`.
  - `databaseHooks.user.create.after` → creates the personal org (`slugFromHandle`) and `member` role `owner`; `session.create.before` sets `activeOrganizationId`.
  - `slugFromHandle(handle: string, taken: (slug) => Promise<boolean>): Promise<string>` — lowercase, `[^a-z0-9-]` → `-`, suffix `-2`, `-3`… on collision.
  - `GET /auth/dev-login?handle=alice&redirect=/` (dev only): signs up or signs in `alice@dev.local` server-side, forwards `Set-Cookie`, 302 to `redirect` (relative paths only).
  - `SessionGuard` (global on `/api/*`) → 401 problem; `OrgContext` request-scoped `{ userId, orgId, role }`, from `activeOrganizationId`, membership checked; helper `OrgDb.run(fn)` = `withOrg(db, ctx.orgId, fn)`.
  - `AuditInterceptor` on POST/PUT/PATCH/DELETE under `/api`: inserts `audit_log { action: 'METHOD route-key', target_type, target_id, payload }` with request body passed through `redactBody` (drops keys `value`, `token`, `secret`, `password`).

- [ ] **Step 1: Write the failing tests**
  - `slug.test.ts`: `'Minh.Nguyen'` → `'minh-nguyen'`; taken `'alice'` → `'alice-2'`.
  - `auth.test.ts`: dev-login creates user + org with slug `alice` and member role `owner`; second dev-login for `alice` does not create another org; `GET /api/projects` without cookie → 401 problem; with cookie → 200; `redirect=https://evil.example` → 400; audit row written for a `PUT /api/agents/:id/credential` contains no `value` key.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS (the projects route can be a stub returning `[]` until Task 8).
- [ ] **Step 5: Commit** — `feat(api): better-auth, personal org, org context, audit`.

---

### Task 7: Provider seams — registry, fake adapters, GitHub adapters

**Files:**
- Create: `packages/core/src/adapters/{types.ts,registry.ts}`, `packages/core/src/adapters/fake/{store.ts,board.ts,codehost.ts}`, `packages/core/src/adapters/github/{app.ts,board.ts,codehost.ts,webhook.ts}`, `packages/core/src/clock.ts`, `packages/core/src/redact.ts`
- Test: `packages/core/test/adapters/fake.test.ts`, `packages/core/test/adapters/github.test.ts`, `packages/core/test/fixtures/github/*.json` (recorded `issue_comment` payload, comments list, issue, PR, contents API responses), `packages/core/test/redact.test.ts`

**Interfaces:**
- Produces (types in `types.ts`, exactly as spec §5 plus `listRepos`):
  - `TicketEvent { provider, deliveryId, commentId, externalId, repoPath, ticketRef, ticketKind?, body, author, authorAssociation, createdAt }`, `Ticket { ref, kind, number, title, url, labels: { name, color }[] }`, `PollCursor { since: string, etag: string|null }`, `PollResult = { kind: 'events', events: TicketEvent[], cursor: PollCursor } | { kind: 'not_modified' } | { kind: 'rate_limited', resetAt: Date } | { kind: 'revoked' }`.
  - `BoardAdapter { verifyAndParseWebhook(headers, rawBody, secretLookup): Promise<TicketEvent|null|'bad_signature'>; pollEvents(project, cursor): Promise<PollResult>; getTicket(project, ref): Promise<Ticket>; comment(project, ref, text): Promise<string> }`
  - `CodeHostAdapter { installUrl(orgId, state): string; completeInstall(params, user): Promise<NewConnection> /* GitHub: checks access via the user's linked GitHub account */; listRepos(connection): Promise<RepoDto[]>; mintWorkspaceToken(project): Promise<{ token, expiresAt }>; cloneUrl(project, token): string; checkoutRef(ticket): string; listSkills(project); readSkill(project, name); writeSkill(project, name, body, message, sha?); deleteSkill(project, name, message) }` (skills at `.claude/skills/<name>/SKILL.md`; description from front-matter `description:`).
  - `AdapterRegistry { board(provider): BoardAdapter; codeHost(provider): CodeHostAdapter; providers(): Provider[] }`; `createAdapterRegistry(config, clock): AdapterRegistry` registers `github` when GitHub config is complete and `fake` when `ENABLE_FAKE_PROVIDER`.
  - `FakeStore(dir)`: file-backed JSON (`tickets.json`, `comments.jsonl`, `skills/<repo>/<name>.md`, `posted.jsonl`), safe for two processes (append-only writes + rename). Fake webhook signature header `x-fake-signature` = hex HMAC-SHA256 of the body with `FAKE_WEBHOOK_SECRET` (default `dev`). Fake bot author `agentdesk[bot]`, repos default `[dev/demo]`.
  - `Clock { now(): Date }`, `systemClock`.
  - `redact(text: string, secrets: string[]): string` — replaces each secret and the patterns `x-access-token:[^@\s]+@`, `ghs_[A-Za-z0-9]{20,}`, `sk-ant-[A-Za-z0-9_-]{10,}` with `***`.

- [ ] **Step 1: Write the failing tests**
  - GitHub webhook: recorded payload + correct `X-Hub-Signature-256` → `TicketEvent` with `deliveryId` from `X-GitHub-Delivery`, `ticketKind: 'pr'` when `issue.pull_request` present; wrong signature → `'bad_signature'`; `action: 'edited'` → `null`.
  - GitHub poll (fetch mocked with `undici` `MockAgent`): sends `If-None-Match`; 304 → `not_modified`; 200 → skips comments with `created_at < cursor.since`, new `since` = max `updated_at`, ETag cleared when since moves; 403 with `x-ratelimit-remaining: 0` → `rate_limited` with reset; 401 and 404 → `revoked`.
  - GitHub `checkoutRef({ kind: 'pr', number: 7 })` → `refs/pull/7/head`; issue → default branch name.
  - Fake: a comment appended by one `FakeStore` instance is returned by `pollEvents` of a second instance on the same dir; `comment()` appends to `posted.jsonl`; `writeSkill` then `readSkill` round-trips with a new sha.
  - `redact('https://x-access-token:ghs_abcdefghijklmnopqrstuv@github.com', [])` contains no `ghs_`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (GitHub via `@octokit/rest` + `@octokit/auth-app`; installation tokens scoped to the repo). **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(core): provider seams with fake and github adapters`.

---

### Task 8: Connections and projects API

**Files:**
- Create: `apps/api/src/adapters/adapter-registry.module.ts`, `apps/api/src/connections/{connections.controller.ts,connections.service.ts}`, `apps/api/src/projects/{projects.controller.ts,projects.service.ts,project-schedules.ts}`
- Test: `apps/api/test/connections.test.ts`, `apps/api/test/projects.test.ts`

**Interfaces:**
- Consumes: `AdapterRegistry`, `OrgContext`, `withOrg`, contracts `routes.connections.*`, `routes.projects.*`.
- Produces:
  - `POST /api/connections/:provider/install` → `InstallResponse` (state = signed `{orgId, userId}` with `BETTER_AUTH_SECRET`); `GET /api/connections/:provider/callback` → verifies state, `completeInstall`, upserts connection, 302 to `${PUBLIC_ORIGIN}/o/<slug>/projects/new/repo?connection=<id>`; fake provider's install URL points straight at the callback.
  - `GET /api/connections/:id/repos` → `RepoDto[]`.
  - Projects CRUD returning `ProjectDto` (counts computed in one grouped query); create inserts `agents` default row (`name 'Claude'`, `model 'sonnet'`, `max_turns 50`, `timeout_seconds 1800`), `poll_cursors` row when polling (since = now), `setup_step 'agent'`; `PATCH setupStep` only moves forward (backwards → keep current, no error); `DELETE` → 204 and deletes the poll schedule.
  - `ProjectSchedules.sync(orgId, project): Promise<void>` — creates/updates/deletes Temporal Schedule `poll-{projectId}` (action `PollOnceWorkflow` args `[{ orgId, projectId }]`, interval = `poll_interval_seconds`); called after create, update of trigger mode/interval, and delete. `setLimit` signal to `gate-{projectId}` after `maxConcurrentRuns` change (via `signalWithStart` so it works before the gate exists).
  - `GET /api/projects/:id/connection` → `ProjectConnectionDto` (webhook: newest `inbound_events` row for the project with channel `webhook`; polling: `poll_cursors`).

- [ ] **Step 1: Write the failing tests**
  - Fake install round-trip creates a connection visible in `GET /api/connections`; callback with a tampered state → 400.
  - Org boundary: project created by alice → `GET /api/projects/:id` as bob → 404; bob's list is empty.
  - Create with `triggerMode: 'polling'` → `FakeTemporalClient` recorded a schedule create `poll-{id}` every 300 s; PATCH to `webhook` → schedule delete recorded.
  - `PATCH { setupStep: 'rules' }` then `{ setupStep: 'skills' }` → `setupStep` stays `rules`.
  - `PATCH { maxConcurrentRuns: 2 }` → `signalWithStart` to `gate-{id}` with signal `setLimit` and `[2]`.
  - Every response parses with its contracts schema (contract assertion helper `expectContract(routeKey, res)`).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(api): connections and projects`.

---

### Task 9: Agents and credential, rules, skills

**Files:**
- Create: `packages/core/src/secrets/{secret-store.ts,kube-secret-store.ts,file-secret-store.ts,memory-secret-store.ts}`, `apps/api/src/agents/*`, `apps/api/src/rules/*`, `apps/api/src/skills/*`, `apps/api/src/secrets/secret-store.module.ts`
- Test: `apps/api/test/agents.test.ts`, `apps/api/test/rules.test.ts`, `apps/api/test/skills.test.ts`, `packages/core/test/secrets.test.ts`

**Interfaces:**
- Produces:
  - `SecretStore { put(name: string, data: Record<string,string>): Promise<void>; get(name): Promise<Record<string,string>|null>; delete(name): Promise<void> }`; `createSecretStore(config)` → `kube` (namespace `APP_NAMESPACE`) for `kubeconfig`/`incluster`, `file` (`${FAKE_STATE_DIR}/secrets`, file mode 0600) for `fake`; `MemorySecretStore` for tests.
  - `credentialSecretName(orgId, agentId) = 'org-' + orgId + '-agent-' + agentId`.
  - `GET /api/projects/:id/agent` → `AgentDto`; `PUT /api/projects/:id/agent` → `AgentDto`; `PUT /api/agents/:id/credential` → `PutCredentialResponse` (writes `{ type, value }` to SecretStore; stores only type, updated_at, set_by in Postgres).
  - Rules CRUD → `RuleDto` (stats: count of runs with this `rule_id` in 30 days and max `queued_at`); duplicate command → 409 problem with `errors: [{ pointer: '/command', detail: 'Command already used' }]`; `skillName` must exist in the repo (`readSkill`), else 422 with pointer `/skillName`.
  - Skills: list/get/put/delete through `CodeHostAdapter`; `PUT` with stale `sha` → 409 problem.

- [ ] **Step 1: Write the failing tests**
  - `PUT credential { type: 'api_key', value: 'sk-ant-secret123456' }` → body is exactly `{ updatedAt }`; MemorySecretStore holds the value; `GET agent` shows `credential.set: true` and no `value`; the string `sk-ant-secret123456` is absent from all `audit_log` rows and captured log output.
  - `PUT agent { timeoutSeconds: 4000 }` → 400 with pointer `/timeoutSeconds`.
  - Rule duplicate → 409 pointer `/command`; unknown skill → 422 pointer `/skillName`; rule from another org → 404 on PATCH.
  - Skills with fake provider: PUT then GET returns body and a new sha; PUT with old sha → 409.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(api): agents, credentials, rules, skills`.

---

### Task 10: Command parser and router (pure)

**Files:**
- Create: `packages/core/src/router/{parse-command.ts,route-event.ts,prompt.ts}`
- Test: `packages/core/test/router.test.ts`

**Interfaces:**
- Produces:
  - `parseCommand(body: string): { command: string, args: string } | null` — first line only, regex from Global Constraints, args trimmed.
  - `type RouteInput = { event: TicketEvent; project: { id, maxRunsPerTicket }; rules: RuleRow[]; ticket: () => Promise<Ticket>; counts: { runsForTicket: number; activeSkillsOnTicket: string[] }; botLogin: string }`
  - `routeEvent(input: RouteInput): Promise<RouteDecision>` where `RouteDecision = { kind: 'run', rule, ticket, command, args } | { kind: 'ignored', outcome: IgnoredOutcome, detail: string }` and `IgnoredOutcome = 'ignored_no_command' | 'ignored_unauthorized' | 'ignored_no_rule' | 'ignored_rule_disabled' | 'ignored_target' | 'ignored_labels' | 'ignored_max_runs' | 'ignored_active_run'`. `ticket()` is called only when needed (kind or labels unknown).
  - `buildPrompt({ skillName, ticketKind, ticketNumber, repoPath, args }): string` — the four-line template of Architecture §5, `{ticket_kind}` rendered as `issue` / `pull request`.

- [ ] **Step 1: Write the failing tests** (table-driven): `'/code-review fast'` → `{ command: 'code-review', args: 'fast' }`; `'hi\n/code-review'` → null; `'/Code'` → null; `CONTRIBUTOR` → `ignored_unauthorized`; bot author with `NONE` → run; rule target `pr` on issue → `ignored_target`; missing label → `ignored_labels`; `runsForTicket === maxRunsPerTicket` → `ignored_max_runs`; same skill active → `ignored_active_run`; `ticket()` not called when event carries kind and rule has no labels.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(core): command parser and router`.

---

### Task 11: Intake — webhook, shared `processTicketEvent`, outbox sweep activity

**Files:**
- Create: `packages/core/src/intake/process-ticket-event.ts`, `apps/api/src/intake/{webhooks.controller.ts,intake.module.ts}`, `apps/api/src/dev/fake.controller.ts`
- Test: `packages/core/test/intake.test.ts` (Testcontainers), `apps/api/test/webhooks.test.ts`

**Interfaces:**
- Consumes: `resolveProject`, `withOrg`, `routeEvent`, `AdapterRegistry`.
- Produces:
  - `processTicketEvent(deps: { db, registry, startRun: (orgId, runId) => Promise<void>, clock }, event: TicketEvent, channel: 'webhook'|'poll', known?: { orgId, projectId }): Promise<{ outcome: string; runId?: string }>` — steps 2–6 of spec §6.1: insert `inbound_events` (duplicate → `'duplicate'`), resolve project (skipped when `known`), route under `withOrg`, insert run `queued` with snapshot columns, unique violation → `'duplicate_comment'`, call `startRun`; updates the `inbound_events` row with outcome, org_id, project_id and the gap columns.
  - `startRunWorkflow(client, orgId, runId)` — `client.workflow.start('RunWorkflow', { taskQueue: 'agentdesk', workflowId: 'run-'+runId, args: [{ orgId, runId }] })`, `WorkflowExecutionAlreadyStartedError` swallowed, then sets `runs.workflow_id`. A thrown Temporal error is logged and swallowed (run stays `queued` for the sweep).
  - `POST /webhooks/:provider` → 401 on `'bad_signature'` (no row), 200 for duplicates/unknown/ignored, 202 when a run is created. Raw body preserved (Fastify `addContentTypeParser` with `parseAs: 'buffer'` scoped to this route).
  - Dev routes (`ENABLE_FAKE_PROVIDER` only): `POST /dev/fake/tickets { repoPath, number, kind, title, labels }`, `POST /dev/fake/comments { repoPath, ticketNumber, body, author?, authorAssociation?, deliver: 'webhook'|'poll' }` (webhook → signs and calls the intake in process), `GET /dev/fake/posted?repoPath=` (bot comments).
  - Activity `sweepOutbox(): Promise<number>` in `packages/core/src/intake/sweep.ts` — `queuedRunsWithoutWorkflow(30)` then `startRunWorkflow` each.

- [ ] **Step 1: Write the failing tests**
  - Same `TicketEvent` processed twice (same deliveryId) → second outcome `duplicate`, one run.
  - **Review Focus 1:** same comment id via `webhook` then via `poll` (different deliveryIds) → one run, second outcome `duplicate_comment`, `startRun` called once.
  - Temporal `start` throws → run stays `queued` with null `workflow_id`; `sweepOutbox` after clock +31 s starts it and sets `workflow_id`.
  - **Review Focus 4:** `'hi\n/code-review'` and a `CONTRIBUTOR` comment → outcome rows `ignored_no_command`, `ignored_unauthorized` with `command`, `author`, `ticket_ref` filled.
  - Webhook route: bad signature → 401 and `inbound_events` count unchanged; valid → 202 and `FakeTemporalClient` start call with `workflowId: 'run-<id>'`.
  - Runs get consecutive `number` 1, 2 per project under concurrent inserts (`Promise.all` of 5).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat: webhook intake, shared routing pipeline, outbox sweep`.

---

### Task 12: Worker skeleton, `setRunStatus`, `ProjectGateWorkflow`

**Files:**
- Create: `apps/worker/src/{main.ts,worker.module.ts}`, `apps/worker/src/workflows/{index.ts,gate.workflow.ts,signals.ts}`, `apps/worker/src/activities/{index.ts,run-status.activity.ts}`
- Test: `apps/worker/test/gate.workflow.test.ts`, `apps/worker/test/run-status.activity.test.ts`

**Interfaces:**
- Produces:
  - `signals.ts` (shared by api via `@agentdesk/worker/signals` export): gate signals `requestSlot(runId)`, `releaseSlot(runId)`, `setLimit(n)`; run signals `granted()`, `turnFinished()`, `resumed()`, `terminalAttached()`, `terminalDetached()`, `finish()`, `cancel()`.
  - `ProjectGateWorkflow({ projectId, limit, queue?: string[], active?: string[] })` — FIFO; on grant signals `granted` to `run-{runId}`; `releaseSlot` removes from active or from queue; `continueAsNew` after 1000 handled signals carrying state.
  - Activity `setRunStatus({ orgId, runId, status, exitCode?, failureReason?, at }): Promise<{ seq }>` — under `withOrg`: update `runs` (and `started_at` on `running`, `finished_at` on final, `idle_since` on `idle`/clear otherwise), append `run_events { type: 'status', payload: { status, exitCode, failureReason } }` with next seq, `notifyRunStatus`, all in one transaction. Ignores a transition out of a final status.
  - `main.ts`: `NestFactory.createApplicationContext(WorkerModule)`, then `Worker.create({ taskQueue: 'agentdesk', workflowsPath, activities })` with activities bound to Nest providers; registers Schedules `outbox-sweep` (30 s) and `reconcile-daily` idempotently at startup.

- [ ] **Step 1: Write the failing tests** (`TestWorkflowEnvironment.createTimeSkipping()`):
  - limit 1: requests A, B → A granted, B waits; release A → B granted; order preserved for C, D.
  - `setLimit(2)` while B waits → B granted immediately.
  - `releaseSlot(B)` while B waiting → B removed, never granted.
  - after 1000 signals the workflow continued-as-new and queue survives.
  - `setRunStatus` (Testcontainers): `running` sets `started_at`, emits NOTIFY with seq; `succeeded` after `succeeded` is a no-op.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(worker): gate workflow and setRunStatus`.

---

### Task 13: `RunWorkflow`

**Files:**
- Create: `apps/worker/src/workflows/run.workflow.ts`, `apps/worker/src/activities/run.activities.ts` (interfaces only here; implementations in Task 14)
- Test: `apps/worker/test/run.workflow.test.ts`

**Interfaces:**
- Consumes: gate and run signals (Task 12).
- Produces:
  - `RunWorkflow({ orgId, runId })` per spec §6.2. Activity interface `RunActivities`: `loadRun(orgId, runId) → RunContext { projectId, agentId, timeoutSeconds, ... }`, `mintWorkspaceToken`, `createRunSecretAndJob(ctx, token)`, `postComment(ctx, 'start'|'finish', details?)` (idempotent via `runs.outbox`), `followPodLogs(ctx) → { exitCode }` (heartbeating; signals `turnFinished` itself via a Temporal client), `endSession(ctx)`, `deleteJob(ctx)`, `ensureJobGone(ctx)`, `setRunStatus`.
  - Timers: idle 10 min with `terminalAttached === 0`; hard timer `timeoutSeconds`. Finish while not idle is ignored by the workflow (the API already returns 409).
  - Query `state` → `{ phase, terminalAttached }` (for tests and debugging).

- [ ] **Step 1: Write the failing tests** (time-skipping env, mocked activities recording calls):
  - success: logs exit 0 → statuses `starting, running, succeeded`; finish comment posted once; `releaseSlot` sent.
  - idle → finish signal → `endSession` called → logs complete 0 → `succeeded`.
  - idle timeout: `turnFinished`, no terminal, skip 10 min → `endSession`; with `terminalAttached` the timer does not fire until detached + 10 min.
  - hard timeout at `timeoutSeconds` → `deleteJob`, `timed_out`.
  - cancel while waiting for a slot → `cancelled`, no Job created, `releaseSlot` sent.
  - **Review Focus 2:** cancel after `createRunSecretAndJob` and before the first log line → `deleteJob`, `cancelled`, finish comment exactly once.
  - exit code 2 → `failed` with `exitCode: 2`, finish comment includes scrollback tail.
  - `followPodLogs` fails non-retryably (`PodPendingTimeout`) → `failed` with the reason.
  - replay: run a history captured from the success test through `Worker.runReplayHistory` without nondeterminism errors.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(worker): RunWorkflow`.

---

### Task 14: KubeGateway (fake and real) and run activities

**Files:**
- Create: `packages/core/src/kube/{gateway.ts,job-spec.ts,real-gateway.ts,fake-gateway.ts,fake-pod.mjs,log-parser.ts}`, `apps/worker/src/activities/run.activities.impl.ts`, `apps/worker/src/activities/reconcile.activity.ts`
- Test: `packages/core/test/kube/job-spec.test.ts`, `packages/core/test/kube/fake-gateway.test.ts`, `packages/core/test/kube/log-parser.test.ts`, `apps/worker/test/run.activities.test.ts`

**Interfaces:**
- Produces:
  - `KubeGateway { ensureSecret(name, data, labels): Promise<void>; ensureJob(spec: V1Job): Promise<void>; getRunPod(jobName): Promise<RunPod|null>; streamLogs(podName, signal: AbortSignal): AsyncIterable<string>; exec(podName, command: string[], opts: { tty: boolean }): Promise<ExecSession>; deleteJob(jobName): Promise<void>; listRunJobs(): Promise<{ jobName, runId, orgId, projectId }[]> }`; `RunPod { name, phase, pendingSince: Date|null, reason: string|null, exitCode: number|null }`; `ExecSession { write(data: Uint8Array): void; resize(cols: number, rows: number): void; onData(cb: (d: Uint8Array) => void): void; onClose(cb: (code: number) => void): void; close(): void }`. All create/delete calls are idempotent (409/404 → success).
  - `createKubeGateway(config)` → `RealKubeGateway` (`kubeconfig` | `incluster`; exec with `v5.channel.k8s.io`, resize on channel 4 as `{"Width","Height"}`) or `FakeKubeGateway(FAKE_STATE_DIR/kube)`.
  - `buildRunJob(input: { runId, orgId, projectId, image, prompt, checkoutRef, cloneUrlSecretKey, maxTurns, timeoutSeconds, botName, botEmail, pod: RunPodConfig }): V1Job` — name `run-{runId}`, labels, `backoffLimit 0`, `activeDeadlineSeconds timeoutSeconds+120`, `ttlSecondsAfterFinished 3600`, `restartPolicy Never`, `automountServiceAccountToken false`, uid 10001 restricted securityContext, `envFrom` Secret `run-{runId}`, env per spec §8, workspace `emptyDir` with size limit, optional nodeSelector/tolerations/runtimeClassName.
  - `parseLogLine(line): { kind: 'session_started' | 'turn_finished' | 'scrollback_begin' | 'scrollback_end' | 'text', text }`.
  - Fake pod protocol (`fake-pod.mjs`, spawned detached by `FakeKubeGateway.ensureJob` with the Job's env): state dir `<dir>/<jobName>/` with `log`, `pane`, `input`, `kill`, `exit`, `pid`. Script: log `agentdesk: session started`; write a fake TUI banner + the PROMPT to `pane`; after `FAKE_TURN_MS` (default 2000) log `agentdesk: turn finished`; each `\r`-terminated line appended to `input` is echoed to `pane`, then another turn finishes; on `kill` marker: log scrollback begin, `pane` contents, scrollback end, write `exit` 0, exit. A `PROMPT` containing `--fake-fail` (i.e. the comment's args) → exit 3 after the first turn; `--fake-pending` → phase stays `Pending`. `exec(['tmux','attach','-t','agent'])` streams `pane` (full content then appended bytes) and appends writes to `input`; `exec(['tmux','kill-session','-t','agent'])` creates `kill`.
  - Activity implementations: `createRunSecretAndJob` (Secret holds `REPO_CLONE_URL` with token, agent credential keys copied from `SecretStore`), `followPodLogs` (resume: skip the first N lines where N = stored `last_log_line` in heartbeat details; `PodPendingTimeout` non-retryable after 2 min Pending; first line → `setRunStatus(running)` only if status is `starting`; `turn_finished` → `setRunStatus(idle)` + signal `turnFinished`; scrollback → one `run_events { type: 'scrollback' }` row, redacted; lifecycle lines → `run_events { type: 'lifecycle' }`), `endSession`, `deleteJob`, `ensureJobGone`, `reconcile` (delete Jobs whose run is final or whose workflow is closed).

- [ ] **Step 1: Write the failing tests**
  - `buildRunJob` snapshot of key fields: `activeDeadlineSeconds === 1920` for 1800, labels, uid 10001, no `automountServiceAccountToken`.
  - Fake gateway: ensureJob twice → one process; `streamLogs` yields `session started` then `turn finished`; exec attach receives the banner, writing `hello\r` → pane echoes `hello`; kill-session → exit 0 and scrollback lines; `--fake-pending` → `getRunPod().phase === 'Pending'`.
  - `followPodLogs` (fake gateway, Testcontainers DB, activity test env): statuses `running`, `idle`; scrollback row contains no token string passed as secret.
  - **Review Focus 3:** `followPodLogs` run, cancelled after 2 lines with heartbeat details `{ lastLine: 2 }`, re-run → `run_events` has no duplicate lifecycle rows and status is not set back to `running` after `idle`.
  - Pending > 2 min (fake clock) → throws `ApplicationFailure` non-retryable type `PodPendingTimeout`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat: KubeGateway (fake and real), run activities, reconcile`.

---

### Task 15: Polling

**Files:**
- Create: `apps/worker/src/workflows/poll.workflow.ts`, `apps/worker/src/activities/poll.activity.ts`
- Test: `apps/worker/test/poll.test.ts`

**Interfaces:**
- Consumes: `processTicketEvent` (channel `poll`, `known` ids), `BoardAdapter.pollEvents`, `ProjectSchedules` ids.
- Produces: `PollOnceWorkflow({ orgId, projectId })` → activity `pollOnce` returning `PollOutcome = 'ok' | 'not_modified' | { pause: 'rate_limited', until } | { pause: 'token_revoked' } | { backoffSeconds }`. Workflow pauses the Schedule (`handle.pause(note)`) for rate limit (and a one-shot timer workflow `resumePollWorkflow` that unpauses at `until`) and token revoked (`poll_cursors.paused_reason = 'token_revoked'`; Schedule unpaused when a connection install/callback marks the connection healthy). Network/5xx: `next_poll_at = now + min(interval * 2^failures, POLL_MAX_BACKOFF_SECONDS)`; a tick before `next_poll_at` returns immediately.

- [ ] **Step 1: Write the failing tests** (fake board): new comment → one run; same tick twice → still one run; `not_modified` updates `last_polled_at` only; revoked → schedule paused and `paused_reason`; three 5xx in a row at 300 s → next poll at +2400 s, capped at 3600; success clears `last_error` and failure count.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(worker): polling schedules and PollOnce`.

---

### Task 16: Runs read API, cancel and finish, ignored list

**Files:**
- Create: `apps/api/src/runs/{runs.controller.ts,runs.service.ts}`, `apps/api/src/projects/ignored.controller.ts`
- Test: `apps/api/test/runs.test.ts`

**Interfaces:**
- Produces: `GET /api/projects/:id/runs` (`RunListQuery`; filters: `needs_you` = `idle`, `active` = starting|running|idle, `queued`, `ended` = final, `all`; keyset cursor on `(queued_at desc, id)`), `GET /api/projects/:id/runs/:number`, `GET /api/runs/:id`, `GET /api/runs/:id/log` (`RunLogResponse`, ascending seq), `POST /api/runs/:id/cancel` (202; 409 when final), `POST /api/runs/:id/finish` (202; 409 unless `idle`), both signalling `run-{id}`; `GET /api/projects/:id/ignored` (`IgnoredEventDto[]`, newest 100).
- [ ] **Step 1: Write the failing tests**: list filter `needs_you` returns only idle; cursor pagination returns disjoint pages; finish on `running` → 409 problem; cancel on `queued` → 202 and `FakeTemporalClient` signal `cancel` to `run-<id>`; byNumber for another org's project → 404; ignored list returns the Task 11 outcomes; all responses pass `expectContract`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(api): runs read API, cancel and finish`.

---

### Task 17: SSE

**Files:**
- Create: `apps/api/src/sse/{run-status-listener.ts,sse.controller.ts,sse-writer.ts}`
- Test: `apps/api/test/sse.test.ts`

**Interfaces:**
- Consumes: `listenRunStatus`, `withOrg`.
- Produces: `RunStatusListener` (one per replica; in-process `EventEmitter` keyed by `runId` and `projectId`, re-reads under `withOrg(orgId)` and never trusts the payload). `GET /api/runs/:id/events?after=` (and `Last-Event-ID`): first `event: status` with the current run, then `event: event` for each `run_events` row with seq > after, then live; `id:` = seq; closes after sending a final status. `GET /api/projects/:id/events`: `event: run` `ProjectRunEvent`. Heartbeat `: ping` every 15 s. Headers `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`.
- [ ] **Step 1: Write the failing tests** (real HTTP on an ephemeral port, `eventsource-parser`): backlog after seq 2 returns seq 3..n only; `Last-Event-ID: 3` behaves as `after=3`; a `setRunStatus` committed during the stream arrives as `status`; final status closes the stream; another org's run → 404 before streaming; project stream emits `{ runId, number, status, seq }`; heartbeat appears with a 15 s fake timer.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(api): run and project SSE`.

---

### Task 18: Terminal relay

**Files:**
- Create: `apps/api/src/terminal/{terminal.gateway.ts,terminal.module.ts}`
- Test: `apps/api/test/terminal.test.ts`

**Interfaces:**
- Consumes: `KubeGateway.exec`, run signals.
- Produces: `GET /api/runs/:id/terminal` via `@fastify/websocket`. Auth on upgrade: no session → close 4401; not org member or not (project creator or org owner) → 4403; run not `running`/`idle` → 4409. Exec `['tmux','attach','-t','agent']` with tty; binary frames relayed both ways; text frame `{"type":"resize","cols","rows"}` → `session.resize`; on open signal `terminalAttached`, on close `terminalDetached`; first input after `idle` signals `resumed` (throttled to once per 5 s per run); ping every 30 s.
- [ ] **Step 1: Write the failing tests** (`ws` client, `FakeKubeGateway` + fake pod): unauthenticated → 4401; bob in another org → 4403; finished run → 4409; attach receives banner bytes; sending `hi\r` echoes `hi`; resize frame reaches the fake session's `resize(120, 40)`; `terminalAttached`/`terminalDetached` signals recorded; two inputs within 5 s while idle → one `resumed`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(api): terminal relay`.

---

### Task 19: Localhost end-to-end and observability wiring

**Files:**
- Create: `apps/api/src/tracing.ts`, `apps/worker/src/tracing.ts` (OTel SDK + Temporal interceptors, exporter only when `OTEL_EXPORTER_OTLP_ENDPOINT` set), `scripts/e2e-local.ts`; update `docs/runbooks/local-dev.md` (already exists on `main`)
- Modify: root `package.json` (script `test:e2e:local` = `tsx scripts/e2e-local.ts`)

**Interfaces:**
- Consumes: everything above. Produces the backend half of the localhost acceptance criteria.

- [ ] **Step 1: Write the e2e script** (runs against a stack started by `pnpm dev` with `.env` from `.env.example`): dev-login `e2e-<rand>` → fake install → create project `dev/demo` (webhook mode) → PUT agent credential → PUT skill `code-review` → create rule `code-review` → `POST /dev/fake/comments` (`/code-review please`, deliver `webhook`) → poll `GET runs` until status `idle` (≤ 30 s) → open terminal WS, send `ok\r`, expect echo → `POST finish` → SSE stream ends with `succeeded` → `GET /dev/fake/posted` has a start and a finish comment. Repeat with a polling project (`pollIntervalSeconds: 300`, deliver `poll`; trigger the schedule with `temporal schedule trigger --schedule-id poll-<id>` via the Temporal client) and one run with `--fake-fail` → `failed`.
- [ ] **Step 2:** Run `pnpm dev` in one shell, then `pnpm test:e2e:local` → all three scenarios PASS.
- [ ] **Step 3:** Update `docs/runbooks/local-dev.md` (devbox-based; drop the *once backend lands* marks that now hold, and fix any command that changed): prerequisites (devbox, Docker or Podman), `devbox run dev`, dev login URL `http://localhost:3000/auth/dev-login?handle=me&redirect=/` (`:5173` once the frontend's Vite proxy is merged), fake comment curl, Temporal UI `:8233`, optional real GitHub App (create App, set the six `GITHUB_*` values, callback `http://localhost:5173/auth/callback/github`, use Polling mode) and optional `KUBE_MODE=kubeconfig`.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck && pnpm lint` at the root → PASS.
- [ ] **Step 5: Commit** — `test: localhost end-to-end flow; docs: local development`. Then merge `feat/backend` into `main` (Execution model, step 4).
