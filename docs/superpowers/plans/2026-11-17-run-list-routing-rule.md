# Run List: Routing Rule column Implementation Plan

**Status:** accepted (Advisor-approved under the owner's delegation on #87)
**Date:** 2026-11-17
**Issue:** #87

**Goal:** The Run List shows the routing rule command (e.g. `/dev-build`) instead of the `Skill` column, so skill runs and custom-prompt runs read the same way.

**Scope:** `apps/web` only. No contract, API, DB or worker change: `RunListItem.command` already exists (`packages/contracts/src/schemas/runs.ts`). `toRunSummary` (`apps/web/src/features/runs/map.ts`) maps it as `/<command>`, which must change so an empty command stays empty.

**Decisions (judgment calls, recorded in the PR):**
- Header is `Routing rule`.
- Custom-prompt runs show their rule command like any other run. This supersedes the "Custom prompt" label that `2026-11-15-rule-custom-prompt.md` put in the Skill column; run detail still shows the prompt itself.
- Runs whose rule was deleted (`ruleId` null) still show their recorded command; the dash appears only when no command was recorded (`dto.command` empty). `toRunSummary` maps an empty command to `''` (not `/`) and `RunRow` renders `—` for it.
- Long command: single-line ellipsis in the cell, full value in the native `title` tooltip.
- The run side panel and the "needs you" banner keep their own skill wording; out of scope.

## Task 1: Routing rule column in the Run List

**Files:** `apps/web/src/features/runs/map.ts`, `apps/web/src/features/runs/map.test.ts`, `apps/web/src/screens/Runs.tsx`, `apps/web/src/components/RunRow.tsx`, `apps/web/src/components/RunList.module.css`, `apps/web/src/components/RunRow.stories.tsx`, `apps/web/src/components/RunList.test.tsx`, `apps/web/src/mocks/runs.ts`, `design/parity-notes.md`

- [x] **Step 1: Tests first** in `map.test.ts` (an empty `dto.command` maps to `''`, a non-empty one to `/<command>`) and `RunList.test.tsx`: header `Routing rule` is present and `Skill` is not; a row shows its command; an empty command shows `—`; a long command has a `title` with the full value. Run them, expect FAIL.
- [x] **Step 2: Implement.** Fix the empty-command mapping in `map.ts`; rename the column (`key: 'rule'`, header `Routing rule`) in `Runs.tsx`; in `RunRow.tsx` render `run.command` (dash fallback, `title` attribute); rename the CSS class and add truncation (`max-width`, `overflow: hidden`, `text-overflow: ellipsis`, `white-space: nowrap`) using design tokens only. Sorting, filtering and responsive behavior untouched.
- [x] **Step 3: Story.** Update `RunRow.stories.tsx` column header; add a long-command and an empty-command story (loading, empty and error states of the list are unchanged).
- [x] **Step 4: Visual parity** (frontend.md §8): build Storybook, run the parity script for the Runs and RunsProblems boards, and record the intended drift ("Routing rule" column instead of the prototype's "Skill") in `design/parity-notes.md`.
- [ ] **Step 5: Run** `pnpm --filter @agentdesk/web test` for the changed files and `pnpm --filter @agentdesk/web typecheck`.
- [x] **Step 6: Commit** `feat(web): show the routing rule command in the run list`.

## Task 2: Mock e2e spec

**Files:** `apps/web/e2e/mock/runs-board.spec.ts`, `apps/web/src/mocks/dto/runs.ts` (only if a long-command fixture is needed; the mock DTOs already include a custom-prompt run)

- [ ] **Step 1:** Add a spec: the Run List has a `Routing rule` column and no `Skill` column; a skill run and a custom-prompt run both show a command; a long command does not widen the table and exposes the full value via its title.
- [ ] **Step 2:** Run only that spec (`docs/runbooks/tests-and-e2e.md` §3a, mock Playwright). Expect PASS.
- [ ] **Step 3: Commit** `test(web): e2e for the run list routing rule column`.

## Task 3: Mark the older plan superseded

**Files:** `docs/superpowers/plans/2026-11-15-rule-custom-prompt.md`

- [ ] **Step 1:** Next to its judgment call "Custom prompt in the run list skill column", add one line: superseded by `2026-11-17-run-list-routing-rule.md` (the Run List now shows the routing rule command). Commit `docs(web): note the run list routing rule plan supersedes the custom prompt label`.

**Done when:** all acceptance criteria of #87 hold: no `Skill` column, the command shows per run, missing values show a dash, long commands truncate with the full value reachable, existing sorting/filtering/responsive behavior intact (existing Run List tests still pass).
