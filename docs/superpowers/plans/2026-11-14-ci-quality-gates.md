# CI Quality Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `ci` GitHub Actions workflow that gates PRs on format, lint, typecheck, unit tests and sharded integration tests, finishing within 20 minutes.

**Architecture:** Docker-backed tests are renamed `*.int.test.ts`; each package gets `test:unit` and `test:integration` scripts. A small script turns `.github/ci-shards.json` into the shard matrix. One aggregate job, `gate / ci-passed`, is the only required check.

**Tech Stack:** GitHub Actions (`ubuntu-24.04`), pnpm 10, Turbo, Vitest 5 (`--shard`), Testcontainers (`postgres:18`), tsx.

**Spec:** `docs/superpowers/specs/2026-11-14-ci-quality-gates-design.md`

## Global Constraints

- Workflow `ci`, file `.github/workflows/ci.yml`, triggers `pull_request` and push to `main`.
- Check names: `static / format`, `static / lint`, `static / typecheck`, `test / unit`, `test / integration (<pkg> <i>/<n>)`, `gate / ci-passed`.
- `timeout-minutes: 20` on every job; `concurrency` cancels superseded runs on the same PR.
- Shards: `fail-fast: false`; one Testcontainers Postgres per shard; no shared state.
- No network in tests; Docker only for Testcontainers. `TZ=UTC` in the workflow.
- Node from `.nvmrc`, pnpm from `packageManager`, `pnpm install --frozen-lockfile`.
- Prerequisite: the one-time repo-wide reformat PR is merged before the `static / format` job is enabled.
- Never weaken lint, type or test checks. Commits are Conventional Commits scoped by package (`ci`, `scripts`, `docs`).

## Review Focus

- A DB-backed test that is not named `*.int.test.ts` would run as a "unit" test without Docker: caught by the split guard (Task 1).
- A shard count larger than the number of integration files leaves some shards empty: they must pass, not fail (Task 3).
- A skipped or cancelled needed job must fail the gate, not pass it (Task 4).
- An invalid shard count (0, negative, non-integer) or an unknown package in `ci-shards.json` must fail loudly, not emit a broken matrix (Task 2).
- Docker Hub pull limits hit when many shards pull `postgres:18` at once: retry the pull (Task 4).

---

### Task 1: Test-split guard

**Files:**
- Create: `scripts/check-test-split.ts`, `scripts/check-test-split.test.ts`
- Modify: root `package.json` (`test:scripts`)

**Interfaces:**
- Produces: `findMisnamed(files: Record<string, string>): string[]`. `files` maps repo-relative path to source, covering every `*.test.ts(x)` plus the modules they import. Returns paths of tests that reach `@agentdesk/db/testing` through relative imports, directly or transitively, but are not named `*.int.test.ts`. It also returns `*.int.test.ts` files that never reach it. Sorted.
- Produces: the CLI (`tsx scripts/check-test-split.ts`) reads the real files, prints each offender, exits 1 if any.

- [ ] **Step 1: Write failing tests in `scripts/check-test-split.test.ts`** (names and assertions):
  - `flags a unit-named test that imports startPg through a helper`: files `a.test.ts -> ./helpers/app`, `helpers/app.ts -> @agentdesk/db/testing`; expect `['a.test.ts']`.
  - `accepts an int-named test that reaches the db testing module`: expect `[]`.
  - `flags an int-named test that never reaches Docker`: expect it listed.
  - `ignores tests that only import pure modules`: expect `[]`.
- [ ] **Step 2: Run** `pnpm exec vitest run --root scripts`. Expected: FAIL, `findMisnamed` not defined.
- [ ] **Step 3: Implement** `findMisnamed` and the CLI in `scripts/check-test-split.ts`. Parse `import`/`export ... from`/`import()` specifiers with a regex; resolve relative specifiers against the given file map (`.ts`, `.tsx`, `/index.ts`); walk with a visited set. Root `package.json`: add `"test:scripts": "vitest run --root scripts"`.
- [ ] **Step 4: Run** `pnpm test:scripts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(scripts): guard unit vs integration test naming`

### Task 2: Shard matrix script

**Files:**
- Create: `.github/ci-shards.json`, `scripts/ci-matrix.ts`, `scripts/ci-matrix.test.ts`

**Interfaces:**
- Produces: `buildMatrix(shards: unknown): { include: { pkg: string; shard: number; total: number }[] }`. For `{db: 2, api: 1}` it returns three entries (`db 1/2`, `db 2/2`, `api 1/1`). Throws on non-object input, a non-integer or `< 1` count, or a package outside `['api','worker','core','db']`.
- Produces: CLI `tsx scripts/ci-matrix.ts` prints the matrix as one-line JSON for `fromJSON`.
- Produces: `.github/ci-shards.json` = `{"db":1,"api":1,"worker":1,"core":1}` (my call: only packages that end up with `*.int.test.ts` files after Task 3; remove any that end up with none).

- [ ] **Step 1: Write failing tests**: `expands shard counts into one entry per shard`, `rejects a zero shard count`, `rejects a fractional shard count`, `rejects an unknown package name`, `rejects non-object input`.
- [ ] **Step 2: Run** `pnpm test:scripts`. Expected: FAIL.
- [ ] **Step 3: Implement** `buildMatrix` with a Zod schema (strict TS, parse `unknown` at the boundary) and the CLI that reads `.github/ci-shards.json`.
- [ ] **Step 4: Run** `pnpm test:scripts` (PASS) and `pnpm exec tsx scripts/ci-matrix.ts` (prints valid JSON).
- [ ] **Step 5: Commit** `feat(scripts): build CI shard matrix from ci-shards.json`

### Task 3: Split tests and package scripts

**Files:**
- Modify: `package.json` (root), `turbo.json`, `apps/{api,worker,web}/package.json`, `packages/{core,db,contracts}/package.json`
- Rename (`git mv`): every test file the Task 1 CLI reports (expected: all of `packages/db/test/*.test.ts` that use `startPg`, most of `apps/api/test` and `apps/worker/test`, `packages/core/test/intake.test.ts`)

**Interfaces:**
- Consumes: Task 1 CLI as the rename oracle.
- Produces: in api, worker, core, db: `"test:unit": "vitest run --exclude '**/*.int.test.ts' --passWithNoTests"` and `"test:integration": "vitest run .int.test.ts --passWithNoTests"` (my call: filename filter plus `--passWithNoTests`, so an empty shard passes). In web, contracts: `"test:unit": "vitest run"`. `test` is unchanged.
- Produces: root scripts `test:unit` = `turbo run test:unit`, `lint` additionally runs `tsx scripts/check-test-split.ts`, `test` additionally runs `pnpm test:scripts`. `turbo.json`: tasks `test:unit` (no env) and `test:integration` (same `passThroughEnv` as `test`).

- [ ] **Step 1: Run** `pnpm exec tsx scripts/check-test-split.ts` and record the offender list. Expected: non-empty, exit 1 (this is the failing test).
- [ ] **Step 2:** `git mv` each offender to `*.int.test.ts`. Re-run the CLI. Expected: exit 0.
- [ ] **Step 3:** Add the scripts and Turbo tasks above; wire the guard into root `lint`.
- [ ] **Step 4: Verify** (needs Docker):
  - `pnpm test:unit` passes with Docker stopped (proves unit tests are Docker-free).
  - `pnpm --filter @agentdesk/db test:integration -- --shard=1/2` and `--shard=2/2` together run every db integration file exactly once.
  - `pnpm --filter @agentdesk/db test:integration -- --shard=3/3` on a package with fewer files than shards exits 0.
  - `pnpm lint && pnpm typecheck && pnpm test` pass.
- [ ] **Step 5: Commit** `test(api): split integration tests by filename` (one commit per package if the diff exceeds ~400 lines; renames only, no content edits)

### Task 4: The `ci` workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: Task 2 CLI and `.github/ci-shards.json`; Task 3 scripts.

- [ ] **Step 1:** Write `ci.yml` with `name: ci`, `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }`, `env: { TZ: UTC }`, and these jobs (each `runs-on: ubuntu-24.04`, `timeout-minutes: 20`; shared setup: checkout, `pnpm/action-setup`, `actions/setup-node` with `node-version-file: .nvmrc` and `cache: pnpm`, `pnpm install --frozen-lockfile`):
  - `static-format` (name `static / format`): `pnpm format:check`.
  - `static-lint` (`static / lint`): `pnpm lint`.
  - `static-typecheck` (`static / typecheck`): `pnpm typecheck`.
  - `test-unit` (`test / unit`): `pnpm test:unit` (and `pnpm test:scripts`).
  - `plan` (`test / plan`, my call: tiny job emitting the matrix output via `tsx scripts/ci-matrix.ts`).
  - `test-integration` (name `test / integration (${{ matrix.pkg }} ${{ matrix.shard }}/${{ matrix.total }})`): `needs: plan`, `strategy: { fail-fast: false, matrix: ${{ fromJSON(needs.plan.outputs.matrix) }} }`; a step that runs `docker pull postgres:18` with up to 3 attempts; then `pnpm --filter @agentdesk/${{ matrix.pkg }} test:integration --shard=${{ matrix.shard }}/${{ matrix.total }}`.
  - `gate` (`gate / ci-passed`): `needs` every job above, `if: always()`, one step that exits 1 unless every `needs.*.result` equals `success`.
- [ ] **Step 2: Verify** locally with `actionlint` (or `docker run rhysd/actionlint`). Expected: no findings.
- [ ] **Step 3: Verify on GitHub:** open a draft PR. Expected: all jobs green; the longest job is well under 20 minutes (record the times in the PR). Push a commit that makes one test fail, and confirm `gate / ci-passed` goes red. Also confirm a cancelled job turns the gate red.
- [ ] **Step 4:** Confirm the reformat prerequisite has merged and `pnpm format:check` passes on `main`. If it has not, stop and flag it; do not weaken or drop the format job.
- [ ] **Step 5: Commit** `ci: add quality-gate workflow with sharded integration tests`

### Task 5: Docs

**Files:**
- Modify: `docs/conventions/testing.md` (status line, §2 naming for `*.int.test.ts`, §9), `docs/runbooks/tests-and-e2e.md`, `docs/conventions/git-workflow.md` (only if it says CI does not exist)

- [ ] **Step 1:** Replace the "CI does not exist yet" status text with the real state; document the `*.int.test.ts` convention, `test:unit`, `test:integration`, how to raise a shard count (`.github/ci-shards.json`), and the check names.
- [ ] **Step 2:** Add the manual step for maintainers: set `gate / ci-passed` as the only required status check in branch protection.
- [ ] **Step 3: Verify** `devbox run fix`, then `devbox run check` (report real results).
- [ ] **Step 4: Commit** `docs(testing): document CI gates and integration test naming`

## Self-review

- Spec coverage: check names, 20-minute caps, concurrency, matrix with `fail-fast: false`, unit/integration split, single required check, reformat prerequisite and docs update each map to a task above. Turbo/pnpm caching is covered by `setup-node` `cache: pnpm`. A Turbo cache step is left out (my call: add it only if `static` or `test / unit` exceeds ~8 minutes).
- Deviations from the spec, to flag in the PR: a `test / plan` job and `.github/ci-shards.json` (needed to make a shard-count change a one-line edit), and the split guard running inside `lint`.
