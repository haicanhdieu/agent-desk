# 0001. pnpm workspaces and Turborepo monorepo

- Status: Accepted
- Date: 2026-11-12
- Source: control plane design §2 (Repo layout), §3, §10 step 1; implemented in commit `6e5240c`

## Context

Agent Desk started as a single `web/` package (design system, screens,
Storybook). The control plane adds an API service, a Temporal worker, a database
package and a shared contracts package, all in TypeScript, and the frontend must
import the same contracts as the backend. The infra spec later adds Dockerfiles
per app that build with `pnpm deploy --prod`.

## Decision

One repository organised as pnpm workspaces with Turborepo as the task runner:

```
apps/web  apps/api  apps/worker
packages/contracts  packages/db  packages/core
```

`web/` moved to `apps/web` with no screen changes. `pnpm-workspace.yaml` lists
`apps/*` and `packages/*`; `turbo.json` defines `build`, `dev`, `test`,
`typecheck` and `lint` with upstream `^build` dependencies.

## Alternatives considered

| Alternative       | Why rejected                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------- |
| npm workspaces    | Weighed in the spec; pnpm + Turborepo chosen for strict dependencies and cached pipelines |
| Nx                | Weighed; Turborepo chosen as framework-neutral                                            |
| Nest CLI monorepo | Weighed; framework-specific, while the repo also holds a Vite SPA                         |

The spec records the reasons for the choice ("strict dependencies, cached
pipelines, framework-neutral") rather than a per-alternative rejection.

## Consequences

### Positive

- Strict dependency isolation: a package can only import what it declares.
- Cached, dependency-ordered builds and tests across apps and packages.
- `packages/contracts` is consumed directly by both `apps/api` and `apps/web`
  (see [0004](0004-contracts-first-zod-schemas.md)).
- Images build per app with `pnpm deploy --prod` (infra spec §6.8).

### Negative

- Contributors need pnpm; a lockfile conflict between parallel branches is
  resolved by re-running `pnpm install` (backend plan, merge step).
- Parallel worktrees need file-ownership rules to avoid conflicts in shared
  packages (backend plan, execution model).

## Links

- [Control plane design](../superpowers/specs/2026-11-12-control-plane-design.md) §2, §3, §10
- [Infra design](../superpowers/specs/2026-11-12-infra-design.md) §6.8
- [Backend local plan](../superpowers/plans/2026-11-12-backend-local.md) execution model
- Related: [0002](0002-nestjs-on-fastify-backend.md), [0004](0004-contracts-first-zod-schemas.md)
