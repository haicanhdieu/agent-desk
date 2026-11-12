# 0002. NestJS on Fastify for the control plane

- Status: Accepted
- Date: 2026-11-12
- Source: control plane design §2 (Framework), §3, §7.3

## Context

The PoC Architecture doc suggested ASP.NET Core for the control plane, with
"TypeScript with Fastify" as an equal alternative, and a single modular monolith.
The control plane design then set a roadmap the framework has to carry:
multi-tenancy (orgs, roles, SSO, audit), horizontally scaled services, and an
API/worker split. The frontend is TypeScript, and the later in-pod runner
(approach B, Claude Agent SDK) is Node/TypeScript too.

## Decision

The control plane is NestJS on the Fastify adapter (TypeScript, Node 22), split
into two deployables:

- `apps/api`: stateless, horizontally scalable; auth, REST, webhook intake and
  router, SSE, terminal WebSocket relay.
- `apps/worker`: Temporal worker running inside a Nest application context, so
  activities get the same DI-provided services.

Cross-cutting concerns use Nest primitives: a request-scoped `OrgContext`
provider, guards for membership and RBAC, an interceptor for audit, and a
Zod-validated `ConfigModule`.

## Alternatives considered

| Alternative                                | Why rejected                                                                                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| ASP.NET Core (Architecture doc suggestion) | Weighed; Node/TS gives one language with `web/` and the future in-pod runner                                                              |
| Go                                         | Weighed; same one-language argument                                                                                                       |
| Plain Fastify, Hono, Express               | Weighed; NestJS adds DI with request-scoped tenant context, guards and interceptors for RBAC and audit, OpenAPI, and the API/worker split |
| tRPC, Elysia/Bun                           | Weighed; no per-option rejection recorded beyond the reasons for NestJS above                                                             |

The spec records why NestJS was chosen, not a separate rejection reason for
each alternative.

## Consequences

### Positive

- DI makes tenant context, guards and audit uniform across modules.
- Fastify and `ws` sit under the terminal relay; Fastify `inject` drives API tests.
- One language across web, api, worker and the future runner.

### Negative

- Open checks: better-auth mounted on Nest with the Fastify adapter, and the
  Temporal TS worker inside a Nest application context (spec §11).
- More framework surface than a plain Fastify service.

## Links

- [Control plane design](../superpowers/specs/2026-11-12-control-plane-design.md) §2, §3, §7.3, §11
- [Architecture (PoC)](<../Agent Desk — Architecture (PoC).md>) §8 Suggested stack
- Related: [0001](0001-pnpm-turborepo-monorepo.md), [0009](0009-temporal-for-durable-work.md)
