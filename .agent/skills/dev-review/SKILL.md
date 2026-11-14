---
name: dev-review
description: Use when asked to review, fix up, get green, or merge a pull request, when a PR has review findings, merge conflicts or failing CI, or when /dev-review is invoked with a PR number, PR URL or issue number.
---

# Review, fix and merge a PR

You are the review orchestrator. You take one PR to `main`, review it on four dimensions with subagents, get every critical, high and medium finding fixed and re-reviewed, resolve merge conflicts, get CI green, merge it, and move its issue to **QA** on the [project board](https://github.com/users/haicanhdieu/projects/4/views/1).

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

Dispatch the **four reviewers in parallel**, one message with four Agent calls (code quality, architecture, performance, security). Each gets the diff, the issue text, the linked spec or plan, the convention files for its dimension, and [severity.md](severity.md). Each replies with a JSON list of findings.

Then merge their lists yourself:

1. Drop duplicates (same file, same line range, same problem); keep the higher severity.
2. Check every critical and high against the code. Drop it if the failure scenario does not hold; lower it if it holds but the severity is wrong. Say which you dropped or changed and why.
3. Post the **Review** comment from [comments.md](comments.md) with `gh pr comment`. Low findings are listed there and not fixed.

No critical, high or medium findings left: go to step 5.

### 4. Fix, then re-review

Group the critical, high and medium findings by file area. Dispatch one **Fixer** per group, **one at a time** (they share the worktree), most severe group first. Each fixes only its findings, test first where the finding is a bug, and commits.

A fixer may decline a finding with evidence (a test, a spec line). Accept the decline only if the evidence holds; record it in the next Review comment.

Then verify in the worktree and read the output yourself:

```sh
devbox run fix                                    # must print "fix: clean."
pnpm --filter @agentdesk/<pkg> typecheck          # once per touched package
pnpm --filter @agentdesk/<pkg> test
```

Push (`git push --force-with-lease`) and go back to **step 3** for a new round. Re-review all four dimensions: a fix can break another one.

After round 3, if critical, high or medium findings remain: do **Blocked** with the open findings and stop.

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

1. If the PR used `Closes`/`Fixes` and the issue was closed by the merge, reopen it: `gh issue reopen <n>`. QA closes it, not the merge.
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

| Thought                                             | Reality                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| "It's only medium, merge and fix later"             | Critical, high and medium are fixed before merge. Only low is left.              |
| "One reviewer is enough for a small PR"             | Four dimensions, every round. Small PRs make cheap reviews.                      |
| "Re-review only the dimension that had findings"    | A fix can break another dimension. Re-review all four.                           |
| "CI is flaky, re-run until green"                   | A flaky gate is a bug. Block with the evidence.                                  |
| "Mark the failing test skip / loosen the lint rule" | Never weaken a check to pass. Fix the cause or block.                            |
| "Auto-merge is on, so I can enable it and leave"    | Without required checks, auto-merge doesn't wait for CI. Check protection first. |
| "Rebase conflict, take ours"                        | Keep both sides' intent, or block. Never drop `main`'s changes blindly.          |
| "Round 3 still has findings, but they're minor"     | Then they're low. If they're medium or above, block.                             |
| "The fixer disagreed, so drop the finding"          | Only with evidence that holds. Record it.                                        |
