# Phase 4: Verify

Ends with a green round on the current head (continue to [phase 5](5-open-pr.md)), or a stop.

A round, after the last builder:

1. **E2E verifier**, only when Triage's `E2E REQUIREMENTS` names a file (a spec or plan with a `## E2E requirements` section, as `dev-plan` writes). Spawn it first, alone in the worktree, and wait. **Never skip it**, in any round, for any reason (a red unit test, a long stack start, a hurry). It may commit fixes to e2e test code only.
2. Then, on the HEAD the E2E verifier reported, spawn the **Self-reviewer** and run **`verify.sh`** yourself at the same time, so an e2e test fix is linted, typechecked and reviewed in the same round. Do both even when the E2E verifier found product bugs, so the builder gets every failure at once. The Self-reviewer reads only from git, never from disk. With E2E requirements it gets `E2E_FILES` and checks every rule (`BR-<n>`) and case (`TC-<n.m>`) against the e2e specs and the product code; never pass `none` to drop that step when Triage named a file.

**No repeated checks.** Builders run only the tests they wrote. `verify.sh` is the one local gate; the PR agent reuses its result (create-pr preflight) and reruns nothing on the same head. Full suites and integration shards are CI's job.

## Run verify.sh

```sh
verify.sh <worktree> <base> > <scratchpad>/verify-r<k>.log 2>&1; echo "exit=$?"
grep -E '^(HEAD|PACKAGES|COMMAND|EXIT|FAIL|TREE CLEAN AFTER|VERIFY):' <scratchpad>/verify-r<k>.log
```

It runs `fix`, then lint and typecheck per touched package, then the tests scoped to the change, and takes several minutes (run it in the background). Never run its commands again yourself or substitute the full `pnpm test`. Green only when: exit 0, `VERIFY: PASS`, every `EXIT:` is 0, no `FAIL:` line, `TREE CLEAN AFTER: yes`, and `HEAD` equals `git -C <worktree> rev-parse HEAD`. On red, read the failing command's block in the log and give it to the builder verbatim. An integration test it calls unavailable (no container engine) is a failure, not passed.

**Bug only: the regression test must fail without the fix.** After `verify.sh` ends (in a runner pod, `. scripts/runner-env.sh` first):

```sh
git -C <worktree> checkout <base> -- <the fix's non-test source files>
(cd <worktree> && pnpm --filter @agentdesk/<pkg> exec vitest run <test file> -t "<test name>")   # must FAIL
git -C <worktree> checkout HEAD -- <those files> && git -C <worktree> status --porcelain          # must print nothing
```

Always run the third line, even if the first two went wrong. A test that passes without the fix proves nothing: the round is red.

## Read the E2E verifier's reply

- **PRODUCT_BUG:** goes to the builder that owns the code, like a `verify.sh` failure (fixed, not assessed), with the case id, its Expected text, the verbatim error and the file:line. Then a new round.
- **TEST_FIXES:** for each commit, open its diff (`git -C <worktree> show <sha>`) and the case. It touches only `apps/web/e2e/`, it moves the test toward the case's Given/Steps/Expected, and it does not loosen an assertion, delete a test, add skip/fixme/only or an unexplained timeout. A fix that fails this check is a product bug hidden by the test: revert it through the builder (`git revert <sha>`) and send the original failure as a PRODUCT_BUG.
- **TEST_ISSUE_UNFIXED:** a failed agent; spawn the E2E verifier once more with the error, then it is a stop condition for the Advisor.
- **ENV_ISSUE / ENV_BLOCKED:** a failed check, never passed. Spawn the E2E verifier once more with the evidence; still failing is a stop condition for the Advisor (it may rule how to free the stack; it never waives the run).
- **A partial run** (`NOT RUN` is not `none`, a `TEST LIST` title has no passed or failed line in `RESULTS`, or `MEMORY` shows a command that ended early with tests left): red, never "remaining cases not run". Memory, a killed process, a pod restart or a slow machine is never a reason to accept it. Spawn the E2E verifier again with the unrun titles in `RERUN`. Repeat until every test has a result; these re-runs do not count against the round cap. If the same single test still dies from memory alone on a fresh stack, it is a stop condition for the Advisor, which may rule how to make it fit (stop other processes, reorder the work, split the spec through the builder) but never waives it. If the run itself was resumed after a crash during this phase, spawn the E2E verifier for every test without a result on the current HEAD.
- Its `HEAD` must equal `git -C <worktree> rev-parse HEAD` and the HEAD `verify.sh` ran on; `STACK STOPPED` and `TREE CLEAN AFTER` are `yes`.

Then all of these hold, or the round is red:

- the Self-reviewer's `E2E COVERAGE` has a line for every case in the section (count the `TC-` ids yourself: `git -C <worktree> show HEAD:<file> | grep -c "^| TC-"`), and none says `no test`;
- every case marked `matches` names a test that the E2E verifier's `RESULTS` show as run and passed on that HEAD. A test the Self-reviewer cites but the E2E verifier did not run is not proven;
- the E2E verifier's `SKIP GREP` is empty, and its `SPECS` is not "no e2e spec added or changed on this branch";
- its `NOT RUN` is `none`, and every title in its `TEST LIST` has a passed line in `RESULTS` on that HEAD (count them yourself against the list's total);
- `FAILURES` is `none`. One exception, from [AGENTS.md](../../../../AGENTS.md) (E2E for every implementation): `NO_ENGINE`, the machine has no container engine and is not a runner pod (the `ENV` line's env:detect output shows it). Then the mock specs must still have run and passed, and you give the PR agent the local specs as "written, not run", never as passed. A runner pod is never `NO_ENGINE`; a stack that failed to start on a machine that has an engine is a failed check.

A failing e2e spec means the product is wrong until someone shows, by quoting the case, that the spec departs from it. Never accept "the test was wrong" on the word of the builder or the E2E verifier: open the case and the assertion.

## Findings

Self-reviewer `findings` are real until you read the code and rule otherwise. Every finding that holds is fixed, minor ones and nits included; none is left for the PR. Out-of-scope changes go back to the builder to remove. If you still can't tell whether a finding is real, or its fix needs a choice no rule settles, ask the Advisor. A `verify.sh` failure is never an Advisor question.

Failures and findings go to the builder that owns the code: write them to a scratchpad file (a "Failing checks" part, fixed as given, and a "Findings to assess" part) and spawn a fresh builder with it as `FINDINGS_FILE`; then this phase reruns on the new head.

**Builders re-verify findings; they do not obey.** A finding is a claim. The builder fixes only what passes the [validity test](../../dev-review/reference/severity.md#validity-test-before-anyone-fixes-a-finding) and declines the rest with a reason and evidence. Check its `ASSESSMENT`, `DECLINED` and `UNSURE`: open the cited file:line or test for each decline and accept it only if it holds; otherwise spawn it once more with your counter-evidence, then the Advisor if you still disagree. A finding closed as declined does not count against the round caps and is listed under judgment calls in the PR body. Never re-send a declined finding that you accepted.

**An `E2E` finding is judged against the rule, not the code.** The builder may decline one only by quoting the rule or case text that shows the finding misreads it; "the code does otherwise", "the test passes" and "the rule is outdated" are not grounds, and you reject such a decline. The fix goes into the product code, or into the e2e spec where the spec departs from the case. Nobody in this run edits the `## E2E requirements` section, deletes a case's test, or marks one skip: a rule that looks wrong, or an `E2E RULE:` finding, goes to the Advisor, which must escalate a changed or unmet requirement to a human.

## Cap

**3 verify rounds per run** (the first plus at most 2 after fixes; a round = the E2E verifier when required, `verify.sh` and the Self-reviewer). The E2E verifier's own test-fix retries happen inside one round. If round 3 still fails or has findings, ask the Advisor (stop condition). On `needs_human` only: push the branch, post **Needs clarification** ("I stopped", `Stopped at: verify, round 3`, the verbatim failing command and last output lines, or the open findings), `board.sh status <n> Blocked`, report. Never go to [phase 5](5-open-pr.md) over a red round; never ask the Advisor to waive a failing check, only how to fix it. Rounds restart at 1 on a resumed run. Never claim success, open the PR or move the card on output you did not see pass. `format:check` fails repo-wide until the one-time reformat lands; `fix` covers your files.
