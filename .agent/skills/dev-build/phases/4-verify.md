# Phase 4: Verify (the unit loop's step 3B)

Runs once per unit: in single mode the one unit, in a multi-unit run each unit in its own worktree with `<base>` = `origin/<integration>` ([units.md](units.md)). Ends with the unit's **gates green** and its **self-review done** on the current head, or a stop.

Two parts, in this order: **Gates** (fix until green), then **Self-review** (exactly two rounds).

## A. Gates: lint, types, unit tests, e2e

Run after the last builder, and again after every fix. Green means all of these on the same head:

1. **E2E verifier**, only when Triage's `E2E REQUIREMENTS` names a file (a spec or plan with a `## E2E requirements` section, as `dev-plan` writes). Spawn it first, alone in the worktree, and wait. `E2E_FILES` is the file. It runs the e2e specs this unit adds or changes (its diff against `<base>`). **Never skip it**, for any reason (a red unit test, a long stack start, a hurry). In a unit it may commit fixes to e2e test code only.
2. Then, on the HEAD the E2E verifier reported, run **`verify.sh`** yourself ([below](#run-verifysh)): `fix`, lint and typecheck per touched package, and the tests scoped to the change. Run it even when the E2E verifier found product bugs, so the builder gets every failure at once.

**No repeated checks.** Builders run only the tests they wrote. `verify.sh` is the one local gate; the PR agent reuses its result (create-pr preflight) and reruns nothing on the same head. Full suites and integration shards are CI's job.

### Fix until green (no round cap)

Any red result goes back to the builder that owns the code, then the gates run again on the new head. Repeat until every check is green. There is no round cap, because green is required.

**Classify every failure against the requirement first** ([common.md](../prompts/common.md), "Requirement beats code"). A failing unit or e2e test is one of:

- **Product bug:** the product does not do what the requirement says. Fix the **product code**. Never change the test to match the bug.
- **Test bug:** the product meets the requirement and the test is wrong (selector, wait, setup, fixture, an assertion that departs from the requirement). Fix the **test**, toward the requirement.
- Cannot tell: product bug.

You decide the class from the requirement (the task text, the case's Given/Steps/Expected), not from the builder's or the E2E verifier's word. Put it in the "Failing checks" part of the scratchpad `FINDINGS_FILE` (the verbatim failing command and output, its class, and the requirement text it fails) and spawn a fresh builder of this unit with it. A lint or typecheck failure is simply fixed.

**Stuck check.** The same check fails with the same error after 3 consecutive fix attempts: a stop condition for the Advisor ([decisions.md](../reference/decisions.md)); it rules the next approach, never waives the check. Stop only on its `needs_human`.

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

Always run the third line, even if the first two went wrong. A test that passes without the fix proves nothing: the gates are red.

## Read the E2E verifier's reply

- **PRODUCT_BUG:** goes to the builder that owns the code, like a `verify.sh` failure (fixed, not assessed), with the case id, its Expected text, the verbatim error and the file:line. Then the gates run again.
- **TEST_FIXES:** for each commit, open its diff (`git -C <worktree> show <sha>`) and the case. It touches only `apps/web/e2e/`, it moves the test toward the case's Given/Steps/Expected, and it does not loosen an assertion, delete a test, add skip/fixme/only or an unexplained timeout. A fix that fails this check is a product bug hidden by the test: revert it through the builder (`git revert <sha>`) and send the original failure as a PRODUCT_BUG.
- **TEST_ISSUE_UNFIXED:** a failed agent; spawn the E2E verifier once more with the error, then it is a stop condition for the Advisor.
- **ENV_ISSUE / ENV_BLOCKED:** a failed check, never passed. Spawn the E2E verifier once more with the evidence; still failing is a stop condition for the Advisor (it may rule how to free the stack; it never waives the run).
- **A partial run** (`NOT RUN` is not `none`, a `TEST LIST` title has no passed or failed line in `RESULTS`, or `MEMORY` shows a command that ended early with tests left): red, never "remaining cases not run". Memory, a killed process, a pod restart or a slow machine is never a reason to accept it. Spawn the E2E verifier again with the unrun titles in `RERUN`. Repeat until every test has a result; these re-runs are part of the same gates run. If the same single test still dies from memory alone on a fresh stack, it is a stop condition for the Advisor, which may rule how to make it fit (stop other processes, reorder the work, split the spec through the builder) but never waives it. If the run itself was resumed after a crash during this phase, spawn the E2E verifier for every test without a result on the current HEAD.
- Its `HEAD` must equal `git -C <worktree> rev-parse HEAD` and the HEAD `verify.sh` ran on; `STACK STOPPED` and `TREE CLEAN AFTER` are `yes`.

Then all of these hold, or the gates are red:

- the E2E verifier's `SKIP GREP` is empty, and its `SPECS` is not "no e2e spec added or changed on this branch";
- its `NOT RUN` is `none`, and every title in its `TEST LIST` has a passed line in `RESULTS` on that HEAD (count them yourself against the list's total);
- `FAILURES` is `none`. One exception, from [AGENTS.md](../../../../AGENTS.md) (E2E for every implementation): `NO_ENGINE`, the machine has no container engine and is not a runner pod (the `ENV` line's env:detect output shows it). Then the mock specs must still have run and passed, and you give the PR agent the local specs as "written, not run", never as passed. A runner pod is never `NO_ENGINE`; a stack that failed to start on a machine that has an engine is a failed check.

A failing e2e spec means the product is wrong until someone shows, by quoting the case, that the spec departs from it. Never accept "the test was wrong" on the word of the builder or the E2E verifier: open the case and the assertion.

## B. Self-review: at most 2 rounds, no Advisor

Starts only on green gates. It is two rounds and then the unit is done: a third round or an Advisor call is never added.

1. **Round 1.** Spawn the **Self-reviewer** (`ROUND: 1`, `SINCE: none`) on the unit's whole diff against `<base>`. It reads from git only. With E2E requirements it gets `E2E_FILES` and `E2E_SCOPE` and checks each rule and case in scope against the e2e specs and the product code; never pass `none` to drop that step when Triage named a file. `SENSITIVE` is `yes` when the unit's changed files hit a [sensitive path](../../../../docs/conventions/git-workflow.md#sensitive-paths) (`git -C <worktree> diff --name-only <base>...HEAD`; [`dev-review/scripts/flags.sh`](../../dev-review/scripts/flags.sh) `sensitive()` helps; when in doubt, yes), and then effort is `high`.
2. **Judge the findings, then fix them all** ([Findings](#findings) below). Then run **A** again until green. Note the head as `SINCE`.
3. **Round 2.** Spawn a fresh Self-reviewer (`ROUND: 2`, `SINCE: <that head>`, plus the scratchpad file of round 1 findings and how each was resolved). It reviews only what changed since round 1.
4. Judge and fix its findings the same way, run **A** again until green, and the unit is **done**. Nothing is re-reviewed after that.

A finding you cannot rule real or not after reading the code is **not** an Advisor question here: treat it as real when the scenario is plausible, otherwise decline it, and list it under judgment calls for the PR. A declined finding is listed there too.

The E2E coverage checks (these must hold at the end of round 1, and again for any case whose test or code changed in round 2):

- the Self-reviewer's `E2E COVERAGE` has a line for every case in scope (count the `TC-` ids yourself: `git -C <worktree> show HEAD:<file> | grep -c "^| TC-"`), and none says `no test`;
- every case marked `matches` names a test that the last E2E verifier's `RESULTS` show as run and passed on the head.

## Findings

Self-reviewer `findings` are real until you read the code and rule otherwise. Every finding that holds is fixed, minor ones and nits included; none is left for the PR. Out-of-scope changes go back to the builder to remove.

Findings go to the builder that owns the code: write them to a scratchpad file (a "Findings to assess" part) and spawn a fresh builder with it as `FINDINGS_FILE`.

**Builders re-verify findings; they do not obey.** A finding is a claim. The builder fixes only what passes the [validity test](../../dev-review/reference/severity.md#validity-test-before-anyone-fixes-a-finding) and declines the rest with a reason and evidence. Check its `ASSESSMENT`, `DECLINED` and `UNSURE`: open the cited file:line or test for each decline and accept it only if it holds; otherwise spawn it once more with your counter-evidence, and if you still disagree, the finding stands as real and is fixed. A finding closed as declined is listed under judgment calls in the PR body. Never re-send a declined finding that you accepted.

**An `E2E` finding is judged against the rule, not the code.** The builder may decline one only by quoting the rule or case text that shows the finding misreads it; "the code does otherwise", "the test passes" and "the rule is outdated" are not grounds, and you reject such a decline. The fix goes into the product code, or into the e2e spec where the spec departs from the case. Nobody in this run edits the `## E2E requirements` section, deletes a case's test, or marks one skip: a rule that looks wrong, or an `E2E RULE:` finding, goes to the Advisor, which must escalate a changed or unmet requirement to a human. This is the one question the Advisor still takes during self-review.

## Stopping

Never go on over a red gate, never claim success, merge a unit or open the PR on output you did not see pass. On a stop, only after the Advisor said `needs_human`: push the branch, post **Needs clarification** ("I stopped", `Stopped at: verify, gates` or `verify, self-review round <r>`, the verbatim failing command and last output lines, or the open `E2E RULE:` finding), `board.sh status <n> Blocked`, report. Never ask the Advisor to waive a failing check, only how to fix it. `format:check` fails repo-wide until the one-time reformat lands; `fix` covers your files.
