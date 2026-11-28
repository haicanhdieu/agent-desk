# Phase 3: Build

Ends with every task committed in the worktree. Builders work and commit there; you never edit code.

- **Bug:** one **Fixer**. It finds the root cause, writes a failing test that reproduces the bug (repo rule 9), then fixes it.
- **Feature:** one **Implementer** per task (Triage's `TASKS`, from its `TASK SOURCE`), **in order**; wait for each before the next. It reads its own task text from the source, and ticks the task's checkbox in the plan file (if in the repo) in the same commit. Pass Triage's `E2E REQUIREMENTS` files as `E2E_FILES` (or `none`).

Spawn them as [prompts/README.md](../prompts/README.md) says.

## Check each builder reply

`SKILLS:` is self-reported, not proof alone.

1. `SKILLS:`: a Fixer lists `superpowers:systematic-debugging` then `superpowers:test-driven-development`; an Implementer lists `superpowers:test-driven-development`.
2. Git evidence: `git -C <worktree> log --stat <base>..HEAD` (`<base>` = `origin/main` for the first task, else the previous task's commit). A Fixer's diff has a new regression test; an Implementer's has tests for the task's behaviors. Source changes with no tests did not follow TDD. A builder that fixes only test bugs (a re-spawn or a fix unit) changes tests alone and needs no new regression test. For any commit that fixes an e2e test, also run [Check e2e test fixes](4-verify.md#check-e2e-test-fixes). ([Phase 4](4-verify.md) also proves the regression test fails without the fix.)

If either fails, even when the diff looks fine, spawn the builder once more with `NOTE: You did not load <skill>. Load it now with the Skill tool as your first action, follow it, and redo what does not comply. Your reply is rejected again if SKILLS lacks it.` Never accept the work as is, and never fix or finish it yourself. A second miss is a technical failure.

## Blocked or failed

**Builder `blocked`** (a contradiction, a missing decision, a Fixer that can't reproduce, missing task text): ask the Advisor and act as [Decisions](../reference/decisions.md) says. Only on `needs_human`: post **Needs clarification** with the question, branch and `Stopped at:` lines, push the branch so work is not lost, `board.sh status <n> Blocked`, stop.

**Technical failure:** spawn it once more with the error in `NOTE`; a second failure is a stop condition for the Advisor (it may rule a fresh agent, a smaller task or a different approach); stop only on its `needs_human`.
