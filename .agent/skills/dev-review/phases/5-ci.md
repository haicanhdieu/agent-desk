# Phase 5: Get CI green

Ends with every check green on the current head, confirmed by your own `gh pr checks`; then [phase 6](6-merge.md).

1. If `main` moved, rerun `start.sh <pr> <HEAD BRANCH>`: conflicts follow [phase 2](2-set-up.md); push if `PUSH_NEEDED=yes`.
2. `gh pr ready <pr>` if it is a draft.
3. Spawn the **CI watcher** with the expected head (`git -C <worktree> rev-parse HEAD`). It waits for every check and returns each check's result and, per failure, the run id, the failed-log tail, and how the same job did on the latest `main` run. It changes nothing.

Check its reply: `HEAD` must be the head you gave. If all green, confirm with your own `gh pr checks <pr>`; never decide green from its words. On a failure, classify it from the log tails (read more with `gh run view <run-id> --log-failed` if needed):

- **Format or lint only:** run `devbox run fix` yourself, commit, push, watch again. No agent.
- **Caused by this PR:** save the log tail to a scratchpad file and spawn the **CI fixer** with the failing job and that file. Check its reply: `SKILLS:` lists `superpowers:systematic-debugging`, `git -C <worktree> log --stat <head before>..HEAD` shows its commit, and its diff has no skipped or deleted test, no `@ts-ignore`, `any` or lint disable, no touched threshold, baseline or config. Then `verify.sh` ([phase 4](4-fix.md) step 4), push, watch again.
- **Anything else is caused by this PR.** `main` is green and the PR merges into it, so a red check is this branch's (its code, a stale base, or a shared fixture, snapshot, type or coverage floor it moved), even if the failing test is in a file the PR never touched. Never write "unrelated" or "pre-existing" unless proven: `gh run list --branch main --workflow <workflow> --limit 3 --json conclusion,headSha` shows `main` red on that job. Even then the CI fixer fixes it (the PR may carry the fix) and the Advisor is told so.
- **Flaky test:** a failure, not an excuse. The CI fixer makes it deterministic. Don't re-run until green.
- **Infra error only** (job never started, runner lost, a third-party call timed out, nothing about the code in the log): re-run that one job once (`gh run rerun <run-id> --failed`) and note it in the judgment calls. A second infra failure of the same job is a stop condition (Advisor).

Limit: 6 CI fix attempts, then one last CI fixer at `high` effort given every earlier attempt's log tail and diff summary as `ATTEMPTS` ("did not work"). If that is red too, it is a stop condition: ask the Advisor ([reference/decisions.md](../reference/decisions.md)) with the job, last log tail and each attempt; **Blocked** only on its `needs_human`.

A code change here (a CI fix, or a rebase that needed the Conflict resolver) gets one more review round ([phase 3](3-review.md)) only if it touched production code the PR had not already changed and a round remains; otherwise go to [phase 6](6-merge.md) and name the fix in the report. A missing review round never blocks a CI fix.
