# Phase 3: Review

Done by five **reviewers** in parallel (prompt: [prompts/reviewer.md](../prompts/reviewer.md)), then the **Findings checker** ([prompts/findings-checker.md](../prompts/findings-checker.md)); you verify and post. Ends with the Review comment posted and either findings to fix ([phase 4](4-fix.md)) or none of medium or above ([phase 5](5-ci.md)).

## 1. Reviewers

Dispatch the **five reviewers in parallel** (one message, five Agent calls: requirements, code quality, architecture, performance, security). Each gets the issue number, Triage's `REQUIREMENT SOURCES`, its dimension's convention files and [severity.md](../reference/severity.md); each reads the diff and issue itself, so never paste PR or issue text into a prompt. Each replies with a JSON list of findings; save each to a scratchpad file.

The **requirements** reviewer checks the PR fully implements what it was built from: the linked issue (body, acceptance criteria, comments) and every spec or plan the PR body or issue links, or the PR adds or changes. It maps each requirement to code and a test; one with no implementation is a finding. With no issue and no spec or plan it returns an empty list.

## 2. Findings checker

Then spawn the **Findings checker** ([prompts/findings-checker.md](../prompts/findings-checker.md)) with the five reply paths. Independent of the reviewers, it runs alone in the worktree and changes nothing. It drops duplicates (same file, same line range, same problem; higher severity wins); checks every critical, high and medium against the code and [severity.md](../reference/severity.md) (including its docs rule) with evidence; checks each suggested fix against how this repo's tooling really runs (migrations and the drizzle migrator, k8s, Temporal, CI, devbox; e.g. `packages/db/src/migrate.ts` applies all pending migrations in one transaction, so `CREATE INDEX CONCURRENTLY` cannot work there) and replaces a fix that fails; names the checklist each fix must meet (convention files and severity rules: a migration `database.md` §5, a lock or transaction `database.md` §6, and so on); and groups the kept findings for the fixers. When unsure it keeps the finding under `UNSURE`; it never drops one it could not rule out.

## 3. Your check

**Check its reply yourself. You still verify every critical, high and medium before any fixer sees it**; the checker's evidence makes that fast:

1. **Nothing lost.** Every medium-or-above reviewer finding appears exactly once in `KEPT`, `LOWERED`, `DROPPED`, `DUPLICATES` or `UNSURE`. Count against the five files.
2. **Every kept one holds.** For each critical, high and medium in `KEPT`, open the cited file:line and confirm the scenario happens there. Note your evidence (file:line read, command run).
3. **Every drop and every downgrade below medium holds** (`DROPPED`, `LOWERED`). A wrong drop ships a defect: open its evidence and confirm. If you disagree, keep the finding at the reviewer's severity.
4. **Every tooling claim holds.** For each `checked_fix` relying on tool behavior, open the repo file it names and confirm.
5. **`UNSURE`.** Read the code and rule. If you still can't tell, two reviewers disagree and no rule settles it, or a finding has two fixes that both meet the rules and no rule picks one, ask the Advisor ([reference/decisions.md](../reference/decisions.md)). Never ask it to lower a finding you have verified.

## 4. Post

A fix that adds a mechanism is allowed when the finding needs one, held to the same checklist the reviewers apply. Then post the **Review** comment ([templates/comments.md](../templates/comments.md#review-on-the-pr-once-per-round)) with `gh pr comment`. Lows are listed there and not fixed.

No critical, high or medium left: go to [phase 5](5-ci.md). Otherwise go to [phase 4](4-fix.md).
