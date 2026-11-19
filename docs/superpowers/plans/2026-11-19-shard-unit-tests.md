# Shard Unit Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the CI unit tests as parallel jobs so that every `test / unit` job finishes in under 5 minutes (was over 8 minutes in one job), with the full suite and the coverage gate unchanged.

**Architecture:** Turn the single `unit` job in `.github/workflows/ci.yml` into a matrix job with one entry per package, each running that package's own existing coverage script and uploading its own `coverage-<pkg>-unit` artifact. The root `pnpm test:scripts` run moves into its own job. The `coverage` and `gate` jobs keep working because a matrix job reports one aggregate `needs.unit.result` and artifact names do not change.

**Tech Stack:** GitHub Actions matrix, pnpm, Vitest (existing scripts only; no new dependency).

**Spec:** GitHub issue #151 ("Shard unit tests to reduce CI execution time"). No separate spec: the change is a small CI edit.

## Global Constraints

- No new dependency, action or tool (AGENTS.md agent work rules). Use `actions/checkout@v4`, `./.github/actions/setup`, `actions/upload-artifact@v4` as already used.
- Artifact names stay `coverage-<pkg>-unit` for `api`, `worker`, `web`, `core`, `db`, `contracts`: `coverage` downloads `pattern: coverage-*` and `scripts/coverage-merge.ts` reads them by name.
- Do not touch `coverage-thresholds.json`, `coverage-baseline.json` or any coverage exclude (docs/conventions/testing.md §10).
- `gate / ci-passed` stays the only required check and must still fail when any unit shard or the scripts job fails.
- Every package's unit coverage file must still be produced: `if-no-files-found: error` stays.

- Hard target: every `test / unit (...)` job under 5 minutes in CI. Measured baseline (run 44523730055): api, core, db, contracts under 1 minute, web 2m, worker 7m14s. In `apps/worker`, `test/run.workflow.test.ts` alone takes about 314s of 444s (next slowest files: 62s, 30s), and `fileParallelism` is `false` there, so file-level sharding cannot go under about 5 minutes until that file is split.
- Never delete, skip or weaken a test while splitting: the set of test titles must be identical before and after.

## Review Focus

- One shard fails while the others pass: the `unit` aggregate result must be `failure` and `gate` must fail (`fail-fast: false` so every shard still reports).
- A package is added later and not added to the matrix: its unit tests silently stop running in CI. The docs line in Task 2 tells people to add a matrix entry.
- A shard writes its coverage to a different folder than the upload path: `if-no-files-found: error` must fail the shard, not skip it.
- `test:scripts` no longer runs because it was dropped with the old job: it has its own job and is in the `gate` needs list.
- Docs-only PRs: `unit` and `scripts` are skipped and `gate` must still pass (`CODE=false` path).

---

### Task 1: Matrix the unit job and split out the scripts job

**Files:**
- Modify: `.github/workflows/ci.yml` (job `unit`, lines ~76-120; job `gate`, lines ~275-290)

**Interfaces:**
- Consumes: root and package scripts that already exist: `pnpm --filter @agentdesk/<pkg> test:unit:coverage` (api, worker, core, db) and `pnpm --filter @agentdesk/<pkg> test:coverage` (web, contracts, which write to `coverage/unit`); `pnpm test:scripts`.
- Produces: jobs `test / unit (<pkg>)` x6 under the key `unit`, job `test / scripts` under the key `scripts`; artifacts `coverage-<pkg>-unit`.

- [x] **Step 1: Read each package's coverage script and confirm the folder it writes**

Run: `grep -n '"test:unit:coverage"\|"test:coverage"' apps/*/package.json packages/*/package.json`
Expected: api, worker, core, db have `test:unit:coverage` writing `./coverage/unit`; web and contracts have `test:coverage` writing `./coverage/unit`. If a package differs, use its script in the matrix entry below.

- [x] **Step 2: Replace the `unit` job with a matrix job**

Keep `needs: changes`, the `if`, `runs-on`, `timeout-minutes: 20`. Set `name: test / unit (${{ matrix.pkg }})`, `strategy.fail-fast: false`, and `strategy.matrix.include` with one entry per package carrying `pkg`, `dir` (`apps` or `packages`) and `script` (`test:unit:coverage` or `test:coverage`). Steps: checkout, `./.github/actions/setup`, `run: pnpm --filter "@agentdesk/${{ matrix.pkg }}" ${{ matrix.script }}`, then one `actions/upload-artifact@v4` with `name: coverage-${{ matrix.pkg }}-unit`, `path: ${{ matrix.dir }}/${{ matrix.pkg }}/coverage/unit/coverage-final.json`, `if-no-files-found: error`, `retention-days: 7`. Delete the six per-package upload steps.

- [x] **Step 3: Add the `scripts` job**

New job key `scripts`, `needs: changes`, same `if`, `name: test / scripts`, `runs-on: ubuntu-24.04`, `timeout-minutes: 20`, steps: checkout, setup, `run: pnpm test:scripts`.

- [x] **Step 4: Add `scripts` to the `gate` job**

Add `scripts` to `gate.needs` and `${{ needs.scripts.result }}` to `CODE_GATES`.

- [x] **Step 5: Validate the workflow file**

Run: `pnpm exec prettier --check .github/workflows/ci.yml` (via `devbox run fix` before committing) and `grep -c "coverage-.*-unit" .github/workflows/ci.yml`
Expected: prettier clean; the artifact name appears once (templated), not six times. No `actionlint` is installed: do not add it.

- [x] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: shard unit tests into one job per package"
```

### Task 2: Document the shards

**Files:**
- Modify: `docs/conventions/testing.md` (§9, the CI jobs line, ~line 141; the intro status line, line 9)
- Modify: `docs/runbooks/tests-and-e2e.md` only if it names the single `test / unit` job (`grep -n "test / unit" docs/runbooks/tests-and-e2e.md`)

**Interfaces:**
- Consumes: job names from Task 1.
- Produces: docs that say CI runs `test / unit (<pkg>)` per package plus `test / scripts`, and that a new package needs a matrix entry in the `unit` job.

- [x] **Step 1: Update the docs**

Change "CI runs them as the jobs `test / unit` and `test / integration (<pkg> <i>/<n>)`" to name `test / unit (<pkg>)`, `test / scripts` and the integration job. Add one **MUST**-style line in §9: add a matrix entry to the `unit` job in `ci.yml` when you add a package with unit tests. Why: otherwise its tests never run in CI.

- [x] **Step 2: Verify no stale reference remains**

Run: `grep -rn "test / unit\b" docs README.md AGENTS.md`
Expected: only the new `test / unit (<pkg>)` wording.

- [x] **Step 3: Commit**

```bash
git add docs
git commit -m "docs(conventions): describe the per-package unit test jobs"
```

### Task 3: Split `run.workflow.test.ts` into files of about 90 seconds each

**Files:**
- Create: `apps/worker/test/helpers/run-workflow-harness.ts` (the shared scripted-activities setup now at the top of `run.workflow.test.ts`: `deferred`, `Script`, the worker/env start and stop, and whatever helpers the tests share)
- Modify: `apps/worker/test/run.workflow.test.ts` (keep the first group of tests)
- Create: two or three sibling files `apps/worker/test/run.workflow.<group>.test.ts`, grouped by the existing `describe` blocks (for example the base `RunWorkflow` tests, `parking (pause-resume)`, `resuming (pause-resume)`, and the rest)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: files whose measured durations are each under about 100s (local `vitest run <file>` time), and that together contain exactly the test titles the original file had.

- [x] **Step 1: Record the baseline**

Run: `pnpm --filter @agentdesk/worker exec vitest run test/run.workflow.test.ts --reporter=json --outputFile=<scratch>/before.json`
Save the sorted list of full test titles and the pass count. Expected: all pass, about 314s.

- [x] **Step 2: Move the shared setup into `test/helpers/run-workflow-harness.ts`**

Move the setup code (everything the tests use that is not a test or a `describe`) with its exports named as it was. Each test file starts its own Temporal test environment through the harness in its own `beforeAll`/`afterAll`. Keep behaviour identical; no test body changes.

- [x] **Step 3: Split the tests by `describe` into files of about 90s each**

Use the per-test timings from Step 1 to balance the files. Move tests verbatim. Name files `run.workflow.<group>.test.ts` (plain words, e.g. `parking`, `resuming`). `pnpm lint` runs `scripts/check-test-split.ts`: these tests do not use Docker, so they stay `*.test.ts`.

- [x] **Step 4: Prove nothing was lost and each file is fast**

Run each new file with the JSON reporter; the union of titles must equal the Step 1 list exactly, with the same pass count; no `skip`, `only` or `todo`. Record each file's duration. Expected: every file under about 100s.

- [x] **Step 5: Commit**

```bash
git add apps/worker/test
git commit -m "test(worker): split run.workflow tests into files of about 90 seconds"
```

### Task 4: Shard the worker unit job

**Files:**
- Modify: `.github/workflows/ci.yml` (job `unit`)
- Modify: `docs/conventions/testing.md` (§9 sharding line)

**Interfaces:**
- Consumes: Task 3's files; the existing integration pattern `--shard=<i>/<n>` on package scripts.
- Produces: worker unit shards with artifacts `coverage-worker-unit-<i>` (`scripts/coverage-merge.ts` already accepts the `-<n>` suffix on unit artifacts via `ARTIFACT_RE`).

- [ ] **Step 1: Replace the single `worker` matrix entry with four entries**

Entries carry `shard` and `total` (`1..4`, `4`) next to `pkg`, `dir`, `script`. Other packages carry no `shard`. The test step appends `--shard=<shard>/<total>` only when `shard` is set (same pass-through the integration job uses). The artifact name becomes `coverage-<pkg>-unit` for unsharded entries and `coverage-<pkg>-unit-<shard>` for sharded ones; the path is unchanged. Job name: `test / unit (<pkg>)` or `test / unit (<pkg> <shard>/<total>)`.

- [ ] **Step 2: Check the merge and the timing**

Run: `pnpm exec vitest run --root scripts coverage-merge` (existing test covers the `-unit-<n>` suffix; if it does not, add a case in `scripts/coverage-merge.test.ts` first, watch it fail, then fix).
Run each of the four shards locally: `pnpm --filter @agentdesk/worker exec vitest run --exclude '**/*.int.test.ts' --shard=<i>/4` and record each duration. Expected: every shard under about 3 minutes locally (CI target: under 5). If one shard is over, raise `total` and note it.

- [ ] **Step 3: Docs**

In `docs/conventions/testing.md` §9, say the `unit` matrix may shard a package (`shard`/`total`) and that the target is every unit job under 5 minutes; raise a package's shard count when its job nears it.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml docs/conventions/testing.md
git commit -m "ci: shard the worker unit tests four ways"
```

## Verification and e2e

- **Local:** `devbox run fix` prints `fix: clean.`. Each shard command runs locally: `pnpm --filter @agentdesk/contracts test:coverage` (the quickest) and one `test:unit:coverage` package. The full suite is not run locally (AGENTS.md).
- **e2e: not applicable.** This change touches CI configuration only; no user-visible or cross-component runtime behaviour changes, and Playwright cannot exercise a workflow file. The lowest layer that proves it is the PR's own CI run: every `test / unit (<pkg>)` shard and `test / scripts` is green, `coverage` still merges all six `coverage-<pkg>-unit` artifacts, and `gate / ci-passed` passes. Record the run link and the new `test / unit` wall time in the PR.
- **Sensitive paths:** none, but the PR changes CI, so it waits for a human merge (AGENTS.md).
