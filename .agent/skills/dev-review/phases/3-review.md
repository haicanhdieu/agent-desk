# Phase 3: Review

Ends with the Review comment posted and either findings to fix ([phase 4](4-fix.md)) or none of medium or above ([phase 5](5-ci.md)).

## 1. Reviewers

Spawn the **five reviewers in parallel** (one message, five Agent calls: requirements, quality, architecture, performance, security), each with its `DIMENSION`, the issue number and Triage's `REQUIREMENT SOURCES`. Each reads the diff and issue itself. Each replies with a JSON list of findings; save each to a scratchpad file.

From round 2, reviewers check only the fixes, with the same tier and effort as round 1: `MODE` is `round 2+` with the last reviewed sha and the scratchpad file of earlier findings, their evidence and how each was resolved. Rounds 2–3 cost less through scope, not effort, so findings converge instead of shifting with reviewer depth.

## 2. Findings checker

Then spawn the **Findings checker** with the five reply paths. It runs alone in the worktree and changes nothing. It drops duplicates, checks every critical, high and medium against the code and [severity.md](../reference/severity.md), checks each suggested fix against how this repo's tooling really runs, names the checklist each fix must meet, and groups the kept findings for the fixers.

## 3. Your check

**You still verify every critical, high and medium before any fixer sees it**; the checker's evidence makes that fast:

1. **Nothing lost.** Every medium-or-above reviewer finding appears exactly once in `KEPT`, `LOWERED`, `DROPPED`, `DUPLICATES` or `UNSURE`. Count against the five files.
2. **Every kept one holds.** For each critical, high and medium in `KEPT`, open the cited file:line and confirm the scenario happens there. Note your evidence (file:line read, command run).
3. **Every drop and every downgrade below medium holds** (`DROPPED`, `LOWERED`). A wrong drop ships a defect: open its evidence and confirm. If you disagree, keep the finding at the reviewer's severity.
4. **Every tooling claim holds.** For each `checked_fix` relying on tool behavior, open the repo file it names and confirm.
5. **`UNSURE`.** Read the code and rule. If you still can't tell, two reviewers disagree and no rule settles it, or a finding has two fixes that both meet the rules and no rule picks one, ask the Advisor ([reference/decisions.md](../reference/decisions.md)). Never ask it to lower a finding you have verified.

## 4. Post

A fix that adds a mechanism is allowed when the finding needs one, held to the same checklist the reviewers apply. Then post the **Review** comment ([templates/comments.md](../templates/comments.md#review-on-the-pr-once-per-round)) with `gh pr comment`. Lows are listed there and not fixed.

No critical, high or medium left: go to [phase 5](5-ci.md). Otherwise go to [phase 4](4-fix.md).
