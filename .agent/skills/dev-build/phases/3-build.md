# Phase 3: Build

Done by one **Fixer** (bug; prompt: [prompts/fixer.md](../prompts/fixer.md)) or one **Implementer** per task (feature; prompt: [prompts/implementer.md](../prompts/implementer.md)). Ends with every task committed in the worktree.

Dispatch subagents with the Agent tool, using the prompts, tier and effort in [prompts/](../prompts/README.md). They work and commit in the worktree; you never edit code.

- **Bug:** one **Fixer**: `superpowers:systematic-debugging` for the root cause, then `superpowers:test-driven-development`: a failing test reproducing the bug first (repo rule 9), then the fix.
- **Feature:** one **Implementer** per task (Triage's `TASKS`, from its `TASK SOURCE`), **in order**, each with `superpowers:test-driven-development`. Wait for each before the next. It ticks the task's checkbox in the plan file (if in the repo) in the same commit. When Triage's `E2E REQUIREMENTS` names a file, keep the prompt's E2E paragraph and fill in the paths; with `none`, drop it.

## Copy the prompt, do not rewrite it

Take the block word for word and fill only the `<…>` slots. Never reword, shorten or reorder its steps, or swap the "call the Skill tool with skill …" lines for "use the TDD skill" or a summary: subagents never see `using-superpowers`, so the skill won't load (sessions that did this had most subagents skip it). **Before every spawn**, check the filled prompt contains these strings, and fix it if one is missing:

- Fixer: `call the Skill tool with skill "superpowers:systematic-debugging"`, and `call the Skill tool with skill` followed by `"superpowers:test-driven-development"` (that line wraps; check the skill name is there).
- Implementer: `call the Skill tool with skill` followed by `"superpowers:test-driven-development"` (same wrapped line).
- PR agent: `call the Skill tool with skill "create-pr"`.

## Check each builder reply

`SKILLS:` is self-reported, not proof alone.

1. `SKILLS:`: a Fixer lists `superpowers:systematic-debugging` then `superpowers:test-driven-development`; an Implementer lists `superpowers:test-driven-development`.
2. Git evidence: `git -C <worktree> log --stat <base>..HEAD` (`<base>` = `origin/main` for the first task, else the previous task's commit). A Fixer's diff has a new regression test; an Implementer's has tests for the task's behaviors. Source changes with no tests did not follow TDD. ([Phase 4](4-verify.md) also proves the regression test fails without the fix.)

If either fails, re-dispatch once with "You did not follow <skill>. Load it now with the Skill tool, check your work against it, and redo what does not comply." A second miss is a technical failure.

## Blocked or failed

**Builder `blocked`** (a contradiction, a missing decision, a Fixer that can't reproduce, missing task text): ask the Advisor and act as [Decisions](../reference/decisions.md) says. Only on `needs_human`: post **Needs clarification** with the question, branch and `Stopped at:` lines, push the branch so work is not lost, `board.sh status <n> Blocked`, stop.

**Technical failure:** re-dispatch once with the error; a second failure is a stop condition for the Advisor (it may rule a fresh agent, a smaller task or a changed prompt); stop only on its `needs_human`.
