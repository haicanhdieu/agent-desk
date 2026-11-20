# Area: Architecture design

Where the change lives in the code and how its parts talk. You own the spec's `## Architecture` section.

Read first: `docs/conventions/architecture.md`, `backend.md`, `database.md`, `security.md`, `typescript.md`, and the ADRs in `docs/adr/`.

## Deep-dive items

Work through every item. An item the change does not touch gets one line in your findings saying so ("No schema change."); never drop it.

1. **Layer placement.** Which package owns each piece: `packages/contracts`, `packages/db`, `packages/core`, `apps/api`, `apps/worker`, `apps/web`, runner. Imports go `apps → core → db → contracts`, `web → contracts` only, no app imports another app (rule 2).
2. **Contracts.** New or changed Zod schemas and route table entries in `packages/contracts`, the single source of API types (rule 1).
3. **Data model.** Each new or changed table, column, type, index, constraint and RLS policy; its org/project scope through `withOrg` (rule 4); the new migration (never edit an applied one, rule 8); backfill of existing rows.
4. **API.** Each new or changed endpoint: method, path, who may call it (authz, rule 7), request, response, errors, pagination. WebSocket and terminal attach (authz on attach). Webhooks: signature verified in constant time before any side effect.
5. **Worker.** Temporal workflows and activities: determinism, retries, timeouts, signals and queries, idempotency, what happens when a step fails half way.
6. **Runner and Kubernetes.** Job spec changes through KubeGateway; no ticket, comment or repo text interpolated into a shell, a k8s spec or SQL (rule 6).
7. **Provider adapters.** Provider-specific code only inside adapters in `packages/core`; tables, types, modules and routes stay provider-agnostic (rule 3).
8. **Secrets.** Referenced by name through SecretStore; never in Postgres, logs, events, errors or commits; run output redacted (rule 5).
9. **Events and live updates.** Streams to the web app, their payloads and ordering, what a client that reconnects gets.
10. **Libraries.** Each third-party library used, existing first. A new one goes under `## Needs approval` and is a question unless the repo has nothing that can do the job.
11. **Services and integrations.** Each external service or internal system touched (provider API, Temporal, Kubernetes, SecretStore, Postgres): new or existing, how.
12. **Config and environment.** New env vars, settings, feature flags (only a mechanism the repo already has), secrets by name.
13. **Failure, observability and scale.** Failure modes and what the user sees; logs and metrics (no secrets); behaviour with many orgs, projects and runs.
14. **Sensitive paths and ADR.** Each sensitive path touched (run Job/runner, webhooks, secrets/tokens, auth, terminal, RLS/`withOrg`, migrations). Whether an architectural choice here needs an ADR (AGENTS.md › Workflow).

## Design fields (in your `STATUS: design` reply)

```text
ARCHITECTURE: <the parts and the flow between them, by layer; at most 8 lines>
DB SCHEMA: <one line per new or changed table, column, index or RLS policy, and the migration; or "none">
API: <one line per new or changed endpoint (METHOD /path, who may call it, request → response), WebSocket or webhook; or "none">
LIBRARIES: <one line per third-party library: name, new or existing, what for; or "none">
SERVICES: <one line per service or system: new or existing, how; or "none">
OTHER: <events, workflows, config and env, secrets by name, sensitive paths, ADR needed; or "none">
```
