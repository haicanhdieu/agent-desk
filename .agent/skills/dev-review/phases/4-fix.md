# Phase 4: Fix, then re-review

Done by **Fixers** (prompt: [prompts/fixer.md](../prompts/fixer.md)), one group at a time; the five **reviewers** per staged diff ([prompts/reviewer.md](../prompts/reviewer.md), diff review fill); then the **Verifier** ([prompts/verifier.md](../prompts/verifier.md)). You read every staged diff and commit. Ends with the fixes pushed and a new round at [phase 3](3-review.md), or, after round 3, [phase 5](5-ci.md).

## 1. Dispatch the fixers

Take the checker's `GROUPS` (by file area, at most about 5 findings each, most severe first; `behavior` for any critical or high or a behavior-changing medium, `mechanical` for renames, log text, comments or stories); adjust if your checks changed a finding. Dispatch one **Fixer** per group, **one at a time**, in order. Pass each finding with your evidence (as a claim for the fixer to re-check), the checked fix and its checklist. Each fixer makes the smallest change that resolves its findings, test first where the finding is a bug or changes behavior, and **stages it without committing**.

**Copy the prompt, do not rewrite it.** Take the block word for word and fill only the `<…>` slots. Subagents never see `using-superpowers`, so a paraphrase like "use TDD" means the skill won't load. **Before every spawn**, check the filled prompt contains these strings, and fix it if one is missing:

- Fixer: `call the Skill tool with skill` followed by `"superpowers:test-driven-development"` (that line wraps; check the skill name is there).
- CI fixer ([phase 5](5-ci.md)): `call the Skill tool with skill "superpowers:systematic-debugging"`.

## 2. Check each fixer reply

**Check each fixer reply.** `SKILLS:` is self-reported, not proof alone. In a `behavior` group, every fixed finding that is a bug or changes behavior needs `superpowers:test-driven-development` in `SKILLS:` and a test in the staged diff (`git -C <worktree> diff --staged --stat`). If either is missing, re-dispatch once with "You did not follow superpowers:test-driven-development. Load it now with the Skill tool, check your work against it, and redo what does not comply." A second miss is a technical failure.

**Fixers re-verify; they do not obey.** A reviewer's finding, the checker's keep and your own read can all be wrong, so each fixer first applies the [validity test](../reference/severity.md#validity-test-before-anyone-fixes-a-finding) (real; violates a named requirement, rule, convention or standard; in scope with a safe fix) and fixes only the findings that pass. Pass your evidence as a claim to re-check, never as a ruling. Check the `ASSESSMENT`: every finding in the group appears once as valid, declined or unsure, with a rule or requirement named and a file:line or test.

- **`DECLINED`:** accept only if the evidence holds when you open it yourself (the cited file:line, the test output, the rule text). Accepted: the finding is closed; record it with its reason in the next Review comment and the report. Not accepted: re-dispatch the same fixer **once** with your counter-evidence. Still declined and you still disagree, or you can't tell: ask the Advisor ([reference/decisions.md](../reference/decisions.md)).
- **`UNSURE`:** read the code and rule yourself; settle it (fix via a re-dispatch, or close as declined) or ask the Advisor.
- **A fixer that changes code for a finding it did not assess**, or whose diff has a hunk tracing to no valid finding, fails the check: re-dispatch once with "You must assess each finding before you change code; remove the hunks for findings you did not find valid."
- **A group whose findings are all declined** has an empty staged diff. Skip its diff review and commit; it still counts toward the round's findings record.

## 3. Review each staged diff, then commit

**Nothing is committed until it has passed review as a diff.** Per group, in order:

1. **Fixer self-review.** Before returning, the fixer walks its staged diff against the phase 3 checklist and the five dimensions (requirements, quality, architecture, performance, security), item by item, reporting each check with the line it looked at. Every new mechanism gets a failure-case pass: concurrency, empty and very large inputs, partial failure and retries, bounds, tenancy, tooling behavior.
2. **Your read.** Read the whole staged diff yourself (`git -C <worktree> diff --staged`), not the fixer's summary; it is small and you own the commit. `devbox run fix` only checks format. Answer each:
   - Does every hunk trace to a finding the fixer assessed as valid?
   - Does it agree with the rest of the spec, plan and code? Search for the names it touches.
   - Is every tooling claim in it one you verified in phase 3?
   - Is every new mechanism the smallest that closes the finding, with bounds, failure cases and tests stated?
3. **Diff review.** Dispatch the five reviewers on the staged diff only, same tier and effort as round 1: does the fix resolve its finding, and does it add a defect of medium or above? Verify each medium-or-above they report yourself, as in phase 3. One that holds goes back to the same fixer, which amends the staged diff.
4. **Commit** only when 2 and 3 are clean: `devbox run fix` until `fix: clean.`, then commit (`fix(<pkg>): address review: <summary>`), one commit per group. At most 2 amend loops. If medium or above findings remain after that, discard the diff (`git -C <worktree> restore --staged --worktree -- <files>`), don't commit it, and record the original finding as a known limitation in the PR body (docs: also one line in the doc). Never push an unreviewed or failing fix.

## 4. Verify

When every group is committed (or discarded), spawn the **Verifier** ([prompts/verifier.md](../prompts/verifier.md)): `devbox run fix`, `typecheck` and `test` per touched package, output copied verbatim; it fixes nothing. Decide from exit codes and output, not words: `fix` prints `fix: clean.`, every exit code is 0, `TREE CLEAN AFTER` is `yes`, `HEAD` matches `git -C <worktree> rev-parse HEAD`. The `low` Verifier can copy wrongly: rerun one command yourself (the package test of the main change) and confirm. A failure goes to the fixer of the group whose files it names, as a new staged fix under the same four steps; then the Verifier runs again. If this round's second run still fails, revert, don't deepen: `git revert` the fix commits the failure points to (all of this round's if unclear), and run the Verifier once more to confirm the head is green. A reverted medium becomes a known limitation in the PR body; a reverted critical or high, or a head still red after the revert, is a stop condition: ask the Advisor with the verbatim failing command and its last lines. Never push a failing head.

## 5. Push and re-review

Push (`git -C <worktree> push --force-with-lease origin <HEAD BRANCH>`) and go back to **[phase 3](3-review.md)** for a new round. Re-review all five dimensions (a fix can break another). From round 2, reviewers check only the fixes (does each resolve its finding, did it add a defect), with the same tier and effort as round 1 ([prompts/README.md](../prompts/README.md)).

**Revert, don't deepen.** A round 2+ finding of medium or above caused by a fix: don't stack another fix on it; `git revert` that fix's commit and record the original finding as a known limitation in the PR body. A critical or high that can't be fixed cleanly is a stop condition: ask the Advisor first.

After round 3, any medium or above left comes from a fix, by this rule: revert it, note the limitation, continue to [phase 5](5-ci.md). If a critical or high is left, ask the Advisor (stop condition); **Blocked** ([reference/blocked.md](../reference/blocked.md)) with the open findings only on its `needs_human`.

## Docs-only PRs

**Docs-only PRs** (spec, plan, ADR): typecheck and tests prove nothing, so your diff read is the only gate; the Verifier still runs `devbox run fix`. A fix rewords, corrects or removes lines, or adds only what the finding needs, proportional to it. The ~800-line PR limit covers docs too, so a fix round must not leave the PR much bigger.
