# Multi-unit mode

Use this when Triage returns two or more `UNITS` (step 2 of [SKILL.md](SKILL.md)). The plan is too big for one PR-sized change, so you build it as **units**: each unit is built, verified, reviewed and merged on its own, as an internal draft **sub-PR** into an **integration branch**. When every unit is merged, you verify and review the whole branch and open **one** PR from it to `main`. Humans see one ready PR; the sub-PRs are only for your own review and for running independent units in parallel.

Everything in SKILL.md still holds unless this file says otherwise: Triage, the Advisor and its cap, the "Copy the prompt, do not rewrite it" rule and its string checks, the builder checks after each reply, the Verify rules, GitHub access, and the red flags.

| Term               | Means                                                                                                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integration branch | `<type>/<n>-<slug>`, cut from fresh `origin/main` and pushed. It changes only by squash-merging sub-PRs. Its worktree is `<root>-wt/<n>`; nobody commits in it                                        |
| Unit               | One line of Triage's `UNITS`: `U<id>`, its tasks and its `depends_on`. About 400 changed lines or fewer                                                                                               |
| Unit branch        | `<integration>--u<id>`, cut from the current `origin/<integration>`, worktree `<root>-wt/<n>-u<id>`. `--` keeps it apart from any slug word, and it does not nest under the integration branch's name |
| Sub-PR             | A draft PR from a unit branch into the integration branch, label `internal`. Never into `main`                                                                                                        |
| Fix unit           | A unit added after final verify or final review finds a problem: id `<owner id>r<k>` (for example `3r1`), one task naming the problem                                                                 |

**Size.** The ~400-line cap ([git-workflow.md §3](../../../docs/conventions/git-workflow.md#3-pull-requests)) applies to each unit. It does not apply to the final PR: that PR is an integration of reviewed units, and its body says so.

**Order.** A unit's `depends_on` comes from the plan only (Triage rule D). Cross-unit rules the plan states outside its dependencies, such as a deploy or rollout order, are the plan's and the humans'; do not invent or enforce them here.

## Caps

| What                                 | Cap                                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Units running at once                | **3**                                                                                              |
| Verify rounds per unit               | **3**, counting every Verifier run on that unit (after a build, a review fix, a CI fix or a merge) |
| Internal review rounds per unit      | **2**                                                                                              |
| Final rounds (final verify + review) | **3**                                                                                              |
| Advisor calls                        | **3 per run**, shared by all units (SKILL.md, Decisions)                                           |
| Technical failure of an agent        | re-dispatch **once** with the error; a second failure blocks                                       |

A cap that is hit blocks the run ([Blocking](#blocking-and-resume)). Rounds on a resumed run start again at 1.

## M1. Start

```sh
start.sh <n> feat <slug> --integration     # new run: also pushes the integration branch
start.sh <n> --resume <integration>        # Triage said RESUME: yes and gave UNIT STATE
```

Keep `BRANCH` as the integration branch and `WORKTREE` as its worktree. Then `board.sh status <n> "In progress"` and post the **Units plan** comment from [comments.md](comments.md) (it replaces **Started**; on a resume post **Resumed (units)** instead).

**Resume.** Act on each line of `UNIT STATE`:

- `merged #<pr>`: done. Never rebuild, reopen or re-review a merged unit.
- `open #<pr>`: `start.sh <n> --resume <integration>--u<id>`, then go to M3 step 2 (Verify, round 1).
- `started`: `start.sh <n> --resume <integration>--u<id>`, then M3 step 1 at the first task with no commit (`git -C <unit worktree> log --oneline origin/<integration>..HEAD` and the ticked plan boxes show which are done).
- `not started`: schedule it as usual (M2).

The unit or final step named in `STOPPED AT` resumes where the table in [Blocking and resume](#blocking-and-resume) says, instead of the rule above.

## M2. Schedule the units

A unit is **ready** when every unit in its `depends_on` is merged. Start ready units in id order, at most 3 at once; when one merges, start the units it made ready. Units that become ready together form a wave and run in parallel.

For each unit you start:

```sh
start.sh <n> --unit <id> --base <integration>
```

It cuts `<integration>--u<id>` from the current `origin/<integration>`, so the unit builds on everything merged so far. It refuses an existing branch or worktree, like a new run: stop and report.

**One writer per worktree.** Each unit has its own worktree, so different units' agents run at the same time. Inside one unit the steps stay in order, and only the Verifier and Self-reviewer run together (SKILL.md step 4). An Advisor call reads the asking unit's worktree; pause that unit, not the others.

## M3. One unit

1. **Build.** One Implementer per task in the unit, in order (SKILL.md step 3 rules). Fill `<base>` with `origin/<integration>` and add "of unit U<id>". The git evidence check uses `origin/<integration>` as the base of the first task.
2. **Verify.** SKILL.md step 4 with `<base>` = `origin/<integration>`. The Self-reviewer gets only this unit's tasks; scope is those tasks and about 400 changed lines. Failures and findings go back to an Implementer of this unit. Never go on over a red round.
3. **Open the sub-PR.** You do this yourself, not the PR agent and not `create-pr` (that skill is for PRs to `main`):

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

   No `Closes`, `Fixes` or `Resolves` line, no `agent-authored`, `bug`, `enhancement` or `review:sensitive` label, and no board move: those belong to the final PR. Read it back with `gh pr view <pr> --json state,isDraft,baseRefName,labels,body`: open, draft, base is the integration branch, label `internal`, no closing keyword. Fix with `gh pr edit` if not.

4. **Internal review.** Decide if the unit is sensitive: `git -C <unit worktree> diff --name-only origin/<integration>...HEAD` against [Sensitive paths](../../../docs/conventions/git-workflow.md#sensitive-paths) (the path list in [`dev-review/scripts/flags.sh`](../dev-review/scripts/flags.sh) `sensitive()` helps); when in doubt, yes. Spawn a fresh **Reviewer** ([agent-prompts.md](agent-prompts.md#reviewer-multi-unit-internal-review-of-a-sub-pr-and-the-final-review)), effort `high` if sensitive. Do not run `dev-review` on a sub-PR: it merges to `main` and moves the board.

   **Before you spawn it**, check the filled prompt contains `severity.md`, `## Reviewers`, `code-review-checklist.md` and `Every finding needs a concrete failure scenario`, and that its security line is the "yes" form when the unit is sensitive.

   **Read its reply yourself.** Save it to your scratchpad. Open the file:line of every critical, high and medium and confirm the scenario happens there ([dev-review severity.md](../dev-review/severity.md)); never merge, and never fix, on the Reviewer's word alone. Lows are not fixed; keep them for the final PR. A finding you cannot rule on after reading the code goes to the Advisor (the Self-reviewer row in SKILL.md, Decisions). Findings that hold go to a fresh Implementer of this unit, naming each finding; then step 2 (Verify) runs again, you push, and the Reviewer runs round 2 on the fixes. **Cap: 2 review rounds per unit.** A critical, high or medium still open after round 2 blocks.

5. **CI.** Watch the sub-PR's checks yourself: `gh pr checks <pr> --watch`. A failure: read its log (`gh run view <run-id> --log-failed`, last lines). If the same job also fails on `main`, or it is an infra error or a flaky test, block with the evidence; never re-run until green. Otherwise send the log tail to a fresh Implementer of this unit, then Verify, push and one more review round on the fix (if no round is left, block).

6. **Merge into the integration branch.** Check every gate yourself, on the current head, right before the merge:

   - `gh pr view <pr> --json baseRefName,headRefOid` shows the base is `<integration>` (never `main`) and the head equals `git -C <unit worktree> rev-parse HEAD`;
   - the last Verify round on that head was green and the last review round left no critical, high or medium;
   - `gh pr checks <pr>` is all green on that head;
   - the unit contains the current integration head: `git -C <unit worktree> fetch origin <integration>` then `git -C <unit worktree> merge-base --is-ancestor origin/<integration> HEAD`. If not (a parallel unit merged first): `git -C <unit worktree> merge --no-edit origin/<integration>`. A clean merge goes back to step 2 (Verify), push, then step 5. A conflict: `git -C <unit worktree> merge --abort`, then a fresh Implementer of this unit whose task is "Merge `origin/<integration>` into this branch and resolve the conflicts, keeping both sides' intent; if the two sides want different behavior, stop and say so", then steps 2, 4 (one review round on the merge) and 5.

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

   Post the **Unit merged** comment from [comments.md](comments.md). If the merge is refused, put the PR back to draft (`gh pr ready <pr> --undo`) and go back to the up-to-date check.

## M4. All units merged

Go on only when every unit in `UNITS` (and every fix unit) is merged and `gh pr list --base <integration> --state open` is empty. Close a leftover (for example one replaced by a fix unit) with `gh pr close <pr> --comment "Closed by dev-build: <reason>."`. Confirm `git -C <integration worktree> rev-parse HEAD` equals `git rev-parse origin/<integration>`.

## M5. Final verify

Spawn the **Verifier** on the integration worktree with `<base>` = `origin/main` and its step 5 (coverage per touched package; an e2e command only when the plan or [tests-and-e2e.md](../../../docs/runbooks/tests-and-e2e.md) requires one for this change). Read it as SKILL.md step 4 says, and rerun one command yourself. An "unavailable" check is not passed: block.

Red: find the unit that owns the failing code (the unit whose task changed that file; `git -C <integration worktree> log --oneline origin/main..HEAD -- <file>` shows which sub-PR did). Add a fix unit `<owner id>r<k>` whose one task is the verbatim failing command and its last output lines, run it through M2 and M3, then M5 again. **Cap: 3 final rounds** (final verify plus final review). Never open the final PR over a red round.

## M6. Final review

Spawn the **Reviewer** on the integration worktree for the whole diff: `<base>` = `origin/main`, the requirements are every task of the plan and the issue. Run `flags.sh <integration worktree>` ([dev-review/scripts/flags.sh](../dev-review/scripts/flags.sh)); if it says `SENSITIVE=yes` or any unit was sensitive, use the security "yes" form and effort `high`. Make the same string checks and read the reply the same way as in M3 step 4. Findings that hold become fix units, as in M5, and the next final round starts at M5. Clean on the same head the final verify passed: go on.

## M7. Open the final PR

Check again that `gh pr list --base <integration> --state open` is empty. Then SKILL.md step 5 with head = the integration branch, base `main`, and the PR agent's multi-unit lines filled: every unit with its sub-PR number, the reason for the size, `sensitive` (yes if any unit was), and the lows the internal reviews left. The judgment calls are every unit's builders', Self-reviewers', Reviewers' and Advisor's, plus yours.

When you read the PR back, also check: the body lists every unit and says it is an integration of reviewed units, and `review:sensitive` is set if any unit was sensitive. Then `board.sh status <n> "In review"`, post the **PR opened** comment (units line filled), and report: issue, integration branch, units with sub-PR numbers, PR URL, final verification results (failures included), judgment calls and each Advisor decision.

## Blocking and resume

On any block (Advisor `needs_human`, a cap, a technical failure, a refusal):

1. Start no new agent. Wait for the ones running to return, so each worktree is clean or you know what is in it; name a dirty one in your report.
2. Push every unit branch that has commits (`git -C <unit worktree> push -u origin <unit branch>`). Leave open sub-PRs as drafts (`gh pr ready <pr> --undo` if you had marked one ready). The integration branch is already pushed; never commit to it to save work.
3. Post the **Needs clarification** comment from [comments.md](comments.md) ("I stopped" header) with the three resume lines filled: `Work so far is pushed on` the integration branch, `Units:` with every unit's state, and `Stopped at:` for the unit or final step that blocked.
4. `board.sh status <n> Blocked`, report to the user, and stop.

The `Units:` line names each unit as `U<id> merged #<pr>`, `U<id> open #<pr>`, `U<id> started` (branch pushed, no sub-PR) or `U<id> not started`, separated by `; `. The `Stopped at:` values in multi-unit mode are:

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

Triage reads these lines back on the next run (its rule A2) and does not count the run's own unit branches and `internal` sub-PRs as someone else's.
