# Phase 2: Set up the worktree, rebase, fix conflicts

Ends with a `WORKTREE` rebased on fresh `origin/main` and pushed if needed, and the flags applied.

```sh
start.sh <pr> <HEAD BRANCH>
```

It reuses a clean worktree already holding the branch (e.g. `dev-build`'s, or a blocked run's) or creates `<root>-wt/pr-<pr>`, rebases on freshly fetched `origin/main` and installs deps. It never pushes, resets or deletes. Read the `KEY=value` lines at the end:

- **Exit 3 (refused):** a dirty or mid-rebase worktree, a local branch diverged from `origin`, or a path holding something else. Someone's work may be there: report and stop; never delete, reset or stash to get past it.
- **Exit 4, `REBASE=conflicts`:** the worktree is left mid-rebase. Spawn the **Conflict resolver** with the `CONFLICTS` list. If it reports blocked and its `QUESTION` is one the Advisor may take, ask it and spawn the resolver again with the decision. On `needs_human`: `git -C <worktree> rebase --abort`, then **Blocked** ([reference/blocked.md](../reference/blocked.md)). On `done`, check: `git -C <worktree> status` shows no rebase in progress and a clean tree, and `git -C <worktree> merge-base --is-ancestor origin/main HEAD` succeeds. Then push (below) and rerun `start.sh` (before the push the rebased branch has diverged from `origin` and `start.sh` refuses it).
- **`REBASE=clean`, `up-to-date`:** go on.

Keep `WORKTREE`. If `PUSH_NEEDED=yes`, push now, before anything else runs: `git -C <worktree> push --force-with-lease origin <HEAD BRANCH>`. Never force-push without `--force-with-lease`; never push to `main`.

## Flags

If `SENSITIVE=yes` (script) or `SENSITIVE: yes` (Triage), add the `review:sensitive` label if missing ([sensitive paths](../../../../docs/conventions/git-workflow.md#sensitive-paths)); the security reviewer then runs at high effort.

If `AGENT_RULES=yes` or `AGENT RULES: yes`, the PR changes agent rules or CI: review, fix and get CI green as usual, but in phase 6 do not merge: post the Review comment saying it waits for a human approval ([git-workflow.md §7 rule 7](../../../../docs/conventions/git-workflow.md#7-rules-for-ai-agent-authored-changes)), leave the card at `In review`, report and stop.

Then go to [phase 3](3-review.md).
