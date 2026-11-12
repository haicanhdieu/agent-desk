# Agent Desk Control Plane (Backend) — Design

Date: 2026-11-12 · Status: draft for review · Companion to `docs/Agent Desk — PRD (PoC).md` and `docs/Agent Desk — Architecture (PoC).md`

## 1. Intent

Agent Desk is split into three stacks: frontend (`web/`, presentational screens and Storybook, already built), backend (the control plane, this spec), and infra (cluster, runner image, manifests; separate spec). This spec covers the **whole control plane** in one design, built in the order in section 10.

The PoC behavior is the one in the Architecture doc: comments on tickets trigger agent runs, each run is one Kubernetes Job, chains continue through ticket comments. This design keeps that behavior and changes the foundations so the product can grow into:

- **Multi-tenancy and enterprise features**: orgs, roles, SSO, audit, horizontally scaled services.
- **Any identity provider**: GitHub sign-in first; Google, Apple, Keycloak/generic OIDC and SAML later.
- **Any code host and board**: GitHub first; GitLab, Bitbucket, Jira later. Nothing is named after a provider.

Success for this spec: every Architecture-doc flow (webhook and polling intake, routing, run lifecycle, live terminal, finish, cancel, timeouts, chaining) works end to end on a local kind cluster, under the tenant-ready schema, with automated tests at each layer.

## 2. Decisions

| Topic | Choice | Alternatives weighed | Why |
|---|---|---|---|
| Framework | NestJS on the Fastify adapter (TypeScript, Node) | Plain Fastify, Hono, Express, tRPC, Elysia/Bun, ASP.NET Core, Go | DI with request-scoped tenant context, guards and interceptors for RBAC and audit, OpenAPI, API/worker split; one language with `web/` and the future in-pod runner; Fastify and `ws` under the terminal relay |
| Tenancy | Tenant-ready now: orgs, `org_id` on every table, Postgres RLS; one personal org per user; no org UI | Full multi-tenant now; PoC single-owner | Retrofitting `org_id` is the expensive migration; this avoids it cheaply |
| Data access | Drizzle | Kysely, Prisma, MikroORM, TypeORM, raw SQL | RLS policies in the schema, typed `SKIP LOCKED` and jsonb, reviewable SQL migrations, simple per-transaction tenant context |
| Repo layout | pnpm workspaces + Turborepo | npm workspaces, Nx, Nest CLI monorepo | Strict dependencies, cached pipelines, framework-neutral |
| Auth | better-auth, in process, GitHub provider first | Keycloak broker, Passport, hosted IdP | Social and generic OIDC providers, account linking, organization and SSO plugins; nothing extra to run; a broker can be added later as one more OIDC provider |
| Background work | Temporal from day one | Hand-rolled `SKIP LOCKED` loops, pg-boss, graphile-worker, BullMQ | Durable run lifecycle with signals and timers, replay after crashes, path to multi-step chains; cost is a Temporal cluster in infra |
| Naming | Provider-agnostic everywhere | `github_*` tables | GitLab, Bitbucket, Jira later |

## 3. Architecture

```
apps/web            React SPA (moved from web/, unchanged in this spec)
apps/api            NestJS/Fastify: auth, REST, webhook intake + router, SSE, terminal WS relay
apps/worker         Temporal worker (Nest application context for DI): workflows + activities
packages/contracts  Zod schemas → DTOs, OpenAPI, typed client for web
packages/db         Drizzle schema, RLS policies, migrations, withOrg helper
```

Runtime dependencies: Postgres (app database), Temporal server (its own database; same Postgres instance locally), Kubernetes (one Job per run in namespace `agentdesk-runs`).

**apps/api** is stateless and scales horizontally. It owns synchronous work: sign-in, Desk CRUD, the skills proxy, webhook intake and routing, SSE, the terminal relay (a live socket, not durable work), and finish/cancel, which are signals to the run's workflow.

**apps/worker** owns durable work: `RunWorkflow` per run, `ProjectGateWorkflow` per project, polling Schedules, the outbox sweep, and reconcile. Activities get services (database, adapters, Kubernetes gateway) through a Nest application context.

**Read model vs execution state.** The `runs` table is the read model the UI queries. Temporal holds execution state. Only the `setRunStatus` activity writes run status.

## 4. Data model and tenancy

### 4.1 Tables

better-auth owns `user`, `session`, `account` (one row per IdP identity), `organization`, `member` (role `owner` | `member`), and `invitation` (unused in the PoC) through its Drizzle adapter and organization plugin. On first sign-in a hook creates a personal organization with the user as `owner` and a slug from the user's handle (suffix on collision; the web app routes by slug); the session carries `activeOrganizationId`.

Application tables (every one has `org_id uuid not null` unless noted):

| Table | Key columns | Notes |
|---|---|---|
| `connections` | id, org_id, provider, capabilities (`{code, board}`), external_id (text), account_name, config (jsonb), status, linked_by_user_id, created_at | One per connected provider account. GitHub provides both capabilities; Jira would be board only. Unique on (provider, external_id) |
| `projects` | id, org_id, name, repo_path, code_connection_id, board_connection_id, trigger_mode (`webhook`, `polling`), poll_interval_seconds, max_concurrent_runs, max_runs_per_ticket, created_by | `repo_path` is `owner/repo`, `group/subgroup/repo` or `workspace/repo`. `poll_interval_seconds` ∈ {300, 600, 900, 1800} |
| `agents` | id, org_id, project_id, name, provider (`claude`), model, credential_secret_name, max_turns, timeout_seconds | `timeout_seconds` ≤ 3300. Credential value only in a Kubernetes Secret |
| `rules` | id, org_id, project_id, command, label_filter[], target (`issue`, `pr`, `any`), agent_id, skill_name, enabled | Unique on (project_id, command) |
| `runs` | id, number, org_id, project_id, rule_id, agent_id, skill_name, ticket_ref (text), ticket_kind, checkout_ref, args, status, workflow_id, job_name, trigger_source (`webhook`, `polling`, `manual`), trigger_comment_id (text), inbound_event_id, triggered_by, queued_at, started_at, finished_at, exit_code, failure_reason, cost_usd, outbox (jsonb) | Unique on (project_id, trigger_comment_id) and (project_id, number). `number` is a per-project sequence assigned on insert, shown as "Run 62" and used in web URLs. `outbox` records which comments were posted, for idempotency |
| `run_events` | org_id, run_id, seq, ts, type, payload (jsonb) | Primary key (run_id, seq). Lifecycle lines and final scrollback in the PoC |
| `inbound_events` | id, provider, channel (`webhook`, `poll`), delivery_id (text), comment_id (text), org_id (nullable), project_id (nullable), received_at, event, action, outcome | Dedupe and debugging. `org_id` filled once the project is resolved. Unique on (provider, delivery_id) |
| `poll_cursors` | org_id, project_id, since, etag, last_polled_at, last_error, next_poll_at, paused_reason | Primary key (project_id) |
| `audit_log` | id, org_id, actor_user_id, action, target_type, target_id, payload (jsonb), at | Written by an interceptor on mutating Desk calls |

Run status is unchanged: `queued` → `starting` → `running` ⇄ `idle` → `succeeded` | `failed` | `cancelled` | `timed_out`.

### 4.2 Row-level security

- Every table with `org_id` has `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and the policy `org_id = current_setting('app.org_id')::uuid`, declared with Drizzle `pgPolicy`. `inbound_events` additionally allows rows with null `org_id` to be inserted by the intake.
- The app connects as `agentdesk_app` (no `BYPASSRLS`, no table ownership). Migrations run as `agentdesk_owner`.
- `packages/db` exports `withOrg(orgId, fn)`: open a transaction, `select set_config('app.org_id', $1, true)`, run `fn(tx)`. Request and activity code have no other way to obtain a database handle.
- The api derives `OrgContext` (request-scoped provider) from the session's active organization; a guard checks membership. Workflow inputs carry `orgId`; activities call `withOrg`.
- Cross-tenant lookup for webhooks: `resolve_project(provider text, external_id text, repo_path text) returns (org_id uuid, project_id uuid)`, a `SECURITY DEFINER` function owned by `agentdesk_owner`, granted to `agentdesk_app`. The only other cross-tenant read is `queued_runs_without_workflow` for the outbox sweep (section 6.1), built the same way. Reconcile needs neither: it reads `agentdesk/org-id` from Job labels and uses `withOrg`.

## 5. Provider seams

Each seam has a registry keyed by `provider`. The PoC registers `github`; tests register `fake`.

```
BoardAdapter
  verifyAndParseWebhook(headers, rawBody, connection) -> TicketEvent | null
  pollEvents(project, cursor)                         -> (TicketEvent[], cursor) | NotModified
  getTicket(project, ticketRef)                       -> Ticket  (kind, labels, title)
  comment(project, ticketRef, text)                   -> commentId

CodeHostAdapter
  installUrl(org) / completeInstall(callbackParams, user) -> Connection
  mintWorkspaceToken(project)                         -> { token, expiresAt }
  cloneUrl(project) / checkoutRef(ticket)             -> string
  listSkills / readSkill / writeSkill / deleteSkill(project, ...)

TicketEvent { provider, deliveryId, commentId, externalId, repoPath, ticketRef,
              ticketKind?, body, author, authorAssociation, createdAt }
```

GitHub specifics live only in the `github` adapters: HMAC `X-Hub-Signature-256`, `X-GitHub-Delivery`, the installation token flow, `refs/pull/N/head` as the checkout ref, the conditional `issues/comments` poll with ETag. Completing the install verifies, with the user's linked GitHub account (better-auth account linking), that the user can access the installation. GitHub is therefore also a linkable account when it isn't the login method.

## 6. Workflows and data flow

### 6.1 Intake and routing (api, synchronous)

`POST /webhooks/{provider}`:

1. The adapter verifies the signature and parses into a `TicketEvent`. Reject with 401 on a bad signature.
2. Insert into `inbound_events`. Duplicate key → 200, done.
3. `resolve_project`; unknown → record outcome, 200.
4. Under `withOrg`: router steps from Architecture §4 — parse command (`^/([a-z0-9-]+)(\s+.*)?$`), authorize (bot, or `OWNER`/`MEMBER`/`COLLABORATOR`), match rule (target kind and labels via `getTicket` if missing), guard (`max_runs_per_ticket`, active run for the same skill).
5. Insert `runs` as `queued`. A unique violation on (project_id, trigger_comment_id) → no-op.
6. `workflowClient.start(RunWorkflow, { workflowId: 'run-' + runId, args: [{ orgId, runId }] })`. `WorkflowExecutionAlreadyStarted` is treated as success. Reply 202.

The router is a pure function over (event, project, rules, run counts) so polling and manual runs reuse it.

**Outbox sweep.** A Temporal Schedule every 30 s runs an activity that, across orgs (through a `SECURITY DEFINER` function `queued_runs_without_workflow(older_than interval)`), starts `RunWorkflow` for `queued` runs older than 30 s whose workflow does not exist. This covers an api crash or Temporal outage between steps 5 and 6.

### 6.2 RunWorkflow(orgId, runId)

1. **Acquire a slot.** `signalWithStart` on `gate-{projectId}` (`ProjectGateWorkflow`) with `request(runId)`; wait for the `granted` signal. Cancel while waiting → `cancelled`, skip to step 6.
2. `setRunStatus(starting)`.
3. Activities (retry: exponential, initial 1 s, max 1 min, 5 attempts unless stated):
   - `mintWorkspaceToken` (CodeHostAdapter).
   - `createRunSecretAndJob`: Secret and Job named `run-{runId}`, idempotent (already exists → success). Secret holds the workspace token and a copy of the agent credential.
   - `postComment(start)`: idempotent via `runs.outbox.start`.
4. Start `followPodLogs` (long-running, heartbeat 10 s, heartbeat timeout 60 s). It resumes from the last stored `run_events.seq` after a retry. It:
   - fails non-retryably if the pod stays `Pending` for over 2 min (reason: pod event message);
   - calls `setRunStatus(running)` at the first log line;
   - signals `turnFinished` on the Stop-hook line;
   - stores lifecycle lines and the final scrollback (redacted) in `run_events`;
   - completes with the container exit code.
5. **Main loop.** State: `running` or `idle`, `terminalAttached` count. Events:
   - `turnFinished` → `idle`; `resumed` → `running`;
   - `terminalAttached` / `terminalDetached` → adjust count;
   - idle timer: 10 min in `idle` with no terminal attached → end session (outcome `succeeded`);
   - `finish` signal (only in `idle`) → end session (`succeeded`);
   - `cancel` signal → delete Job (`cancelled`);
   - hard timer at `timeout_seconds` (≤ 3300 s, so the 1-hour token stays valid) → delete Job (`timed_out`);
   - `followPodLogs` completes → exit code 0 → `succeeded`, non-zero → `failed`.
   "End session" is an activity that execs `tmux kill-session -t agent` in the pod; the entrypoint then prints scrollback and exits.
6. **Finally** (non-cancellable scope): ensure the Job is gone or completed, `setRunStatus(final, exitCode, reason)`, `postComment(finish)` with the scrollback tail on failure, `release(runId)` to the gate.

`setRunStatus` updates `runs` under `withOrg` and runs `pg_notify('run_status', json(orgId, runId, seq))` in the same transaction.

### 6.3 ProjectGateWorkflow(projectId)

FIFO queue of waiting run ids; grants while `active < max_concurrent_runs`. Signals: `request(runId)`, `release(runId)`, `setLimit(n)` (sent by the Desk API on change). Removes a waiting run on its cancellation. `continueAsNew` after 1000 events, carrying queue and active set.

### 6.4 Polling

One Temporal Schedule per project in Polling mode at `poll_interval_seconds`; created, updated or deleted when the project's trigger mode or interval changes. Each tick runs `PollOnce(orgId, projectId)`: `BoardAdapter.pollEvents` with the cursor, then for each event the same dedupe (`inbound_events` with `channel = poll`), router and `RunWorkflow` start. Results update `poll_cursors`. Rate limited → pause the Schedule until the reset time. 401 or 404 → pause with `paused_reason = token_revoked`; resumes when the connection is healthy again. Network or 5xx → back-off from one interval to `POLL_MAX_BACKOFF_SECONDS`. When a project switches to Polling, the cursor starts at the switch time.

### 6.5 Reconcile

A daily Schedule lists Jobs in `agentdesk-runs` by label `agentdesk/run-id` and deletes any whose run is final or whose workflow is closed. Temporal's durable state replaces the startup reconcile in the Architecture doc.

### 6.6 Failure handling

| Situation | Handling |
|---|---|
| Kubernetes, provider API or 5xx | Activity retry with back-off; after exhaustion the run is `failed` with `failure_reason` |
| Pod `Pending` > 2 min | `followPodLogs` fails non-retryably → `failed` with the pod event |
| Worker crash | Workflow replays; `followPodLogs` resumes from its heartbeat and stored seq; Job creation idempotent |
| api crash between run insert and workflow start | Outbox sweep starts the workflow |
| Temporal unavailable | Webhook still returns 202 with the run `queued`; sweep catches up; polling pauses |
| Orphan Job | Daily reconcile deletes it |
| Bad webhook signature | 401, no row written |

## 7. API

### 7.1 Contracts

`packages/contracts` holds a Zod schema for every request and response and the shared enums (run status, trigger mode, provider, ticket kind). The api uses them through `nestjs-zod` for validation and DTOs; the OpenAPI document is generated from them at `/api/docs`. `apps/web` imports the schemas and a typed `fetch` client from this package (wired in the frontend spec). Errors are RFC 9457 `application/problem+json`; validation failures carry `errors[]` of `{ pointer, detail }` (JSON Pointer into the request body). Every response carries an `x-request-id` header.

### 7.2 Routes

| Method and path | Purpose |
|---|---|
| `/auth/*` | better-auth (GitHub sign-in, session, sign-out) |
| `POST /webhooks/{provider}` | Webhook intake |
| `POST /api/connections/{provider}/install` · `GET /api/connections/{provider}/callback` · `GET /api/connections` | Connect a code host or board to the active org |
| `GET, POST /api/projects` · `GET, PATCH, DELETE /api/projects/{id}` | Project CRUD, including trigger mode and interval |
| `GET /api/projects/{id}/connection` | Trigger status: last event (webhook) or last checked, interval and last error (polling) |
| `PUT /api/projects/{id}/agent` · `PUT /api/agents/{id}/credential` | Agent settings; credential written to Kubernetes Secret `org-{orgId}-agent-{agentId}`, never stored in Postgres or returned |
| `GET /api/projects/{id}/skills` · `GET, PUT, DELETE /api/projects/{id}/skills/{name}` | Skills through `CodeHostAdapter` |
| `GET, POST /api/projects/{id}/rules` · `PATCH, DELETE /api/rules/{id}` | Rule CRUD |
| `GET /api/projects/{id}/runs` · `GET /api/projects/{id}/runs/{number}` · `GET /api/runs/{id}` | Run list and detail (by per-project number or id) |
| `GET /api/runs/{id}/events?after={seq}` | SSE for one run |
| `GET /api/projects/{id}/events` | SSE of run status changes in the project (runs list, needs-you count) |
| `POST /api/runs/{id}/cancel` · `POST /api/runs/{id}/finish` | Signals to `RunWorkflow` |
| `GET /api/runs/{id}/terminal` | Terminal WebSocket |
| `POST /api/projects/{id}/runs` | Manual run (P1) |
| `GET /healthz` · `GET /readyz` | Liveness; readiness checks Postgres and Temporal |

Every `/api/*` route requires a session and runs under `withOrg(activeOrganizationId)`. A record from another org is invisible (RLS) and returns 404.

### 7.3 Modules in apps/api

`AuthModule`, `ConnectionsModule`, `ProjectsModule`, `AgentsModule`, `RulesModule`, `SkillsModule`, `RunsModule`, `IntakeModule` (webhooks and router), `TerminalModule`, `AuditModule` (interceptor on mutating routes), `HealthModule`. Shared providers: `DbModule` (`withOrg`), `TemporalClientModule`, `KubeGatewayModule`, `AdapterRegistryModule`, `SecretStoreModule`, `ConfigModule` (Zod-validated environment; startup fails on a missing value).

### 7.4 SSE

`GET /api/runs/{id}/events?after={seq}` sends the current status and the `run_events` backlog after `seq`, then live updates. Each event's `id` is its `seq`, and a `Last-Event-ID` request header is treated as `after`. `GET /api/projects/{id}/events` sends `{ runId, number, status, seq }` for each status change in the project, from the same notifications. Each api replica holds one dedicated `LISTEN run_status` connection; a notification carries only `(orgId, runId, seq)`, so the replica re-reads under `withOrg` and never trusts the payload. Heartbeat comment every 15 s.

### 7.5 Terminal relay

- Frames: binary both ways for terminal bytes; resize from the browser is the text frame `{"type":"resize","cols":c,"rows":r}`. Close codes: 4401 not signed in, 4403 not allowed, 4409 run not `running` or `idle`.
- Authorization: session, org member, and project creator or org owner (the PoC "project owner" rule mapped to orgs). The run must be `running` or `idle`.
- `@kubernetes/client-node` `Exec` of `tmux attach -t agent` with `tty` and `stdin`; bytes relayed both ways. Resize frames are written to channel 4 as `{"Width":w,"Height":h}`.
- On connect and disconnect the api signals `terminalAttached` / `terminalDetached`. The first input after a turn signals `resumed`, at most once per 5 s.
- The control plane holds the Kubernetes credentials; the browser never gets them.

### 7.6 Observability

pino JSON logs with `requestId`, `orgId`, `runId` from AsyncLocalStorage; OpenTelemetry tracing across api → Temporal → activities through the Temporal OTel interceptors; OTLP exporter off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Secrets (workspace token, agent credential) are redacted from logs and stored scrollback.

## 8. Runner contract

The runner image is built in the infra spec. The control plane depends on this contract:

- Env: `REPO_CLONE_URL` (includes the workspace token), `CHECKOUT_REF`, `PROMPT`, `BOT_NAME`, `BOT_EMAIL`, `MAX_TURNS`, plus the agent credential from the per-run Secret.
- The entrypoint clones, fetches and checks out `CHECKOUT_REF`, starts Claude Code interactively in tmux session `agent` with `--permission-mode bypassPermissions`, waits for the pane to die, prints the scrollback and exits with the agent's status.
- Log lines, one per line on stdout: `agentdesk: session started`, `agentdesk: turn finished` (from the Stop hook), `agentdesk: final scrollback begin`, `agentdesk: final scrollback end`.
- Job spec: as in Architecture §5, with labels `agentdesk/run-id`, `agentdesk/project-id`, `agentdesk/org-id`; `activeDeadlineSeconds` = `timeout_seconds` + 120 as a backstop to the workflow's hard timer.

## 9. Testing and local development

| Layer | Tool | Covers |
|---|---|---|
| Unit | Vitest | Command parser, router and guards, adapters against recorded payloads, redaction, config schema |
| Workflow | `@temporalio/testing` time-skipping environment, mocked activities | `RunWorkflow` success, idle → finish, idle timeout, hard timeout, cancel at each stage, exit non-zero, replay after worker restart; gate FIFO, limit change, cancellation while waiting; outbox sweep; poll back-off |
| Database | Testcontainers Postgres, migrations, `agentdesk_app` role | RLS leak test across two orgs on every table, `resolve_project`, dedupe uniqueness, `withOrg`, NOTIFY |
| API | Nest testing module, Fastify `inject`, Testcontainers Postgres, fake Temporal client | Auth and org boundary on every route, webhook signature and dedupe, SSE backlog and live, problem+json |
| Contract | Vitest | Every route's response parses with its Zod schema |
| Kubernetes | `KubeGateway` in-memory fake; one kind test behind `pnpm test:e2e` | Job spec shape, idempotent create, exec relay against a stub pod, end-to-end comment → run → finish comment with the `fake` provider |

Test seams: `KubeGateway`, `BoardAdapter` and `CodeHostAdapter` (`fake` provider), `Clock`, `SecretStore` (Kubernetes Secrets in prod, in-memory in tests).

Local development: `pnpm dev` starts docker compose (Postgres; Temporal dev server with UI on :8233), then api and worker on the host with hot reload. `KUBE_MODE=kind` uses the local kubeconfig; `KUBE_MODE=fake` simulates Jobs with a scripted log so the full flow runs without a cluster. Projects default to Polling locally.

## 10. Scope and build order

In scope: `apps/api`, `apps/worker`, `packages/contracts`, `packages/db`; moving `web/` to `apps/web` inside the workspace with no screen changes; docker compose for local dependencies; the runner contract in section 8.

Out of scope: wiring screens to the API (`2026-11-12-frontend-design.md`); runner image, Kustomize manifests, Temporal and Postgres in Kubernetes, NetworkPolicy, CI (infra spec); org invitations and switching UI; identity providers other than GitHub; providers other than GitHub; structured stream (approach B); token refresh for runs longer than 55 minutes.

Build order, each step leaving the system working and tested:

1. Workspace: pnpm + Turborepo, move `web/`, `packages/contracts`, `packages/db`, docker compose.
2. Database: schema, roles, RLS, `withOrg`, `resolve_project`, leak tests.
3. Auth: better-auth with GitHub, personal org on first sign-in, `OrgContext`, guards, audit interceptor.
4. Desk API: connections (GitHub install and link), projects, agents and credential, rules, skills.
5. Intake: GitHub webhook adapter, router, run insert, workflow start, outbox sweep.
6. Worker: `RunWorkflow`, `ProjectGateWorkflow`, `setRunStatus` with `KUBE_MODE=fake`.
7. Real `KubeGateway`: Secret and Job creation, `followPodLogs`, end session, reconcile.
8. Polling: Schedules, `PollOnce`, cursor and back-off.
9. SSE.
10. Terminal relay.
11. kind end-to-end test.

## 11. Open technical checks

Carried from the Architecture doc: App-authored comments deliver webhooks; 304 on the comments list does not count against the rate limit; `since` semantics; App with an inactive webhook; Claude Code interactive skill invocation, first-run dialogs, Stop hook reliability, TUI rendering under tmux in xterm.js; cold start under 60 s.

New for this design:

- better-auth on Nest with the Fastify adapter: mount the handler on `/auth/*` and read the session in a guard.
- better-auth GitHub provider against a GitHub App's OAuth credentials (user-to-server flow) rather than an OAuth App.
- `@kubernetes/client-node` exec resize on channel 4 with the `v5.channel.k8s.io` subprotocol.
- Temporal TypeScript SDK worker inside a Nest application context, and its OTel interceptors.
- Drizzle `pgPolicy` with `FORCE ROW LEVEL SECURITY` and a `SECURITY DEFINER` function in drizzle-kit migrations.
