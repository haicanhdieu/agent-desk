# Architecture rules

How the Agent Desk monorepo is layered, which package may depend on which, and where new code goes.
These rules keep the control plane tenant-safe and provider-neutral as it grows from the PoC toward multi-tenant/enterprise.

**Applies to:** `apps/api`, `apps/worker`, `apps/web`, `packages/contracts`, `packages/core`, `packages/db`, and anyone adding a module, table, route, provider or workflow.

Sources of truth: `docs/superpowers/specs/2026-11-12-control-plane-design.md` (backend), `docs/superpowers/specs/2026-11-12-frontend-design.md`, `docs/superpowers/specs/2026-11-12-infra-design.md`, `docs/superpowers/plans/2026-11-12-backend-local.md`. Where this doc and a spec disagree, raise it; do not silently pick one. Related: [security.md](security.md), [typescript.md](typescript.md), [backend.md](backend.md), [database.md](database.md), [frontend.md](frontend.md), [testing.md](testing.md).

## 1. Packages and dependency direction

| Package              | Owns                                                                                                                                         | May import                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `packages/contracts` | Zod request/response schemas, shared enums, route table, typed fetch client (`./client`)                                                     | `zod` only                                                                          |
| `packages/db`        | Drizzle schema, RLS policies, migrations, `withOrg`, the `SECURITY DEFINER` lookups                                                          | `contracts` (enums only)                                                            |
| `packages/core`      | Framework-free domain: router, intake pipeline, provider adapters + registry, `KubeGateway`, `SecretStore`, `redact`, `Clock`, config schema | `contracts`, `db`                                                                   |
| `apps/api`           | NestJS/Fastify: auth, REST, webhook intake, SSE, terminal relay, signals to workflows                                                        | `contracts`, `db`, `core`, and `@agentdesk/worker/signals` only                     |
| `apps/worker`        | Temporal workflows + activities in a Nest application context                                                                                | `contracts`, `db`, `core`                                                           |
| `apps/web`           | Vite SPA, TanStack Router, Storybook                                                                                                         | `contracts` only (and only from `app/`/`features/`, see [frontend.md](frontend.md)) |

```
               apps/web ─────────────┐
                                     ▼
   apps/api ──► packages/core ──► packages/db ──► packages/contracts ──► zod
      │  │            ▲                                  ▲
      │  └────────────┼──────────────────────────────────┘
      │         apps/worker ─────────────────────────────┘
      └──► @agentdesk/worker/signals   (signal/workflow definitions only)
```

Rules:

- **MUST** keep arrows pointing one way: `apps/* → core → db → contracts`. _Why:_ a cycle makes `core` untestable without Nest/Temporal and breaks Turbo's build graph.
- **MUST NOT** import one app from another, except `apps/api` → `@agentdesk/worker/signals` (signal and workflow-name definitions, no activities, no Nest). _Why:_ apps deploy as separate images; importing an app drags its runtime into the other.
- **MUST NOT** import NestJS, Temporal worker APIs, Fastify or React in `packages/core`, `packages/db` or `packages/contracts`. _Why:_ core logic must run in Vitest with fakes and stay reusable by both apps.
- **MUST NOT** import `db` or `core` from `apps/web`. _Why:_ the browser bundle must never contain SQL, secrets handling or server config.
- **MUST** import packages by name (`@agentdesk/core`), never by relative path across package roots (`../../packages/core/src`). _Why:_ pnpm strict deps and the `exports` map are the boundary.
- **SHOULD** expose only what callers need through each package's `exports` map; add a subpath export (like `contracts/client`) instead of deep imports.

Current state (2026-11-12): `api`, `worker`, `core` and `db` are placeholders (`export {}`), `contracts` imports only `zod`, and `web` does not yet depend on `contracts`. No cross-package import exists yet, so the table above is the rule to build toward. Enforcement: an import-boundary lint (`eslint no-restricted-imports` or dependency-cruiser) in CI **(planned)**.

## 2. Contracts first

Every JSON API change starts in `packages/contracts`, then the server, then the client.

- **MUST** add or change the Zod schema in `packages/contracts/src/schemas/*` and the entry in `routes.ts` before implementing the handler. _Why:_ Nest (`nestjs-zod`), OpenAPI at `/api/docs`, MSW handlers and the web client all derive from it.
- **MUST** validate every request body, params and query with the route's schema at the edge; handlers receive parsed types only. _Why:_ unvalidated input is the first step of most injection and tenancy bugs.
- **MUST** return errors as RFC 9457 `application/problem+json` (`ProblemSchema`), with `errors[]` of `{ pointer, detail }` for validation failures.
- **MUST NOT** hand-write a request or response type in `apps/*` that duplicates a contract; use `z.infer` exports. _Why:_ drift between api and web is silent until runtime.
- **MUST** keep contract changes additive (new optional fields, new schemas, new routes) while backend and frontend branches run in parallel; renames and removals wait for the merge (backend plan, "Execution model").
- Non-JSON transports are not in `routes.ts` but are still contracts: SSE payloads live in `schemas/events.ts`; the terminal WebSocket frames and close codes (4401, 4403, 4409) are specified in backend spec §7.5. Change them in the spec and in `events.ts` first.
- Contract test: every route's response parses with its schema (backend spec §9). `routes.test.ts` checks route shape today; full response-parse tests are **(planned)** with the api.

```ts
// Good: handler typed from the contract
import { routes, type CreateRuleRequest } from '@agentdesk/contracts';
// Bad: a local copy that will drift
interface CreateRuleBody {
  command: string;
  labels: string[];
}
```

## 3. Provider seams (adapters)

Provider-agnostic naming is a project-wide rule. GitHub is the first provider, not the model.

- **MUST NOT** use provider names in tables, columns, routes, modules, files, types or enums outside adapters: no `github_*`, `GithubProject`, `installation_id` columns. Use `connection`, `code host`, `board`, `ticket`, `ticketRef`, `repoPath`, `externalId`. _Why:_ GitLab, Bitbucket and Jira are on the roadmap; a provider name in the schema is a migration later.
- **MUST** put all provider specifics (signature headers, delivery ids, installation tokens, `refs/pull/N/head`, ETag polling, token formats) in `packages/core/src/adapters/<provider>/`, behind `BoardAdapter` and `CodeHostAdapter`. _Why:_ the router, intake and workflows must behave identically for every provider.
- **MUST** resolve adapters through the registry keyed by `provider` (`AdapterRegistry`), never by importing `adapters/github` directly from api/worker code.
- **MUST** implement the `fake` adapter alongside any seam change, so tests and the local stack (`devbox run dev`) exercise it. _Why:_ the fake is the test seam and the local-dev path.
- **SHOULD** store provider-specific per-connection data in `connections.config` (jsonb) or `external_id`, not new columns.
- Provider-prefixed **config keys** for that provider's own credentials (`GITHUB_APP_ID`, Secret `agentdesk-github-app`) are allowed, but only adapter code reads them.

```ts
// Good
const board = registry.board(project.boardProvider);
const event = await board.verifyAndParseWebhook(headers, rawBody, secretLookup);
// Bad
import { parseGithubIssueComment } from '@agentdesk/core/adapters/github/webhook';
```

Same rule for agents: Claude Code specifics belong behind the `AgentRunner` seam (Architecture doc §3) when a second agent arrives.

## 4. Tenancy scoping

The schema is tenant-ready now: every application table has `org_id`, Postgres RLS is forced, and the app role cannot bypass it.

- **MUST** obtain a database handle only through `withOrg(orgId, fn)` from `@agentdesk/db`. _Why:_ it sets `app.org_id` for the transaction, which is what RLS checks.
- **MUST NOT** connect as `agentdesk_owner` or an admin user from request or activity code; only migrations do. _Why:_ the owner role is not subject to the app's RLS path.
- **MUST** use only the two cross-tenant entry points, `resolve_project(...)` and `queued_runs_without_workflow(...)`. Adding a third `SECURITY DEFINER` function requires security review ([security.md](security.md)).
- **MUST** also filter by `project_id` (and check the caller's access to that project) for project-scoped resources. _Why:_ RLS isolates orgs, not projects; project-level checks are application logic.
- **MUST** return 404 for a record in another org (it is invisible), never 403. _Why:_ 403 leaks existence.
- **MUST** carry `orgId` in every workflow input, activity input, Kubernetes label (`agentdesk/org-id`) and Secret name (`org-{orgId}-agent-{agentId}`). _Why:_ background work has no session to derive the tenant from.
- **MUST** treat `LISTEN/NOTIFY` payloads as hints: re-read under `withOrg` before sending anything to a client.
- **MUST** add `org_id`, RLS enable+force and the policy to every new table, plus a two-org leak test (see [database.md](database.md)).

## 5. Where new code goes

| You are adding…                                      | Put it in                                                                      | Notes                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------- |
| A REST endpoint                                      | schema + route in `contracts`, controller/service in an `apps/api` module      | Module per area: `ProjectsModule`, `RunsModule`, … |
| Pure domain logic (parsing, routing, guards, prompt) | `packages/core/src/<area>/`                                                    | No Nest/Temporal imports; unit-tested              |
| Provider-specific behavior                           | `packages/core/src/adapters/<provider>/`                                       | Plus the `fake` counterpart                        |
| A table, column, policy or migration                 | `packages/db`                                                                  | [database.md](database.md)                         |
| Durable or long-running work, timers, retries        | `apps/worker` workflow or activity                                             | Not a `setInterval` in api                         |
| Request-time work (CRUD, intake, SSE, terminal)      | `apps/api`                                                                     | Stateless; scales horizontally                     |
| Kubernetes interaction                               | `KubeGateway` in `packages/core/src/kube/`                                     | Real + fake implementations                        |
| Secret read/write                                    | `SecretStore` in `packages/core/src/secrets/`                                  | Never Postgres ([security.md](security.md))        |
| A config value                                       | config schema in `packages/core/src/config.ts` + `.env.example` + chart values | §7                                                 |
| A presentational UI piece                            | `apps/web/src/ds` or `components` + story                                      | No router/Query/contracts imports                  |
| Data wiring in the UI                                | `apps/web/src/features/<area>/`                                                | [frontend.md](frontend.md)                         |
| Deployment shape                                     | `deploy/` (chart, platform, targets)                                           | Infra spec                                         |

## 6. Run lifecycle and state ownership

Status: `queued → starting → running ⇄ idle → succeeded | failed | cancelled | timed_out`. `runs` is the read model; Temporal holds execution state.

| State or field                                                        | Sole writer                                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `runs` insert as `queued`                                             | `processTicketEvent` (core), called by webhook intake (api), `PollOnce` (worker), manual run (api, P1) |
| `runs.status` after insert, `started_at`, `finished_at`, `idle_since` | `setRunStatus` activity (worker), with `pg_notify` in the same transaction                             |
| `runs.workflow_id`                                                    | `startRunWorkflow` (core)                                                                              |
| `runs.outbox`                                                         | `postComment` activity (idempotency of start/finish comments)                                          |
| `run_events`                                                          | `setRunStatus` and `followPodLogs` activities                                                          |
| `poll_cursors`                                                        | `PollOnce` only                                                                                        |
| `inbound_events`                                                      | intake pipeline only                                                                                   |
| Job and per-run Secret `run-{runId}`                                  | `createRunSecretAndJob`, `deleteJob`, `ensureJobGone`, reconcile                                       |

- **MUST NOT** update `runs.status` anywhere except `setRunStatus`. _Why:_ one writer keeps transitions ordered and NOTIFY consistent.
- **MUST** express user actions (cancel, finish, terminal attach/detach, resume) as signals to `RunWorkflow` from api, never as direct row updates or Job deletes.
- **MUST** ignore transitions out of a final status (`setRunStatus` is a no-op there).
- **MUST** make every activity idempotent (create → 409 is success, delete → 404 is success; comments deduped through `outbox`). _Why:_ Temporal retries and replays activities.
- **MUST NOT** use wall-clock time or randomness inside workflow code; use Temporal timers and pass `Clock` into activities.

## 7. Configuration

- **MUST** read environment variables only through the Zod config schema (`packages/core/src/config.ts`, re-exported to the Nest `ConfigModule` and the worker). _Why:_ startup fails fast on a missing or invalid value instead of failing mid-run.
- **MUST NOT** read `process.env` anywhere else, including tests (build config with `parseConfig({...})`).
- **MUST** add every new key to the schema, `.env.example` and the chart's `agentdesk-config` ConfigMap or Secret contract in the same change.
- **MUST** keep dev-only switches (`AUTH_DEV_LOGIN`, `ENABLE_FAKE_PROVIDER`, `/dev/*`) rejected by the schema when `NODE_ENV=production`.
- **MUST** pass secrets as config values sourced from Kubernetes Secrets, never commit real values; `.env` is gitignored and `.env.example` holds dev placeholders only.
- **SHOULD** give each key a safe default only when the default is safe in production; otherwise make it required.

## Checklist

```
- [ ] Imports follow apps → core → db → contracts; no app-to-app import (except worker/signals); no Nest/Temporal/React in packages
- [ ] API change: schema + routes.ts in contracts first; request validated; problem+json errors; additive only during parallel work
- [ ] No provider name in tables/columns/routes/modules/types; provider code only in core/src/adapters/<provider>/ with a fake counterpart
- [ ] DB access only via withOrg; project-scoped queries also filter project_id; cross-org → 404
- [ ] New table has org_id, RLS enable+force, policy, leak test
- [ ] orgId carried in workflow/activity inputs, Kube labels, Secret names
- [ ] Run status written only by setRunStatus; user actions are workflow signals; activities idempotent
- [ ] New config key in config schema + .env.example + chart; no direct process.env
- [ ] Code placed per the "Where new code goes" table
```
