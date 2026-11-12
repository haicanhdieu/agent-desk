# Backend guidelines

How we build the control plane: the NestJS-on-Fastify api for synchronous work and the Temporal worker for durable work.
The goal is that every request and every run is tenant-scoped, idempotent, traceable by id, and fails with a predictable error shape.

**Applies to:** `apps/api`, `apps/worker`, and the server-side parts of `packages/core` (adapters, router, intake, KubeGateway, SecretStore).
Siblings: [architecture.md](architecture.md) · [typescript.md](typescript.md) · [database.md](database.md) · [security.md](security.md) · [testing.md](testing.md) · [frontend.md](frontend.md) · [code-review-checklist.md](code-review-checklist.md)

Source of truth: `docs/superpowers/specs/2026-11-12-control-plane-design.md` (the spec) and `docs/superpowers/plans/2026-11-12-backend-local.md` (the plan). When this doc and the spec disagree, the spec wins and this doc gets fixed.

## 1. Where code goes

| Concern                                               | Lives in                                 | Notes                                                         |
| ----------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| HTTP, auth guards, SSE, terminal WS                   | `apps/api`                               | Stateless; scales horizontally                                |
| Durable work: runs, gate, polling, sweep, reconcile   | `apps/worker`                            | Temporal workflows + activities in a Nest application context |
| Pure logic: command parser, router, prompt, redaction | `packages/core`                          | No Nest, no I/O in the router                                 |
| Provider specifics                                    | `packages/core/src/adapters/<provider>/` | The only place `github` code may live                         |
| Tables, `withOrg`, migrations                         | `packages/db`                            | See [database.md](database.md)                                |
| Request/response schemas, enums, route table          | `packages/contracts`                     | Shared with `apps/web`                                        |

- **MUST** put logic shared by api and worker (e.g. `processTicketEvent`, `startRunWorkflow`) in `packages/core`, not in one app imported by the other. _Why: apps are deployables, not libraries._
- **MUST NOT** call a provider SDK (`@octokit/*`) or `@kubernetes/client-node` outside its adapter/gateway. _Why: seams keep the `fake` provider and `KUBE_MODE=fake` working._

## 2. Nest module layout

One feature module per resource (`ProjectsModule`, `RulesModule`, `RunsModule`, `IntakeModule`…), shaped controller → service → data/adapter.

```
apps/api/src/rules/
  rules.module.ts
  rules.controller.ts    # HTTP only: route, DTO, status code
  rules.service.ts       # business rules, transactions, calls adapters
  rules.repository.ts    # Drizzle queries taking a Tx (optional for small modules)
```

- **MUST** keep controllers thin: bind the route from `routes.*`, read `OrgContext`, call one service method, return its result. No Drizzle, no adapter calls. _Why: one place for rules, testable without HTTP._
- **MUST** open the transaction in the service via `OrgDb.run(tx => …)`; repositories take `tx: Tx` as a parameter and never open their own. _Why: the caller decides the transaction boundary (see [database.md](database.md) §Transactions)._
- **MUST** reach providers through `AdapterRegistry.board(provider)` / `.codeHost(provider)`, keyed by the connection's `provider` column. _Why: provider-agnostic._
- **MUST** inject non-class providers by token (`@Inject(DB)`, `@Inject(TEMPORAL_CLIENT)`). _Why: explicit, and survives builds without decorator metadata._
- **MUST NOT** use request-scoped providers except `OrgContext`. _Why: request scope bubbles up the DI tree and costs an instantiation per request._
- Shared modules: `DbModule`, `TemporalClientModule`, `KubeGatewayModule`, `AdapterRegistryModule`, `SecretStoreModule`, `ConfigModule`. Add a new shared module only for a new external dependency.

## 3. DTOs from contracts

- **MUST** derive every DTO from `@agentdesk/contracts` with `nestjs-zod` (`createZodDto(CreateRuleRequest)`). **MUST NOT** hand-write class-validator DTOs. _Why: one schema → validation, OpenAPI at `/api/docs`, and the web client._
- **MUST** match the method and path of `routes.<group>.<name>` exactly and name the route key in a comment; a test that walks `flattenRoutes(routes)` against the Fastify route list keeps them from drifting (planned).
- **MUST** map DB rows to DTOs in one `toXDto(row)` function per resource and make the response pass its schema in tests (`expectContract(routeKey, res)`). _Why: snake_case rows and internal columns (e.g. `credential_secret_name`, `workflow_id`) never leak._
- Contract changes during parallel work are **additive only** (new optional fields, new schemas, new routes), per the plan's execution model.

```ts
// good
export class CreateRuleDto extends createZodDto(CreateRuleRequest) {}

@Post('projects/:projectId/rules') // routes.rules.create
create(@Param() p: ProjectParamsDto, @Body() body: CreateRuleDto): Promise<RuleDto> {
  return this.rules.create(p.projectId, body);
}
```

## 4. Errors and status codes

All errors are RFC 9457 `application/problem+json` matching `ProblemSchema` (`type, title, status, detail?, instance?, requestId?, errors?`). One global `ProblemFilter` produces them.

| Cause                                                                                           | Status | Notes                                                                               |
| ----------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| Zod validation failure                                                                          | 400    | `errors[]` of `{ pointer, detail }`, JSON Pointer into the body (`/timeoutSeconds`) |
| No session                                                                                      | 401    | Also bad webhook signature (no row written)                                         |
| Member but not allowed (e.g. terminal, not owner/creator)                                       | 403    |                                                                                     |
| Not found **or in another org**                                                                 | 404    | RLS makes other orgs' rows invisible; never 403 for them                            |
| State conflict: duplicate command, stale skill `sha`, finish when not `idle`, cancel when final | 409    | Pointer when a field is at fault                                                    |
| Semantically invalid reference (unknown `skillName`)                                            | 422    | Pointer to the field                                                                |
| Signal accepted (cancel, finish), webhook created a run                                         | 202    |                                                                                     |
| Empty success (DELETE)                                                                          | 204    | Contract `response: z.null()`                                                       |
| Dependency down (`/readyz`)                                                                     | 503    |                                                                                     |
| Unhandled                                                                                       | 500    | Generic `title`; details only in logs                                               |

- **MUST** throw typed domain errors (see [typescript.md](typescript.md) §7) from services; the filter maps them. **MUST NOT** throw Nest `HttpException` from services. _Why: services are reused by the worker and tests._
- **MUST** include `requestId` in every problem body and an `x-request-id` header on every response (echo the incoming one if present).
- **MUST NOT** put stack traces, SQL, provider error bodies, or secrets in `detail`. _Why: see [security.md](security.md)._

## 5. Idempotency

Every entry point may be delivered twice. Design for it.

- **Webhooks:** insert `inbound_events` first; unique `(provider, delivery_id)` violation → 200 and stop. Run insert relies on unique `(project_id, trigger_comment_id)`; violation → no-op (`duplicate_comment`). Webhook and poll share `processTicketEvent`, so the same comment from either path yields one run.
- **Workflow start:** workflow id is deterministic (`run-{runId}`, `gate-{projectId}`); `WorkflowExecutionAlreadyStartedError` is success. A Temporal failure is logged and swallowed: the run stays `queued` with null `workflow_id` and the `outbox-sweep` Schedule starts it.
- **Activities MUST be idempotent**: Temporal retries them. Create-if-absent for Kubernetes (`run-{runId}` Job/Secret; 409/404 → success), `runs.outbox` keys for comments (`start`, `finish`) checked and set in the same transaction as the post is recorded, `run_events` keyed by `(run_id, seq)`.
- **MUST NOT** perform a side effect (comment, Job, Secret) without a stable key that a retry can detect. _Why: duplicate bot comments are the most visible bug we can ship._
- **SHOULD** make state-changing HTTP calls naturally idempotent (PUT for agent and credential; cancel on an already-cancelling run → 202).

## 6. Worker and Temporal conventions

- Task queue `agentdesk`. Ids: workflows `run-{runId}`, `gate-{projectId}`; schedules `poll-{projectId}`, `outbox-sweep`, `reconcile-daily`. **MUST NOT** invent new id formats without updating the spec.
- **Workflows MUST be deterministic**: no I/O, no `Date`/`Math.random`/Node timers, no imports from `@agentdesk/db` or adapters. Use `sleep`, `condition`, `workflowInfo`, signals and queries only. _Why: replay after a crash must reproduce the same commands._
- **MUST** run a replay test (`Worker.runReplayHistory`) for every workflow change; use `patched()` for changes to a workflow that may have open executions. _Why: nondeterminism errors only appear on running workflows._
- Workflow inputs **MUST** be a single object carrying `orgId` (`{ orgId, runId }`); activities call `withOrg(orgId)`. _Why: tenancy follows the work into the worker._
- Activities get services from the Nest application context; keep them thin wrappers over `packages/core` functions.
- Default activity retry: exponential, initial 1 s, max 1 min, 5 attempts. Long-running activities (`followPodLogs`) **MUST** heartbeat (10 s, timeout 60 s) and resume from heartbeat details.
- Non-retryable failures **MUST** use `ApplicationFailure.nonRetryable(msg, Type)` with a stable `Type` (`PodPendingTimeout`).
- Cleanup (`ensureJobGone`, final `setRunStatus`, finish comment, `releaseSlot`) **MUST** run in a non-cancellable scope.
- **MUST** write run status only through the `setRunStatus` activity (see [database.md](database.md) §Run state).
- Signal names live in `apps/worker/src/workflows/signals.ts` and are the only definitions the api imports.
- Long-lived workflows (`ProjectGateWorkflow`) **MUST** `continueAsNew` before history grows unbounded (1000 events).

## 7. Background loops

- **MUST NOT** write `setInterval` loops or hand-rolled `SKIP LOCKED` queues for durable work; use a Temporal Schedule or workflow timer. _Why: the spec chose Temporal so restarts, back-off and multi-replica are solved once._ (The Architecture PoC doc's queue table is superseded.)
- In-process loops are allowed only for per-connection liveness: SSE heartbeat (15 s), WS ping (30 s), the single `LISTEN run_status` client per api replica. They **MUST** stop on close/abort and on app shutdown (`enableShutdownHooks`).
- Polling back-off and pause state live in `poll_cursors`, not in memory.

## 8. Config

- **MUST** read env only through the Zod `ConfigSchema` (`packages/core/src/config.ts`, re-exported by `ConfigModule`). **MUST NOT** read `process.env` elsewhere _(lint, planned: `no-restricted-properties`)_. _Why: startup fails fast on a missing or invalid value._
- New variable → add to `ConfigSchema` with a type and default where safe, and to `.env.example` with a localhost value, in the same change.
- **MUST** fail validation for unsafe combinations, e.g. `NODE_ENV=production` with `AUTH_DEV_LOGIN=true` or `ENABLE_FAKE_PROVIDER=true`.
- Provider-specific variables (`GITHUB_*`) are consumed only by that provider's adapter factory and are all-or-none. Generic code reads generic keys.
- Durations in config **MUST** carry the unit in the name (`POLL_MAX_BACKOFF_SECONDS`).

## 9. Logging and correlation

- **MUST** log with pino (JSON). **MUST NOT** use `console.*` in app code _(lint, planned)_.
- Every log line in a request **MUST** carry `requestId` and, once known, `orgId`; anything about a run carries `runId` (and `projectId`). These come from AsyncLocalStorage set in middleware/interceptors and in an activity interceptor; **MUST NOT** thread them manually through arguments for logging.
- **MUST** log structured fields, not interpolated strings. _Why: queryable._

```ts
// bad
logger.info(`run ${runId} failed with ${code}`);
// good
logger.info({ runId, exitCode: code, failureReason }, 'run finished');
```

- Levels: `error` = needs a human; `warn` = degraded but handled (retry, rate limit, ignored webhook with bad signature); `info` = lifecycle (request done, run status change, schedule paused); `debug` = everything else, off in prod.
- **MUST** redact secrets: pino `redact` paths for `authorization`, `cookie`, `*.token`, `*.value`, `*.secret`, `*.password`, plus `redact(text, secrets)` from `packages/core` on any free text that may contain a clone URL or credential (scrollback, provider errors). Credential values and workspace tokens **MUST NEVER** reach logs, `run_events`, `audit_log`, or API responses. See [security.md](security.md).
- **MUST NOT** log full webhook bodies or ticket text at `info`.

## 10. Observability

- Tracing: OpenTelemetry SDK in `apps/api/src/tracing.ts` and `apps/worker/src/tracing.ts`, Temporal OTel interceptors so a trace spans api → workflow → activity. Exporter is off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
- **SHOULD** add spans around provider calls and Kubernetes calls with `provider`, `runId`, and status attributes (no secrets, no ticket bodies).
- Health: `GET /healthz` = process alive, no dependencies; `GET /readyz` = Postgres and Temporal reachable, 503 problem otherwise.
- Metrics (planned): run counts by status, queue wait (`started_at - queued_at`), webhook outcomes, poll failures.

## 11. API shape rules

- JSON is camelCase; timestamps are ISO 8601 with offset; ids are UUID strings. Run URLs in the web app use per-project `number`.
- List endpoints **MUST** paginate with a keyset cursor (`nextCursor`) and a bounded `limit` (max 100). _Why: offset pagination is wrong under concurrent inserts._
- SSE: `id:` is `seq`, honour `Last-Event-ID`, heartbeat every 15 s, re-read rows under `withOrg` on each notification and never trust the NOTIFY payload.
- Mutating `/api/*` calls are audited by `AuditInterceptor`; bodies pass through `redactBody` first.
- Dev-only routes (`/dev/*`, `/auth/dev-login`) are registered only when `NODE_ENV !== 'production'`.

## Checklist

- [ ] Controller is thin; service owns the transaction; no Drizzle or SDK calls in controllers.
- [ ] DTOs come from `@agentdesk/contracts` via `nestjs-zod`; responses map through `toXDto` and pass `expectContract`.
- [ ] Errors are typed domain errors mapped to problem+json with the status table above; other-org → 404.
- [ ] Every new entry point or activity is idempotent with a stable key; duplicates are tested.
- [ ] Workflow code is deterministic, has a replay test, and carries `orgId` in its input.
- [ ] Run status changes only via `setRunStatus`.
- [ ] No `process.env` outside `ConfigSchema`; new vars added to `.env.example`.
- [ ] Logs are structured, carry `requestId`/`orgId`/`runId`, and contain no secrets.
- [ ] No `setInterval` for durable work; in-process loops stop on abort.
- [ ] No provider names outside `adapters/<provider>/`.
