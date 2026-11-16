# Multi-unit mode

Use when Triage returns two or more `UNITS` (step 2 of [SKILL.md](SKILL.md)). The plan is too big for one PR-sized change, so each **unit** is built, verified, reviewed and merged on its own as an internal draft **sub-PR** into an **integration branch**. When all are merged, you verify and review the whole branch and open **one** PR from it to `main`. Humans see one ready PR; sub-PRs exist only for your own review and to run independent units in parallel.

All of SKILL.md holds unless this file says otherwise: Triage, the Advisor and its cap, "Copy the prompt, do not rewrite it" and its string checks, the builder checks, the Verify rules, GitHub access, the red flags.

| Term               | Means                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integration branch | `<type>/<n>-<slug>`, cut from fresh `origin/main` and pushed. Changes only by squash-merging sub-PRs. Worktree `<root>-wt/<n>`; nobody commits in it                                  |
| Unit               | One line of Triage's `UNITS`: `U<id>`, its tasks and `depends_on`. About 400 changed lines or fewer                                                                                   |
| Unit branch        | `<integration>--u<id>` (`--` keeps it apart from slug words and stops it nesting under the integration name), cut from current `origin/<integration>`, worktree `<root>-wt/<n>-u<id>` |
| Sub-PR             | Draft PR from a unit branch into the integration branch, label `internal`. Never into `main`                                                                                          |
| Fix unit           | Added after final verify or review finds a problem: id `<owner id>r<k>` (e.g. `3r1`), one task naming the problem                                                                     |

**Size.** The ~400-line cap ([git-workflow.md §3](../../../docs/conventions/git-workflow.md#3-pull-requests)) applies per unit, not to the final PR, which integrates reviewed units and says so in its body.

**Order.** `depends_on` comes from the plan only (Triage rule D). Other cross-unit rules the plan states (deploy or rollout order) are the plan's and humans'; never invent or enforce them.

## Caps

| What                                 | Cap                                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Units running at once                | **3**                                                                                              |
| Verify rounds per unit               | **3**, counting every Verifier run after a build, review fix or merge. CI fixes have their own cap |
| CI fix attempts per unit             | **6**, then one last `high` attempt (M3 step 5). Never a reason to stop earlier                    |
| Internal review rounds per unit      | **2**                                                                                              |
| Final rounds (final verify + review) | **3**                                                                                              |
| Advisor calls                        | **8 per run**, shared by all units (SKILL.md, Decisions)                                           |
| Technical failure of an agent        | re-dispatch **once** with the error; a second failure goes to the Advisor                          |

A hit cap is a stop condition: ask the Advisor (SKILL.md, Decisions); block ([Blocking](#blocking-and-resume)) only on its `needs_human`. A decided ruling grants one extra round of that kind. Rounds restart at 1 on a resumed run.

## M1. Start

```sh
start.sh <n> feat <slug> --integration     # new run: also pushes the integration branch
start.sh <n> --resume <integration>        # Triage said RESUME: yes and gave UNIT STATE
```

Keep `BRANCH` (the integration branch) and `WORKTREE`. Then `board.sh status <n> "In progress"` and post **Units plan** ([comments.md](comments.md); replaces **Started**; on a resume post **Resumed (units)**).

**Resume.** Per `UNIT STATE` line:

- `merged #<pr>`: done. Never rebuild, reopen or re-review it.
- `open #<pr>`: `start.sh <n> --resume <integration>--u<id>`, then M3 step 2 (Verify, round 1).
- `started`: same `start.sh`, then M3 step 1 at the first task with no commit (`git -C <unit worktree> log --oneline origin/<integration>..HEAD` and ticked plan boxes show which are done).
- `not started`: schedule as usual (M2).

The unit or final step named in `STOPPED AT` resumes per the [Blocking and resume](#blocking-and-resume) table instead.

## M2. Schedule the units

A unit is **ready** when every unit in its `depends_on` is merged. Start ready units in id order, at most 3 at once; when one merges, start the units it made ready. Units ready together form a parallel wave. For each:

```sh
start.sh <n> --unit <id> --base <integration>
```

It cuts `<integration>--u<id>` from the current `origin/<integration>` (so it builds on everything merged so far). It refuses an existing branch or worktree, like a new run: stop and report.

**One writer per worktree.** Each unit has its own worktree, so different units' agents run concurrently. Within a unit, steps stay in order; only the Verifier and Self-reviewer run together (SKILL.md step 4). An Advisor call reads the asking unit's worktree: pause that unit only.

## M3. One unit

1. **Build.** One Implementer per unit task, in order (SKILL.md step 3). `<base>` = `origin/<integration>`, add "of unit U<id>". The git evidence check's base for the first task is `origin/<integration>`.
2. **Verify.** SKILL.md step 4 with `<base>` = `origin/<integration>`. The Self-reviewer gets only this unit's tasks; scope is those tasks and about 400 changed lines. Failures and findings go to an Implementer of this unit. Never go on over a red round.
3. **Open the sub-PR** yourself (not the PR agent, not `create-pr`, which is for PRs to `main`):

   ```sh
   git -C <unit worktree> push -u origin <unit branch>
   gh label create internal --color BFD4F2 --description "dev-build sub-PR into an integration branch; never main" 2>/dev/null || true
   gh pr create --draft --base <integration> --head <unit branch> --label internal \
     --title "[unit <k>/<N>] <Conventional Commits title>" --body-file <scratchpad file>
   ```

   Body (fill the slots, nothing else):

   ```markdown
   Internal unit U<id> (<k> of <N>) for #<n>, built by `dev-build`. It merges into `<integration>` only, never `main`. Do not review or merge it by hand: the PR from `<integration>` to `main` is the one for human review.

   **Tasks:** <the unit's task titles> (<plan path>)
   **Verification on <sha>:** <the Verifier's commands and exit codes>
   **Judgment calls:** <this unit's, or "none">
   ```

   No `Closes`, `Fixes` or `Resolves` line; no `agent-authored`, `bug`, `enhancement` or `review:sensitive` label; no board move (all belong to the final PR). Read back `gh pr view <pr> --json state,isDraft,baseRefName,labels,body`: open, draft, base = integration branch, label `internal`, no closing keyword. Fix with `gh pr edit` if not.

4. **Internal review.** Sensitive? `git -C <unit worktree> diff --name-only origin/<integration>...HEAD` against [Sensitive paths](../../../docs/conventions/git-workflow.md#sensitive-paths) (the list in [`dev-review/scripts/flags.sh`](../dev-review/scripts/flags.sh) `sensitive()` helps); when in doubt, yes. Spawn a fresh **Reviewer** ([agent-prompts.md](agent-prompts.md#reviewer-multi-unit-internal-review-of-a-sub-pr-and-the-final-review)), effort `high` if sensitive. Never run `dev-review` on a sub-PR: it merges to `main` and moves the board.

   **Before spawning**, check the filled prompt contains `severity.md`, `## Reviewers`, `code-review-checklist.md` and `Every finding needs a concrete failure scenario`, and its security line is the "yes" form when sensitive.

   **Read the reply yourself.** Save it to your scratchpad. Open the file:line of every critical, high and medium and confirm the scenario happens there ([dev-review severity.md](../dev-review/severity.md)); never merge or fix on the Reviewer's word alone. Lows are not fixed; keep them for the final PR. A finding you can't rule on after reading the code goes to the Advisor (Self-reviewer row, SKILL.md Decisions). Findings that hold go to a fresh Implementer of this unit, naming each; then Verify (step 2), push, and Reviewer round 2 on the fixes. **Cap: 2 review rounds per unit.** A critical, high or medium open after round 2 blocks.

5. **CI.** Watch yourself: `gh pr checks <pr> --watch`. A red check is never a reason to stop and never "not this unit's problem": `main` is green and the integration branch took only green merges, so this branch broke it (its code, a stale base, or a shared fixture, snapshot, type or coverage floor it moved), even if the failing test is in a file the unit never touched. Never write "unrelated", "pre-existing" or "doesn't touch" in a report or comment unless proven as below. Loop until green:

   1. Read the failure: `gh run view <run-id> --log-failed` (last lines); note each failing job's run id and verbatim log tail.
   2. Check, don't assume. `main` green on that job? `gh run list --branch main --workflow <workflow> --limit 3 --json conclusion,headSha`. Unit behind? `git -C <unit worktree> fetch origin <integration> main`, then `git merge-base --is-ancestor origin/<integration> HEAD`. Behind → step 6's up-to-date rule first, then back here.
   3. Spawn a **CI fixer** ([agent-prompts.md](agent-prompts.md#ci-fixer-a-failing-check-on-a-pr-or-sub-pr)) of this unit with the job name and log tail. It may change any repo file the failure needs to fix the cause, never weakening a check. Check its reply like an Implementer's (`SKILLS:` lists `superpowers:systematic-debugging`; `git -C <unit worktree> log --stat` shows its commit); read its diff for a skipped or deleted test, `@ts-ignore`, `any`, lint disable, or touched threshold, baseline or config; then Verify (step 2), push, watch again. A fix adding a file, test or config the failure doesn't need is out of scope: send it back.
   4. **Only an infra error is not a code failure** (job never started, runner lost, a third-party registry or network call timed out, nothing about the code in the log): `gh run rerun <run-id> --failed` once and note it in the unit's judgment calls. A second infra failure of the same job goes to the Advisor with the run id (no code change can fix it). A test that failed once and passed on rerun is **not** infra but flaky: the CI fixer makes it deterministic.
   5. **Cap: 6 CI fix attempts per unit**, separate from the Verify and review caps; they use no review rounds. After a fix, run a review round only if it touched production code outside what the unit already changed and a round is left.
   6. Cap reached and still red: don't give up on your own judgment. Spawn one `high` CI fixer with every earlier attempt's log tail and diff summary ("these approaches did not work"), watch again. If still red, ask the Advisor (stop condition) with the job, last log tail and each attempt; block only on `needs_human`.

6. **Merge into the integration branch.** Check every gate yourself on the current head, right before merging:

   - `gh pr view <pr> --json baseRefName,headRefOid`: base is `<integration>` (never `main`), head equals `git -C <unit worktree> rev-parse HEAD`;
   - the last Verify round on that head was green and the last review round left no critical, high or medium;
   - `gh pr checks <pr>` all green on that head;
   - the unit contains the integration head: `git -C <unit worktree> fetch origin <integration>` then `git -C <unit worktree> merge-base --is-ancestor origin/<integration> HEAD`. If not (a parallel unit merged first): `git -C <unit worktree> merge --no-edit origin/<integration>`. Clean → step 2 (Verify), push, step 5. Conflict → `git -C <unit worktree> merge --abort`, then a fresh Implementer of this unit with the task "Merge `origin/<integration>` into this branch and resolve the conflicts, keeping both sides' intent; if the two sides want different behavior, stop and say so", then steps 2, 4 (one review round on the merge) and 5.

   Then merge and clean up:

   ```sh
   gh pr ready <pr>
   gh pr merge <pr> --squash --subject "<Conventional Commits title, without the [unit] prefix>"
   gh pr view <pr> --json state --jq .state          # must say MERGED
   git worktree remove <unit worktree>
   git push origin --delete <unit branch>            # if GitHub did not delete it
   git branch -D <unit branch>                        # its work is in the squash commit and the PR
   git -C <integration worktree> pull --ff-only
   ```

   Post **Unit merged** ([comments.md](comments.md)). If the merge is refused, `gh pr ready <pr> --undo` and return to the up-to-date check.

## M4. All units merged

Continue only when every unit in `UNITS` (and every fix unit) is merged and `gh pr list --base <integration> --state open` is empty. Close a leftover (e.g. one replaced by a fix unit) with `gh pr close <pr> --comment "Closed by dev-build: <reason>."`. Confirm `git -C <integration worktree> rev-parse HEAD` equals `git rev-parse origin/<integration>`.

## M5. Final verify

Spawn the **Verifier** on the integration worktree with `<base>` = `origin/main` and its step 3 (`verify.sh --coverage`: full unit coverage per touched package; an e2e command only when the plan or [tests-and-e2e.md](../../../docs/runbooks/tests-and-e2e.md) requires one). Read it as SKILL.md step 4 says; rerun one command yourself. "Unavailable" is not passed: block.

Red: find the owning unit (whose task changed that file; `git -C <integration worktree> log --oneline origin/main..HEAD -- <file>` shows the sub-PR). Add fix unit `<owner id>r<k>` whose one task is the verbatim failing command and its last output lines; run it through M2 and M3, then M5 again. **Cap: 3 final rounds** (final verify plus final review). Never open the final PR over a red round.

## M6. Final review

Spawn the **Reviewer** on the integration worktree for the whole diff: `<base>` = `origin/main`; requirements are every plan task and the issue. Run `flags.sh <integration worktree>` ([dev-review/scripts/flags.sh](../dev-review/scripts/flags.sh)); if `SENSITIVE=yes` or any unit was sensitive, use the security "yes" form and effort `high`. Same string checks and reply reading as M3 step 4. Findings that hold become fix units as in M5, and the next final round starts at M5. Clean on the head the final verify passed: continue.

## M7. Open the final PR

Recheck `gh pr list --base <integration> --state open` is empty. Then SKILL.md step 5 with head = integration branch, base `main`, and the PR agent's multi-unit lines: every unit with its sub-PR number, the size reason, `sensitive` (yes if any unit was), and the lows the internal reviews left. Judgment calls: every unit's builders', Self-reviewers', Reviewers' and Advisor's, plus yours.

On read-back also check: the body lists every unit and says it integrates reviewed units, and `review:sensitive` is set if any unit was sensitive. Then `board.sh status <n> "In review"`, post **PR opened** (units line filled), and report: issue, integration branch, units with sub-PR numbers, PR URL, final verification results (failures included), judgment calls, each Advisor decision.

## Blocking and resume

On a block (an Advisor `needs_human`; a cap, technical failure or refusal counts only after the Advisor was asked):

1. Start no new agent. Wait for running ones to return, so each worktree is clean or known; name a dirty one in your report.
2. Push every unit branch with commits (`git -C <unit worktree> push -u origin <unit branch>`). Keep open sub-PRs draft (`gh pr ready <pr> --undo` if marked ready). The integration branch is already pushed; never commit to it to save work.
3. Post **Needs clarification** ([comments.md](comments.md), "I stopped") with the three resume lines: `Work so far is pushed on` the integration branch, `Units:` with every unit's state, and `Stopped at:` the unit or final step that blocked.
4. `board.sh status <n> Blocked`, report, stop.

`Units:` names each unit as `U<id> merged #<pr>`, `U<id> open #<pr>`, `U<id> started` (branch pushed, no sub-PR) or `U<id> not started`, separated by `; `. Multi-unit `Stopped at:` values:

| Stopped at                          | Resumes at            |
| ----------------------------------- | --------------------- |
| `U<id>, build, task <k> of <total>` | M3 step 1, task `<k>` |
| `U<id>, verify, round <r>`          | M3 step 2, round 1    |
| `U<id>, internal review, round <r>` | M3 step 4, round 1    |
| `U<id>, sub-PR #<pr> CI`            | M3 step 5             |
| `U<id>, merging sub-PR #<pr>`       | M3 step 6             |
| `final verify, round <r>`           | M5, round 1           |
| `final review, round <r>`           | M6                    |
| `opening the PR`                    | M7                    |

`U<id>, sub-PR #<pr> CI` is written only for the infra-error block or after the last `high` CI fixer attempt; a plain red check never stops the run.

Triage reads these lines back next run (rule A2) and does not count the run's own unit branches and `internal` sub-PRs as someone else's.
