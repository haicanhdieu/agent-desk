# Phase 6: Merge

Done by you. Ends with the PR `MERGED`; then [phase 7](7-qa-hand-off.md).

You merge, after checking every gate yourself on the current head, right before merging. Never from an agent's report.

1. **Not an agent-rules or CI PR:** `flags.sh <worktree>` says `AGENT_RULES=no` (a fix may have added such a file) and Triage said `AGENT RULES: no`. Otherwise no merge ([phase 2 › Flags](2-set-up.md#flags)).
2. **Review clean:** the last review round left no critical, high or medium.
3. **Up to date:** `git -C <worktree> fetch origin main` then `git -C <worktree> merge-base --is-ancestor origin/main HEAD` succeeds, and `gh pr view <pr> --json headRefOid --jq .headRefOid` equals `git -C <worktree> rev-parse HEAD`.
4. **CI green on that head:** your own `gh pr checks <pr>` shows every check passed.

```sh
gh api repos/{owner}/{repo}/branches/main/protection --jq '.required_status_checks.checks | length' 2>/dev/null
```

- **Required checks configured (non-zero):** `gh pr merge <pr> --squash --auto --delete-branch`, then watch until it merges.
- **None (zero or no protection):** auto-merge would not wait, so wait yourself: confirm `gh pr checks <pr>` all green on the current head, then `gh pr merge <pr> --squash --delete-branch`.

The squash title is the PR title (Conventional Commits). Then confirm:

```sh
gh pr view <pr> --json state,mergeCommit --jq '.state + " " + .mergeCommit.oid'   # must say MERGED
```

If `main` moved and the merge is refused as out of date, go back to [phase 5](5-ci.md).
