# Multi-unit mode

Use when Triage returns two or more `UNITS` ([phase 2](2-start.md)). The plan is too big for one PR-sized change, so each **unit** is built, verified and reviewed in its own worktree, then merged **locally** into an **integration branch**. No sub-PR, no per-unit CI wait. When all units are merged, you verify the whole branch and open **one** PR from it to `main`; CI runs once, there, and `dev-review` reviews the whole diff.

Everything in [SKILL.md](../SKILL.md), phases 1 to 5, [reference/decisions.md](../reference/decisions.md) and [reference/common-mistakes.md](../reference/common-mistakes.md) holds unless this file says otherwise.

- **Integration branch:** `<type>/<n>-<slug>`, cut from fresh `origin/main` and pushed; worktree `<root>-wt/<n>`. It changes only by the local merges of reviewed units (M3 step 5); nobody else commits in it.
- **Unit:** one line of Triage's `UNITS`: `U<id>`, its tasks and `depends_on`. About 800 changed lines or fewer; that cap ([git-workflow.md §3](../../../../docs/conventions/git-workflow.md#3-pull-requests)) applies per unit, not to the final PR, which says so in its body.
- **Unit branch:** `<integration>--u<id>`, cut from current `origin/<integration>`; worktree `<root>-wt/<n>-u<id>`.
- **Unit commit:** the one squash commit a merged unit leaves on the integration branch; its message ends with the trailer `Unit: U<id>` (resume reads it).
- **Fix unit:** added when the final verify finds a problem: id `<owner id>r<k>` (e.g. `3r1`), one task naming the problem.
- **Order:** `depends_on` comes from the plan only. Other cross-unit rules the plan states (deploy or rollout order) are the plan's and humans'; never invent or enforce them.

## Caps

- Units running at once: **3**.
- Verify rounds per unit: **3**, counting every `verify.sh` run after a build, review fix or merge.
- Internal review rounds per unit: **2**.
- Final verify rounds: **3**.
- Advisor calls: **8 per run**, shared by all units.
- Technical failure of an agent: spawn it **once** more with the error; a second failure goes to the Advisor.

A hit cap is a stop condition: ask the Advisor ([reference/decisions.md](../reference/decisions.md)); block ([Blocking](#blocking-and-resume)) only on its `needs_human`. A decided ruling grants one extra round of that kind. Rounds restart at 1 on a resumed run.

## M1. Start

```sh
start.sh <n> feat <slug> --integration     # new run: also pushes the integration branch
start.sh <n> --resume <integration>        # Triage said RESUME: yes and gave UNIT STATE
```

Keep `BRANCH` (the integration branch) and `WORKTREE`. Then `board.sh status <n> "In progress"` and post **Units plan** ([templates/comments.md](../templates/comments.md); on a resume, **Resumed (units)**).

**Resume.** Per `UNIT STATE` line:

- `merged <sha>`: done. Never rebuild or re-review it.
- `started`: `start.sh <n> --resume <integration>--u<id>`, then M3 step 1 at the first task with no commit (`git -C <unit worktree> log --oneline origin/<integration>..HEAD` and ticked plan boxes show which are done). If every task has a commit, go to M3 step 2.
- `not started`: schedule as usual (M2).

The unit or final step named in `STOPPED AT` resumes per the [Blocking and resume](#blocking-and-resume) list instead.

## M2. Schedule the units

A unit is **ready** when every unit in its `depends_on` is merged. Start ready units in id order, at most 3 at once; when one merges, start the units it made ready. For each:

```sh
start.sh <n> --unit <id> --base <integration>
```

It cuts the unit branch from the current `origin/<integration>`, so it builds on everything merged so far. It refuses an existing branch or worktree: stop and report.

**One writer per worktree.** Different units' agents run concurrently; within a unit, steps stay in order, and only `verify.sh` and the Self-reviewer run together. An Advisor call reads the asking unit's worktree: pause that unit only.

## M3. One unit

1. **Build.** One Implementer per unit task, in order ([phase 3](3-build.md)), with `BASE` = `origin/<integration>` and the unit named in `TASK`. The git evidence check's base for the first task is `origin/<integration>`.
2. **Verify.** [Phase 4](4-verify.md) with `<base>` = `origin/<integration>`. The Self-reviewer gets only this unit's tasks; scope is those tasks and about 800 changed lines. With E2E requirements it gets `E2E_FILES` and, as `E2E_SCOPE`, the rules and cases this unit's tasks name (or `none named by this unit`; the final verify covers them all). The E2E verifier does not run per unit: it runs at the final verify (M5), when the whole behaviour is on the branch. Failures and findings go to an Implementer of this unit. Never go on over a red round.
3. **Internal review.** Sensitive? `git -C <unit worktree> diff --name-only origin/<integration>...HEAD` against [Sensitive paths](../../../../docs/conventions/git-workflow.md#sensitive-paths) (the list in [`dev-review/scripts/flags.sh`](../../dev-review/scripts/flags.sh) `sensitive()` helps); when in doubt, yes. Spawn a fresh **Reviewer**: tier `medium` always, effort `high` if sensitive, with `SENSITIVE` set. Never run `dev-review` on a unit: it merges to `main` and moves the board.

   **Read the reply yourself.** Save it to your scratchpad. Open the file:line of every finding, low included, and confirm the scenario happens there ([severity.md](../../dev-review/reference/severity.md)); never merge or fix on the Reviewer's word alone. Fix every finding that holds, low included; none is kept for the PR. A finding you can't rule on after reading the code goes to the Advisor. Findings that hold go to a fresh Implementer of this unit as `FINDINGS_FILE` (check its `DECLINED` and `UNSURE` as [phase 4](4-verify.md) says); then Verify (step 2) and Reviewer round 2 on the fixes. **Cap: 2 review rounds per unit.** A finding that holds, of any severity, still open after round 2 blocks.

4. **Integration-test check.** The Docker-only integration tests and the patch-coverage gate can't run locally. Grep `*.int.test.ts` (and snapshots) for assertions that encode behavior this unit changed; fix those through an Implementer of this unit before merging.

5. **Merge into the integration branch, locally.** Check every gate yourself on the current head, right before merging:
   - the last Verify round on the unit head was green and the last review round left no open finding that holds, of any severity; the unit worktree is clean;
   - the unit contains the integration head: `git -C <unit worktree> fetch origin <integration>` then `git -C <unit worktree> merge-base --is-ancestor origin/<integration> HEAD`. If not (a parallel unit merged first): `git -C <unit worktree> merge --no-edit origin/<integration>`. Clean → step 2 (Verify), then back here. Conflict → `git -C <unit worktree> merge --abort`, then a fresh Implementer of this unit with the task "Merge `origin/<integration>` into this branch and resolve the conflicts, keeping both sides' intent; if the two sides want different behavior, stop and say so", then steps 2 and 3 (one review round on the merge).

   **One merge at a time** (the integration worktree is shared): if another unit is merging, wait for it. Then:

   ```sh
   git -C <integration worktree> pull --ff-only
   git -C <integration worktree> merge --squash <unit branch>
   git -C <integration worktree> commit -m "<Conventional Commits title>" -m "Unit: U<id>"     # then the session's attribution lines
   git -C <integration worktree> push origin <integration>
   git worktree remove <unit worktree>
   git branch -D <unit branch>                   # its work is in the unit commit
   git push origin --delete <unit branch> 2>/dev/null || true
   ```

   The push must fast-forward; if rejected, `pull --ff-only` again and redo the up-to-date check. Never force-push. Post **Unit merged** ([templates/comments.md](../templates/comments.md)).

## M4. All units merged

Continue only when every unit in `UNITS` (and every fix unit) shows a unit commit on the integration branch (`git -C <integration worktree> log --oneline origin/main..HEAD --grep "^Unit: U"`), `git -C <integration worktree> status --short` is empty, and after `git fetch` `git -C <integration worktree> rev-parse HEAD` equals `git rev-parse origin/<integration>`.

## M5. Final verify

On the integration worktree, with `<base>` = `origin/main`, as [phase 4](4-verify.md) says, with these differences:

- With E2E requirements, the **E2E verifier** runs first with `INTEGRATION: yes` (it runs the e2e specs of the whole branch and sorts failures, but commits nothing there). Never skip it.
- Run `verify.sh <integration worktree> origin/main --coverage` (full unit coverage per touched package).
- With E2E requirements, the **Self-reviewer** runs with `E2E_SCOPE: all`. Without them, no Self-reviewer here: each unit had its own, and `dev-review` reviews the whole diff.

"Unavailable" is not passed: block.

Red or findings: find the owning unit (`git -C <integration worktree> log --oneline origin/main..HEAD -- <file>` shows the unit commit). Add fix unit `<owner id>r<k>` whose one task is the verbatim failing command and its last output lines, the PRODUCT_BUG, or the finding; a TEST_ISSUE_UNFIXED becomes a fix unit whose one task is the E2E verifier's cause and proposed test change (the TEST_FIXES check of [phase 4](4-verify.md) applies to its diff). Run it through M2 and M3 like any unit, then M5 again. **Cap: 3 final rounds.** Never open the final PR over a red round.

## M6. Open the final PR

Recheck the integration branch is pushed and clean (M4), and run `flags.sh <integration worktree>` ([dev-review/scripts/flags.sh](../../dev-review/scripts/flags.sh)). Then [phase 5](5-open-pr.md) with head = integration branch, base `main`, and the PR agent's `UNITS` (every unit with its unit commit sha and title), `SENSITIVE` (yes if `SENSITIVE=yes` or any unit was), and `DECLINED` (any finding an internal review declined, with its reason). Judgment calls: every unit's builders', Self-reviewers', Reviewers' and Advisor's, plus yours.

On read-back also check: the body lists every unit and says it integrates internally reviewed units, and `review:sensitive` is set when sensitive. Then `board.sh status <n> "In review"`, post **PR opened** (units line filled), and report: issue, integration branch, units with their commit shas, PR URL, final verification results (failures included), judgment calls, each Advisor decision.

## Blocking and resume

On a block (an Advisor `needs_human`; a cap, technical failure or refusal counts only after the Advisor was asked):

1. Start no new agent. Wait for running ones to return, so each worktree is clean or known; name a dirty one in your report.
2. Push every unit branch with commits (`git -C <unit worktree> push -u origin <unit branch>`). The integration branch is already pushed after each unit merge; never commit half a unit to it to save work.
3. Post **Needs clarification** ([templates/comments.md](../templates/comments.md), "I stopped") with the three resume lines: `Work so far is pushed on` the integration branch, `Units:` with every unit's state, and `Stopped at:` the unit or final step that blocked.
4. `board.sh status <n> Blocked`, report, stop.

`Units:` names each unit as `U<id> merged <sha>`, `U<id> started` (branch pushed, not merged) or `U<id> not started`, separated by `; `. Multi-unit `Stopped at:` values, and where each resumes:

- `U<id>, build, task <k> of <total>`: M3 step 1, task `<k>`
- `U<id>, verify, round <r>`: M3 step 2, round 1
- `U<id>, internal review, round <r>`: M3 step 3, round 1
- `U<id>, merging`: M3 step 5
- `final verify, round <r>` (or `final review, round <r>` from an older run): M5, round 1
- `opening the PR`: M6

Triage reads these lines back next run and does not count the run's own unit branches as someone else's.
