# Architecture Decision Records

An Architecture Decision Record (ADR) is a short, dated note that captures one
significant decision about Agent Desk: the context that forced it, what was
chosen, what was set aside and why, and what follows from it. ADRs are the
durable "why" behind the specs in `docs/superpowers/specs/` and the PoC docs in
`docs/`. Specs describe the system; ADRs explain the choices that shaped it.

## When an ADR is required

Write an ADR when a change:

- picks or replaces a framework, library, datastore, queue, protocol or hosting
  platform that more than one module depends on;
- sets a cross-cutting rule that code must follow (naming, tenancy, secret
  handling, security boundaries, the shape of a seam or contract);
- changes how runs are isolated, triggered, observed or delivered;
- would be expensive to reverse (data model, URL scheme, packaging, deployment);
- reverses or narrows an earlier ADR.

Not needed for: local refactors, bug fixes, UI copy, a dependency bump within
the same major, or choices fully contained in one module.

## Naming and process

- File name: `NNNN-kebab-title.md`, a four-digit, zero-padded, never reused
  number, followed by a short kebab-case title (for example
  `0010-one-kubernetes-job-per-run.md`).
- Copy [`0000-template.md`](0000-template.md), fill it in, add a row to the
  index below, and land it in the same PR as the change it governs.
- An accepted ADR is not rewritten. To change a decision, write a new ADR and
  set the old one's status to `Superseded by NNNN`.

## Statuses

| Status             | Meaning                                   |
| ------------------ | ----------------------------------------- |
| Proposed           | Under discussion; not yet binding         |
| Accepted           | Binding; code and specs follow it         |
| Superseded by NNNN | Replaced by a later ADR, which is linked  |
| Deprecated         | No longer applies and nothing replaced it |

## Template

```markdown
# NNNN. Title

- Status: Proposed | Accepted | Superseded by NNNN | Deprecated
- Date: YYYY-MM-DD
- Source: spec, plan or doc (section)

## Context

Forces, constraints, roadmap pressure. Facts, not the answer.

## Decision

The choice and the concrete rules that follow from it.

## Alternatives considered

| Alternative | Why rejected                                        |
| ----------- | --------------------------------------------------- |
| ...         | ... (from the source; say so if none were recorded) |

## Consequences

### Positive

- ...

### Negative

- ...

## Links

- Source docs and related ADRs
```

## Index

| #                                                      | Title                                                                       | Status   | Date       |
| ------------------------------------------------------ | --------------------------------------------------------------------------- | -------- | ---------- |
| [0001](0001-pnpm-turborepo-monorepo.md)                | pnpm workspaces and Turborepo monorepo                                      | Accepted | 2026-11-12 |
| [0002](0002-nestjs-on-fastify-backend.md)              | NestJS on Fastify for the control plane                                     | Accepted | 2026-11-12 |
| [0003](0003-vite-spa-tanstack-router.md)               | Vite SPA with TanStack Router and org-scoped URLs                           | Accepted | 2026-11-12 |
| [0004](0004-contracts-first-zod-schemas.md)            | Contracts-first shared Zod schemas                                          | Accepted | 2026-11-12 |
| [0005](0005-provider-agnostic-naming-adapter-seams.md) | Provider-agnostic naming with adapter seams                                 | Accepted | 2026-11-12 |
| [0006](0006-tenant-ready-schema-with-rls.md)           | Tenant-ready schema: `org_id` everywhere and Postgres RLS                   | Accepted | 2026-11-12 |
| [0007](0007-drizzle-for-data-access.md)                | Drizzle for data access and migrations                                      | Accepted | 2026-11-12 |
| [0008](0008-better-auth-in-process.md)                 | better-auth in process for authentication                                   | Accepted | 2026-11-12 |
| [0009](0009-temporal-for-durable-work.md)              | Temporal for the run lifecycle and background work                          | Accepted | 2026-11-12 |
| [0010](0010-one-kubernetes-job-per-run.md)             | One Kubernetes Job per run as the sandbox                                   | Accepted | 2026-11-11 |
| [0011](0011-interactive-claude-code-in-tmux.md)        | Claude Code interactive in tmux with bypass permissions                     | Accepted | 2026-11-11 |
| [0012](0012-credentials-in-kubernetes-secrets.md)      | Agent credentials in Kubernetes Secrets, never in Postgres                  | Accepted | 2026-11-11 |
| [0013](0013-webhook-and-polling-intake.md)             | Webhook and polling intake feeding one router                               | Accepted | 2026-11-11 |
| [0014](0014-terminal-over-websocket-exec-relay.md)     | Terminal: xterm.js over a WebSocket relayed to `pods/exec`                  | Accepted | 2026-11-11 |
| [0015](0015-live-updates-over-sse.md)                  | Live run updates over SSE fed by Postgres NOTIFY                            | Accepted | 2026-11-12 |
| [0016](0016-qa-on-separate-k3s-in-shared-podman.md)    | QA on a separate k3s container in the Mac mini's shared Podman machine      | Accepted | 2026-11-12 |
| [0017](0017-helm-chart-delivered-by-flux.md)           | One Helm chart delivered by Flux from OCI release bundles                   | Accepted | 2026-11-12 |
| [0018](0018-portable-app-layer-target-contracts.md)    | Portable app layer: targets supply capabilities behind fixed names          | Accepted | 2026-11-12 |
| [0019](0019-repo-setup-and-approved-store-plugins.md)  | Repo setup script and plugins from approved stores only                     | Accepted | 2026-11-13 |
| [0020](0020-agent-status-protocol.md)                  | Agent-neutral status protocol with per-agent adapters and declared outcomes | Proposed | 2026-11-14 |

The specs these ADRs come from were marked "draft for review" when written; the
ADRs are recorded as Accepted because implementation has started on them (the
workspace and contracts commits on `main`).
