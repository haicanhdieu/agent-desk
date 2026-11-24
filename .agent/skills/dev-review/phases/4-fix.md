# Phase 4: Fix, then re-review

Ends with the fixes pushed and a new round at [phase 3](3-review.md), or, after round 3, [phase 5](5-ci.md).

## 1. Spawn the fixers

Take the checker's `GROUPS` (by file area, at most about 5 findings each, most severe first; `behavior` or `mechanical`); adjust if your checks changed a finding. Write each group's findings to a scratchpad file: each finding with your evidence (as a claim for the fixer to re-check), the checked fix and its checklist. Spawn one **Fixer** per group, **one at a time**, in order (effort `medium` for a behavior group, `low` for a mechanical one). Each fixer makes the smallest change that resolves its findings, test first where the finding is a bug or changes behavior, and **stages it without committing**. It runs only `devbox run fix` and the tests it wrote or changed; `verify.sh` (step 4) is the one gate for the round.

## 2. Check each fixer reply

`SKILLS:` is self-reported, not proof alone. In a `behavior` group, every fixed finding that is a bug or changes behavior needs `superpowers:test-driven-development` in `SKILLS:` and a test in the staged diff (`git -C <worktree> diff --staged --stat`). If either is missing, spawn it once more with `NOTE: You did not follow superpowers:test-driven-development. Load it now with the Skill tool, check your work against it, and redo what does not comply.` A second miss is a technical failure.

**Fixers re-verify; they do not obey.** A reviewer's finding, the checker's keep and your own read can all be wrong, so each fixer first applies the [validity test](../reference/severity.md#validity-test-before-anyone-fixes-a-finding) and fixes only the findings that pass. Check the `ASSESSMENT`: every finding in the group appears once as valid, declined or unsure, with a rule or requirement named and a file:line or test.

- **`DECLINED`:** accept only if the evidence holds when you open it yourself (the cited file:line, the test output, the rule text). Accepted: the finding is closed; record it with its reason in the next Review comment and the report. Not accepted: spawn the same fixer **once** more with your counter-evidence. Still declined and you still disagree, or you can't tell: ask the Advisor ([reference/decisions.md](../reference/decisions.md)).
- **`UNSURE`:** read the code and rule yourself; settle it (fix via a re-spawn, or close as declined) or ask the Advisor.
- **A fixer that changes code for a finding it did not assess**, or whose diff has a hunk tracing to no valid finding, fails the check: spawn it once more with `NOTE: You must assess each finding before you change code; remove the hunks for findings you did not find valid.`
- **A group whose findings are all declined** has an empty staged diff. Skip its diff review and commit; it still counts toward the round's findings record.

## 3. Review each staged diff, then commit

**Nothing is committed until it has passed review as a diff.** Per group, in order:

1. **Fixer self-review:** its `SELF_REVIEW` reports each checklist item and dimension with the line it looked at, and a failure-case pass for every new mechanism.
2. **Your read.** Read the whole staged diff yourself (`git -C <worktree> diff --staged`), not the fixer's summary; it is small and you own the commit. Answer each:
   - Does every hunk trace to a finding the fixer assessed as valid?
   - Does it agree with the rest of the spec, plan and code? Search for the names it touches.
   - Is every tooling claim in it one you verified in phase 3?
   - Is every new mechanism the smallest that closes the finding, with bounds, failure cases and tests stated?
3. **Diff review.** Spawn **one reviewer** on the staged diff only, with `DIMENSION: all` (it covers all five dimensions; effort `medium`, `high` when the PR is `review:sensitive`) and `MODE: staged` with the group's findings file: does the fix resolve its finding, and does it add a defect of medium or above? Verify each medium-or-above it reports yourself, as in phase 3. One that holds goes back to the same fixer, which amends the staged diff. The next round's five reviewers look at every fix again.
4. **Commit** only when 2 and 3 are clean: `devbox run fix` until `fix: clean.`, then commit (`fix(<pkg>): address review: <summary>`), one commit per group. At most 2 amend loops. If medium or above findings remain after that, discard the diff (`git -C <worktree> restore --staged --worktree -- <files>`), don't commit it, and record the original finding as a known limitation in the PR body (docs: also one line in the doc). Never push an unreviewed or failing fix.

## 4. Verify

When every group is committed (or discarded), run the gate yourself (it takes several minutes; background is fine):

```sh
verify.sh <worktree> origin/main > <scratchpad>/verify-r<k>.log 2>&1; echo "exit=$?"
grep -E '^(HEAD|PACKAGES|COMMAND|EXIT|FAIL|TREE CLEAN AFTER|VERIFY):' <scratchpad>/verify-r<k>.log
```

Green only when: exit 0, `VERIFY: PASS`, every `EXIT:` is 0, no `FAIL:` line, `TREE CLEAN AFTER: yes`, and `HEAD` equals `git -C <worktree> rev-parse HEAD`. Never run its commands again yourself. A failure (read its block in the log) goes to the fixer of the group whose files it names, as a new staged fix under the same steps; then run it again. If this round's second run still fails, revert, don't deepen: `git revert` the fix commits the failure points to (all of this round's if unclear), and run it once more to confirm the head is green. A reverted medium becomes a known limitation in the PR body; a reverted critical or high, or a head still red after the revert, is a stop condition: ask the Advisor with the verbatim failing command and its last lines. Never push a failing head.

## 5. Push and re-review

Push (`git -C <worktree> push --force-with-lease origin <HEAD BRANCH>`) and go back to **[phase 3](3-review.md)** for a new round. Re-review all five dimensions (a fix can break another).

**Revert, don't deepen.** A round 2+ finding of medium or above caused by a fix: don't stack another fix on it; `git revert` that fix's commit and record the original finding as a known limitation in the PR body. A critical or high that can't be fixed cleanly is a stop condition: ask the Advisor first.

After round 3, any medium or above left comes from a fix, by this rule: revert it, note the limitation, continue to [phase 5](5-ci.md). If a critical or high is left, ask the Advisor (stop condition); **Blocked** ([reference/blocked.md](../reference/blocked.md)) with the open findings only on its `needs_human`.

## Docs-only PRs

A spec, plan or ADR: typecheck and tests prove nothing, so your diff read is the only gate; `verify.sh` still runs `fix`. A fix rewords, corrects or removes lines, or adds only what the finding needs, proportional to it. The ~800-line PR limit covers docs too, so a fix round must not leave the PR much bigger.
