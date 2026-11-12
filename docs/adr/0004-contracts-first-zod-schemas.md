# 0004. Contracts-first shared Zod schemas

- Status: Accepted
- Date: 2026-11-12
- Source: control plane design §7.1; frontend design §2 (Server state, Forms, API mocking), §4.1; implemented in commit `af7f901`

## Context

The API and the SPA live in one monorepo ([0001](0001-pnpm-turborepo-monorepo.md))
and are built in parallel by separate agents in separate worktrees. Both need
the same request/response shapes and enums (run status, trigger mode, provider,
ticket kind), the API needs validation and an OpenAPI document, and the frontend
needs typed calls, form validation and mocks that cannot drift from the API.

## Decision

`packages/contracts` is the single source of truth:

- A Zod schema for every request and response, plus the shared enums, and a
  route table.
- The api validates with `nestjs-zod` and generates OpenAPI at `/api/docs`.
- The web imports the schemas and a hand-written typed `fetch` client (`api`);
  responses are parsed with the route schema in development and tests only.
- Errors are RFC 9457 `application/problem+json` with `errors[]` of
  `{ pointer, detail }`; every response carries `x-request-id`.
- Forms (TanStack Form) validate with the contracts request schemas; MSW
  handlers are typed by contracts.
- While backend and frontend run in parallel, contract changes on the backend
  branch are additive only.

## Alternatives considered

| Alternative                            | Why rejected                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| orval codegen                          | No codegen wanted; Zod is the one source for Nest and web                                                                      |
| ts-rest                                | Weighed; same reason, hand-written client over contracts chosen                                                                |
| Router loaders only; SWR; RTK Query    | Weighed for server state; TanStack Query with `queryOptions` lets loaders and components share options and SSE patch the cache |
| React Hook Form + zodResolver; Conform | Weighed for forms; composites are already controlled and Standard Schema validation maps problem+json onto fields              |
| Storybook-only fixtures; a fake Nest   | Weighed for mocking; one MSW handler set serves Vitest, Storybook and `dev:mock`                                               |

## Consequences

### Positive

- One schema change updates validation, OpenAPI, the client, forms and mocks.
- Contract tests on both sides: every API response and every MSW fixture parses
  with its schema.
- Frontend work proceeds on MSW before the API exists.

### Negative

- Production skips client-side parsing and relies on backend contract tests.
- Additive-only rule during parallel work defers renames until after merge.

## Links

- [Control plane design](../superpowers/specs/2026-11-12-control-plane-design.md) §7.1, §9
- [Frontend design](../superpowers/specs/2026-11-12-frontend-design.md) §2, §4, §7
- [Backend local plan](../superpowers/plans/2026-11-12-backend-local.md) execution model
- Related: [0002](0002-nestjs-on-fastify-backend.md), [0003](0003-vite-spa-tanstack-router.md)
