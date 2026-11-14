# CI quality gates (design)

Status: proposed. Date: 2026-11-14. Part of the `ci.yml` planned in `2026-11-12-infra-design.md` §7.1; this covers only the quality-gate jobs.

## Intent and why

Every PR gets automatic checks for format, lint, types, unit tests and integration tests, so humans and agents can trust a green PR. The integration suite is small today and will grow soon, so it must be sharded from the start. The whole run must finish within 20 minutes.

## Goals

- One workflow, `ci` (`.github/workflows/ci.yml`), on `pull_request` and push to `main`.
- Jobs run in parallel; wall time is the slowest job, hard cap `timeout-minutes: 20` per job.
- Integration tests are sharded by a matrix of package x shard; raising the shard count is a one-line change.
- Branch protection depends on one stable check name, so changing shard counts never breaks it.
- Cancel superseded runs on the same PR (`concurrency`, cancel-in-progress).

## Non-goals

- Build, Helm, kubeconform, conftest, shellcheck/bats, image builds, e2e, release: they stay in the infra spec's `ci.yml`/`e2e.yml`/`release.yml` work.
- Coverage thresholds.
- A root Vitest `projects` config (approach B below).

## Anti-goals

- A required check whose name changes with shard count.
- Shards that share a database or any state.
- Weakening lint, type or test checks to get green.

## Constraints

- Tests use no network; the only external I/O is Docker for Testcontainers (`testing.md` §4). GitHub-hosted `ubuntu-24.04` has Docker.
- Integration tests run as `agentdesk_app` on real Postgres, one container per shard (`testing.md` §1).
- `format:check` is red repo-wide today. **Prerequisite:** a separate one-time reformat PR lands first (`prettier --write .`). The `static / format` job is enabled only after it merges.
- Node and pnpm versions come from `.nvmrc` and the `packageManager` field; install with `pnpm install --frozen-lockfile`.

## Approaches

- **A. Vitest `--shard=i/n` in a Actions matrix (chosen).** Per-package `test:unit` and `test:integration` scripts, split by filename. Simple, no migration, and a root `projects` config can replace it later without changing check names.
- **B. Root Vitest `projects`, sharded as a whole.** Better balance, but needs a config migration first; roughly doubles this change.
- **C. One fixed job per package, no sharding.** Simplest, but fails the "design for sharding" goal.

## Design

**Check names** (shown as `ci / <job>`):

| Job | Runs |
| --- | --- |
| `static / format` | `pnpm format:check` (repo-wide, after the reformat PR) |
| `static / lint` | `pnpm lint` |
| `static / typecheck` | `pnpm typecheck` |
| `test / unit` | `test:unit` in every package, through Turbo |
| `test / integration (<pkg> <i>/<n>)` | `vitest run --shard=i/n` on `*.int.test.ts` for that package |
| `gate / ci-passed` | `needs` all of the above, `if: always()`, fails if any needed job failed or was cancelled. **The only required check.** |

**Test split.** Files that need Docker/Testcontainers are named `*.int.test.ts`. Each package that has them gets `test:integration`; `test:unit` excludes `*.int.test.ts`. The root `pnpm test` keeps running both, so `devbox run check` is unchanged.

**Shard matrix.** One map in the workflow, for example `db: 1, api: 1, worker: 1`, expands to the matrix. A package with zero integration files is omitted. Shards use `fail-fast: false` so one red shard does not hide the others.

**Speed.** pnpm store cache keyed on the lockfile; Turbo cache restored for lint, typecheck and unit; Playwright is not installed here.

## Left to the builder

- Classify existing tests into unit vs `*.int.test.ts` (known: `packages/db` uses Testcontainers; check `api` and `worker` for DB-backed tests).
- Exact shard counts per package, tuned from the first real run times (my call: start at 1 each and raise when a job passes ~8 minutes).
- Whether `TZ=UTC` is set in the workflow (my call: yes, per `testing.md` §5).
- Updating `testing.md` status line ("CI does not exist yet") and `tests-and-e2e.md` in the same PR.
- Sensitive paths: none of the human-review list, but CI config changes still get human review.

## Delivery order

1. One-time reformat PR (separate, repo-wide).
2. This change: scripts, test renames, `ci.yml`, doc updates.
3. Maintainer sets `gate / ci-passed` as the required check in branch protection.
