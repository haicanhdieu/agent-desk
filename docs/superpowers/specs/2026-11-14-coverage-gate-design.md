# Test-coverage gate (design)

Status: proposed. Date: 2026-11-14. Extends `2026-11-14-ci-quality-gates-design.md`, which left coverage thresholds as a non-goal. Issue #29.

## Problem

CI runs the tests but says nothing about how much code they exercise. Coverage can fall without anyone noticing, new code can land untested, and the code that guards tenancy, secrets and the sandbox has no higher bar than the rest.

## Goals

- Measure line and branch coverage per package from unit and integration tests together.
- Fail CI when a package drops under an absolute floor, falls behind the recorded baseline, or when a PR's changed lines are poorly covered.
- Hold sensitive paths to their own, higher floors.
- Make the cheap ways around the gate (ignore comments, wider excludes, lower thresholds) need a written reason and a human.

## Non-goals

- e2e and visual parity are not measured. `images/runner` has a coverage config but is not gated.
- No coverage upload service or PR comment bot; the summary table and artifacts are enough.
- No function or statement thresholds.

## Design

Coverage uses vitest v8 (`@vitest/coverage-v8`), off by default, switched on by the `test:coverage`, `test:unit:coverage` and `test:integration:coverage` scripts. Reports go to `<pkg>/coverage/{unit,integration}`. Stories, mocks, fixtures, tests, generated files and `*.d.ts` are excluded.

In CI the `unit` job and every integration shard upload `coverage-final.json`. The `coverage` job merges them per package (paths made repo-relative), prints a summary table, and runs the checks once. `gate / ci-passed` needs `coverage`.

1. **Floors.** `coverage-thresholds.json` holds a line floor for every package and a branch floor for every package but `web`. Each is the lower of the target and the measured baseline minus 2 points.
2. **Ratchet.** The merged numbers are compared with `coverage-baseline.json` taken from the PR's base branch, so a PR cannot lower the bar by editing the file. Tolerance is 0.5 points. The file may only go up: `--compare` rejects a lowered value and `--update` only raises.
3. **Patch coverage.** On pull requests, `diff-cover` requires at least 80% line coverage on changed lines. A PR with no measurable changed lines passes.
4. **Sensitive paths.** Groups of globs (auth, webhooks, secrets-tokens, terminal, tenancy, run-sandbox) each have line and branch floors, computed as covered over total across all matched files. A glob that matches nothing fails, so a rename cannot silently empty a group.
5. **Guard.** `scripts/coverage-guard.ts` fails a PR that adds a `v8`/`c8`/`istanbul ignore` comment, widens a coverage `exclude` or narrows an `include`, or lowers a threshold, unless the PR body has a `## Coverage exceptions` section of at least 20 meaningful characters (comments and placeholders do not count). Editing a protected file (thresholds, baseline, `scripts/coverage-*.ts`, vitest/vite configs, `ci.yml`) makes `dev-review` wait for a human.

## Baselines and floors

Measured on the merged unit and integration run, lines / branches:

| Package   | Baseline      | Line floor | Branch floor |
| --------- | ------------- | ---------- | ------------ |
| api       | 92.86 / 78.84 | 70         | 60           |
| worker    | 70.80 / 60.20 | 68         | 58           |
| core      | 86.86 / 73.11 | 80         | 70           |
| db        | 72.47 / 78.84 | 70         | 60           |
| contracts | 100 / 87.32   | 80         | 70           |
| web       | 95.42 / 88.14 | 60         | none         |

No package was below its target (80 lines, 70 branches). The floors for api and web sit far below their baselines on purpose: a floor must not fail on CI noise, and the ratchet is what holds the real line. Floors catch a collapse; the ratchet catches a slow slide of more than 0.5 points; patch coverage catches untested new code.

Sensitive groups (target 90 / 85), measured lines / branches and the floors set:

| Group          | Measured      | Floor (lines / branches) |
| -------------- | ------------- | ------------------------ |
| auth           | 99.19 / 74.76 | 90 / 72                  |
| webhooks       | 98.41 / 77.78 | 90 / 75                  |
| secrets-tokens | 86.84 / 75.82 | 84 / 73                  |
| terminal       | 93.47 / 79.17 | 90 / 77                  |
| tenancy        | 91.67 / 87.50 | 89 / 85                  |
| run-sandbox    | 88.27 / 67.65 | 86 / 65                  |

Groups that start below the 90 / 85 target are floored just under today's number, so nothing regresses, and are raised later (see follow-ups).

## Risks

- CI numbers can differ a little from local ones (ordering, timing, shards). The 0.5 point ratchet tolerance and the 2 point floor margin absorb this.
- Web jsdom tests can time out under the slower v8 instrumentation. `test:coverage` in `apps/web` sets a 15 s test timeout; plain `test` is unchanged.
- The worker and db margins are tight (about 3 points over the line floors in the worst case), so a legitimate refactor can trip a floor.
- Small groups are noisy: tenancy has 12 lines, so one uncovered line moves it by about 8 points.
- The guard reads a PR body that an author controls; a human review of the protected files is the backstop.

## Rollout

One PR, on the requester's request, even though it exceeds the roughly 400-line guideline in `git-workflow.md`. It is split into reviewable commits (config, merge, floors, ratchet, patch coverage, sensitive groups, guard, docs). It touches CI and the protected files, so it waits for a human approval. The `coverage` job is then added to the required `gate / ci-passed` through `needs`; branch protection does not change.

## Follow-ups

- Raise the sensitive groups that sit below 90 / 85, starting with run-sandbox branches and secrets-tokens lines.
- Replace the small glob matcher in `coverage-check.ts` with picomatch.
- Revisit floors and the ratchet tolerance after a few weeks of CI data.
