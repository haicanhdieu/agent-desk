---
name: dev-review
description: Use when asked to review, fix up, get green, or merge a pull request, when a PR has review findings, merge conflicts or failing CI, or when /dev-review is invoked with a PR number, PR URL or issue number.
---

# Review, fix and merge a PR

You are the review orchestrator. You take one PR to `main`, review it on five dimensions with subagents, get every critical, high and medium finding fixed and re-reviewed, resolve merge conflicts, get CI green, merge it, and move its issue to **QA** on the [project board](https://github.com/users/haicanhdieu/projects/4/views/1).

This is the **review and merge** step of build → review and merge → QA test → done. Columns, labels and who moves what: [docs/runbooks/dev-workflow.md](../../../docs/runbooks/dev-workflow.md).

The run needs no human in the loop. When you need a human decision, post it on the PR, set the issue to **Blocked**, and stop.

## Input

A PR number or URL, or an issue number (use its open PR). If none is given, ask for one. Ask nothing else.

## Files

| File                                 | Use                                                             |
| ------------------------------------ | --------------------------------------------------------------- |
| [severity.md](severity.md)           | What critical, high, medium and low mean. Reviewers apply it    |
| [agent-prompts.md](agent-prompts.md) | Prompt, tier and effort for reviewers, fixers and the CI fixer  |
| [comments.md](comments.md)           | The review comment, issue comments and blocked comment          |
| `../dev-build/scripts/board.sh`      | Move the issue's card and swap its `status:*` label in one call |

`board.sh` below means `bash <main checkout>/.agent/skills/dev-build/scripts/board.sh`. Never set the board or a `status:*` label by hand.

**GitHub access.** If a `gh` or `git push` call fails with 403 or "not found", retry that one command with a token for an account that can write (`GH_TOKEN=$(gh auth token --user <login>) …`). Never run `gh auth switch` or `gh auth setup-git`, and never print or store the token.

Write comment bodies and finding files to your scratchpad (or `mktemp`), never into the repo.

## Steps

Create a todo per step. Do not skip or reorder them. Count review rounds; the limit is **3** per run, in total (CI or conflict fixes do not reset it).

### 1. Load the PR

```sh
gh pr view <pr> --json number,title,body,state,isDraft,baseRefName,headRefName,labels,mergeable,mergeStateStatus,files,url
gh pr checks <pr>
```

- Stop and report if it is closed or merged, or its base is not `main`.
- **Issue:** the `Refs|Closes|Fixes|Resolves #<n>` in the body. No issue: continue, and skip every board step.
- If the issue's card is not `In review`, run `board.sh status <n> "In review"`.
- **Sensitive:** the PR touches a [sensitive path](../../../docs/conventions/git-workflow.md#sensitive-paths) (check `files`). Add the label `review:sensitive` if missing. The security reviewer then runs at high effort.
- **Agent rules or CI:** the PR changes `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.agent/skills/`, `.github/workflows/`, `CODEOWNERS`, branch protection, `coverage-thresholds.json`, `coverage-baseline.json`, `scripts/coverage-*.ts` or a vitest/vite config (`vitest.config.ts`, `vite.config.ts`). Review, fix and get CI green as usual, but in step 6 do not merge: post the Review comment saying it waits for a human approval ([git-workflow.md §7 rule 7](../../../docs/conventions/git-workflow.md#7-rules-for-ai-agent-authored-changes)), leave the card at `In review`, report and stop.

### 2. Set up the worktree, rebase, fix conflicts

```sh
root=$(git rev-parse --show-toplevel)
git fetch origin main <head>
git worktree add "$root-wt/pr-<pr>" -B <head> origin/<head>
cd "$root-wt/pr-<pr>" && git rebase origin/main
```

If `git worktree list` shows the branch already checked out (for example by `dev-build`) and that worktree is clean, use that one instead. Install deps in the worktree (`pnpm install` inside `devbox shell`). If the rebase stops on conflicts, dispatch the **Conflict resolver** ([agent-prompts.md](agent-prompts.md)). It keeps both sides' intent; when the two sides contradict and the right answer is a product decision, it reports blocked: `git rebase --abort`, then do **Blocked** (below).

After a clean rebase, `git push --force-with-lease`. Never force-push without `--force-with-lease`, and never push to `main`.

### 3. Review

Get the inputs once: `git diff origin/main...HEAD`, the linked issue (`gh issue view <n> --comments`), and any spec or plan the PR or issue links.

Dispatch the **five reviewers in parallel**, one message with five Agent calls (requirements, code quality, architecture, performance, security). Each gets the diff, the issue text, the linked spec or plan, the convention files for its dimension, and [severity.md](severity.md). Each replies with a JSON list of findings.

The **requirements** reviewer checks that the PR fully implements what it was built from: the linked issue (body, acceptance criteria, comments) and every spec or plan the PR body or issue links, or that the PR adds or changes. Find them in step 1 (the `Refs|Closes|Fixes|Resolves` issue, links in the issue and PR body, `docs/superpowers/{specs,plans}/` paths). It lists each requirement and maps it to code and a test; a requirement with no implementation is a finding. With no issue and no spec or plan it returns an empty list.

Then merge their lists yourself:

1. Drop duplicates (same file, same line range, same problem); keep the higher severity.
2. **Verify every critical, high and medium yourself** before any fixer sees it. Drop it if the failure scenario does not hold; lower it if the severity is wrong ([severity.md](severity.md), including its docs rule). Note the evidence for each one you keep (file:line you read, command you ran).
3. **Check the suggested fix too.** If it relies on how tooling behaves (migrations and the drizzle migrator, k8s, Temporal, CI, devbox), read how this repo actually runs it before accepting it. Example: `packages/db/src/migrate.ts` applies all pending migrations in one transaction, so `CREATE INDEX CONCURRENTLY` cannot work there. Replace a fix that fails this check.
4. **Name the checklist for each fix.** For every finding you keep, list the convention files and [severity.md](severity.md) rules a fix to it must satisfy (for a migration: `database.md` §5; for a lock or transaction: `database.md` §6; and so on). The fixer gets this list and must meet it ([agent-prompts.md](agent-prompts.md)). A fix that adds a mechanism is allowed when the finding needs one, but it is held to the same checklist the reviewers will apply.
5. Post the **Review** comment from [comments.md](comments.md) with `gh pr comment`. Low findings are listed there and not fixed.

No critical, high or medium findings left: go to step 5.

### 4. Fix, then re-review

Group the verified critical, high and medium findings by file area, at most about 5 findings per group. Dispatch one **Fixer** per group, **one at a time** (they share the worktree), most severe group first. Pass each finding with your evidence and the fix you checked in step 3. Each fixer makes the smallest change that resolves its findings, test first where the finding is a bug, and **stages it without committing**.

A fixer may decline a finding with evidence (a test, a spec line). Accept a decline only if the evidence holds; record it in the next Review comment.

**Nothing is committed until it has passed review as a diff.** For each group, in order:

1. **Fixer self-review.** Before it returns, the fixer walks its own staged diff against the checklist from step 3.4 and the five dimensions (requirements, quality, architecture, performance, security), item by item, and reports each check with the line it looked at. Every new mechanism gets a failure-case pass: concurrency, empty and very large inputs, partial failure and retries, bounds, tenancy, tooling behavior.
2. **Your read.** Read the whole staged diff yourself (`git diff --staged`), not the fixer's summary. `devbox run fix` only checks format. Answer each:
   - Does every hunk trace to one of this group's findings?
   - Does it agree with the rest of the spec, plan and code? Search for the names it touches.
   - Is every tooling claim in it one you verified in step 3?
   - Is every new mechanism the smallest one that closes the finding, with its bounds, failure cases and tests stated?
3. **Diff review.** Dispatch the five reviewers on the staged diff only, with the same tier and effort as round 1. Their job: does the fix resolve its finding, and does it add a defect of medium or above? A finding on the fix goes back to the same fixer, which amends the staged diff.
4. **Commit** only when steps 2 and 3 are clean: `devbox run fix` until `fix: clean.`, then commit (`fix(<pkg>): address review: <summary>`), one commit per group. Allow at most 2 amend loops. If the diff still has medium or above findings after that, discard it (`git restore --staged --worktree -- <files>`), do not commit it, and record the original finding as a known limitation in the PR body (docs: also one line in the doc). Never push an unreviewed or failing fix.

Then verify in the worktree and read the output yourself:

```sh
devbox run fix                                    # must print "fix: clean."
pnpm --filter @agentdesk/<pkg> typecheck          # once per touched package
pnpm --filter @agentdesk/<pkg> test
```

Push (`git push --force-with-lease`) and go back to **step 3** for a new round. Re-review all five dimensions: a fix can break another one. From round 2, reviewers check only the fixes: does each one resolve its finding, and did it add a defect? Use the same tier and effort as round 1 ([agent-prompts.md](agent-prompts.md)).

**Revert, don't deepen.** If a round 2+ finding of medium or above comes from a fix, do not stack another fix on it. `git revert` that fix's commit and record the original finding as a known limitation in the PR body. A critical or high that cannot be fixed cleanly is **Blocked**.

After round 3, anything medium or above that is left comes from a fix by this rule: revert it and note the limitation, then continue to step 5. If a critical or high is left, do **Blocked** with the open findings and stop.

**Docs-only PRs** (spec, plan, ADR): typecheck and tests prove nothing here, so your diff read is the only gate. A fix rewords, corrects or removes lines, or adds what the finding needs and no more. Keep the added text proportional to the finding. The ~400-line PR limit covers docs too, so a fix round must not leave the PR much bigger than before it.

### 5. Get CI green

```sh
git fetch origin main && git rebase origin/main     # if main moved; conflicts → step 2 rules; then push
gh pr ready <pr>                                    # if it is a draft
gh pr checks <pr> --watch --fail-fast
```

On a failure, read the logs: `gh run view <run-id> --log-failed`. Then:

- **Format or lint only:** run `devbox run fix` yourself, commit, push, watch again. No agent.

- **Caused by this PR:** dispatch the **CI fixer** with the failing job and log excerpt. Verify (step 4 commands), push, watch again.
- **Not caused by this PR** (same job fails on `main`, infra error, flaky test): do not re-run until green. Do **Blocked**, naming the job and the evidence.

Limit: 3 CI fix attempts. Then **Blocked**.

Any code change here (CI fix, or a rebase that changed code) needs one more review round (step 3) if rounds remain; otherwise **Blocked**.

### 6. Merge

Merge only when: the PR is not an agent-rules/CI PR (step 1), the last review round had no critical, high or medium findings, CI is green on the current head, and the branch is up to date with `main`.

```sh
gh api repos/{owner}/{repo}/branches/main/protection --jq '.required_status_checks.checks | length' 2>/dev/null
```

- **Required checks configured (non-zero):** `gh pr merge <pr> --squash --auto --delete-branch`, then watch until it merges.
- **None configured (zero or no protection):** auto-merge would merge without waiting, so wait yourself: confirm `gh pr checks <pr>` is all green on the current head, then `gh pr merge <pr> --squash --delete-branch`.

The squash title is the PR title (Conventional Commits). Then confirm:

```sh
gh pr view <pr> --json state,mergeCommit --jq '.state + " " + .mergeCommit.oid'   # must say MERGED
```

If `main` moved and the merge is refused as out of date, go back to step 5.

### 7. Hand off to QA

1. The merge closes the issue through the PR's `Closes #<n>`. If it is still open (the PR body lacks a closing keyword), close it with `gh issue close <n>`. QA reopens it if the test fails.
2. `board.sh status <n> QA`.
3. Post the **Merged** comment from [comments.md](comments.md) on the issue.
4. Remove the worktree: `git worktree remove "$root-wt/pr-<pr>"`.
5. Report to the user: PR, rounds, findings fixed per severity, lows left, declined findings, CI result, merge commit, issue status.

## Blocked

1. Post the **Blocked** comment from [comments.md](comments.md) on the PR (plain language, at most 3 questions).
2. Push any work so it is not lost. Keep the worktree; the next run reuses it.
3. `board.sh status <n> Blocked` (skip if the PR has no linked issue).
4. Report to the user and stop. Do not merge.

## Red flags: stop

These hold even when the user says to hurry. Say so in your report and keep the rule.

| Thought                                             | Reality                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------- |
| "It's only medium, merge and fix later"             | Critical, high and medium are fixed before merge. Only low is left.               |
| "One reviewer is enough for a small PR"             | Five dimensions, every round. Small PRs make cheap reviews.                       |
| "Re-review only the dimension that had findings"    | A fix can break another dimension. Re-review all five.                            |
| "CI is flaky, re-run until green"                   | A flaky gate is a bug. Block with the evidence.                                   |
| "Mark the failing test skip / loosen the lint rule" | Never weaken a check to pass. Fix the cause or block.                             |
| "Auto-merge is on, so I can enable it and leave"    | Without required checks, auto-merge doesn't wait for CI. Check protection first.  |
| "Rebase conflict, take ours"                        | Keep both sides' intent, or block. Never drop `main`'s changes blindly.           |
| "Round 3 still has findings, but they're minor"     | Then they're low. If they're medium or above, block.                              |
| "The fixer disagreed, so drop the finding"          | Only with evidence that holds. Record it.                                         |
| "I checked the highs; the mediums are fine"         | Verify every critical, high and medium before it goes to a fixer.                 |
| "The reviewer says use X, that's standard"          | Check that this repo's tooling supports X (migrator, k8s, Temporal) first.        |
| "The fixer added a cap/lock/table, so it is fixed"  | Only after it passed the checklist and a diff review. Otherwise not applied.      |
| "Fix is clean and the fixer says done"              | `fix` checks format only. Read the staged diff against each finding.              |
| "Round 2 found a bug in my fix; fix it properly"    | Revert the fix. Don't add a fix on top of a fix.                                  |
| "It's a docs PR, a bit more detail can't hurt"      | Every added line is new surface. Add only what the finding needs, then review it. |
| "One fixer for all 17 findings is faster"           | Small groups, each diff checked and committed on its own.                         |
