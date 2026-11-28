# Units: one loop for every run

Every run is a list of **units** (Triage's `UNITS`). A bug, or a feature that fits one PR, is **one unit**; a plan too big for one PR-sized change is two or more. Every unit goes through the same **unit loop**: [phase 3](3-build.md) (build) and [phase 4](4-verify.md) (gates, then two self-review rounds). The only differences:

|                | one unit (`UNITS: single`)                    | two or more units                                                                   |
| -------------- | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| Branch         | the run's branch, `<type>/<n>-<slug>`         | integration branch `<type>/<n>-<slug>`, plus one branch per unit                    |
| Merge          | none: the unit commits straight on the branch | each finished unit is squash-merged locally into the integration branch (M3 step 4) |
| After the loop | [phase 5](5-open-pr.md)                       | final verify (M5), then [phase 5](5-open-pr.md)                                     |

No sub-PR, no per-unit CI wait. CI runs once, on the one PR to `main`, and `dev-review` (outside this skill) reviews the whole diff there, so nothing here reviews the whole branch.

Everything in [SKILL.md](../SKILL.md), [reference/decisions.md](../reference/decisions.md) and [reference/common-mistakes.md](../reference/common-mistakes.md) holds unless this file says otherwise.

- **Integration branch:** `<type>/<n>-<slug>`, cut from fresh `origin/main` and pushed; worktree `<root>-wt/<n>`. With two or more units it changes only by the local merges of finished units (M3 step 4); nobody else commits in it.
- **Unit:** one line of Triage's `UNITS`: `U<id>`, its tasks and `depends_on`. About 800 changed lines or fewer; that cap ([git-workflow.md §3](../../../../docs/conventions/git-workflow.md#3-pull-requests)) applies per unit, not to the final PR, which says so in its body.
- **Unit branch** (two or more units only): `<integration>--u<id>`, cut from current `origin/<integration>`; worktree `<root>-wt/<n>-u<id>`. With one unit, "unit worktree" below means the run's worktree, and `<base>` is `origin/main`.
- **Unit commit:** the one squash commit a merged unit leaves on the integration branch; its message ends with the trailer `Unit: U<id>` (resume reads it).
- **Fix unit:** added when the final verify finds a problem: id `<owner id>r<k>` (e.g. `3r1`), one task naming the problem.
- **Order:** `depends_on` comes from the plan only. Other cross-unit rules the plan states (deploy or rollout order) are the plan's and humans'; never invent or enforce them.

## Caps

- Units running at once: **3**.
- Self-review rounds per unit: **exactly 2**, then done. No Advisor, no extra round.
- Gates (lint, types, unit tests, e2e): **no cap**, fix until green. Stuck check: the same check failing the same way after 3 fix attempts goes to the Advisor.
- Technical failure of an agent: spawn it **once** more with the error; a second failure goes to the Advisor.

A hit stuck check or technical failure is a stop condition: ask the Advisor ([reference/decisions.md](../reference/decisions.md)); block ([Blocking](#blocking-and-resume)) only on its `needs_human`. A decided ruling grants one extra attempt of that kind. Counters restart on a resumed run.

## M1. Start

```sh
start.sh <n> <fix|feat> <slug>             # one unit: the run's branch and worktree
start.sh <n> feat <slug> --integration     # two or more units: also pushes the integration branch
start.sh <n> --resume <branch>             # Triage said RESUME: yes (the run's branch or the integration branch)
```

Keep `BRANCH` and `WORKTREE`. Then `board.sh status <n> "In progress"` and post **Started** (one unit) or **Units plan** (two or more) ([templates/comments.md](../templates/comments.md); on a resume, **Resumed** or **Resumed (units)**). Phase 2 has the details of `start.sh`.

**Resume (two or more units).** Per `UNIT STATE` line:

- `merged <sha>`: done. Never rebuild or re-review it.
- `started`: `start.sh <n> --resume <integration>--u<id>`, then M3 step 1 at the first task with no commit (`git -C <unit worktree> log --oneline origin/<integration>..HEAD` and ticked plan boxes show which are done). If every task has a commit, go to M3 step 2.
- `not started`: schedule as usual (M2).

The unit or final step named in `STOPPED AT` resumes per the [Blocking and resume](#blocking-and-resume) list instead.

## M2. Schedule the units

A unit is **ready** when every unit in its `depends_on` is merged (one unit: ready at once). Start ready units in id order, at most 3 at once; when one finishes, start the units it made ready. With two or more units, for each:

```sh
start.sh <n> --unit <id> --base <integration>
```

It cuts the unit branch from the current `origin/<integration>`, so it builds on everything merged so far. It refuses an existing branch or worktree: stop and report.

**One writer per worktree.** Different units' agents run concurrently; within a unit, steps stay in order. An Advisor call reads the asking unit's worktree: pause that unit only.

## M3. One unit

1. **Build.** [Phase 3](3-build.md): a Fixer (bug) or one Implementer per unit task, in order, with `BASE` = `origin/<integration>` (one unit: `origin/main`) and the unit named in `TASK`. The git evidence check's base for the first task is that same `BASE`.
2. **Verify.** [Phase 4](4-verify.md) with `<base>` = `BASE`: gates green, self-review round 1, fixes, gates green, round 2, fixes, gates green. With E2E requirements the E2E verifier runs the specs this unit changed, and the Self-reviewer gets `E2E_SCOPE` = the rules and cases this unit's tasks name (all of them for one unit; or `none named by this unit`, which the final verify covers). The Self-reviewer gets only this unit's tasks; scope is those tasks and about 800 changed lines. Never go on over a red gate. Never run `dev-review` on a unit: it merges to `main` and moves the board.
3. **Integration-test check.** The Docker-only integration tests and the patch-coverage gate can't run locally. Grep `*.int.test.ts` (and snapshots) for assertions that encode behavior this unit changed; fix those through an Implementer of this unit (then phase 4 A again) before the unit is done.
4. **Merge into the integration branch, locally.** One unit: skip this step; the unit is done. Two or more: check every gate yourself on the current head, right before merging:
   - the last gates run on the unit head was green and self-review round 2 is done; the unit worktree is clean;
   - the unit contains the integration head: `git -C <unit worktree> fetch origin <integration>` then `git -C <unit worktree> merge-base --is-ancestor origin/<integration> HEAD`. If not (a parallel unit merged first): `git -C <unit worktree> merge --no-edit origin/<integration>`. Clean → gates again (phase 4 A), then back here. Conflict → `git -C <unit worktree> merge --abort`, then a fresh Implementer of this unit, at tier `low`, effort `medium` (this holds for any merge conflict in a run), with the task "Merge `origin/<integration>` into this branch and resolve the conflicts, keeping both sides' intent; if the two sides want different behavior, stop and say so", then gates again.

   A merge, clean or conflicted, adds no review round: self-review is done after round 2.

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

## M4. All units done

Two or more units: continue only when every unit in `UNITS` (and every fix unit) shows a unit commit on the integration branch (`git -C <integration worktree> log --oneline origin/main..HEAD --grep "^Unit: U"`), `git -C <integration worktree> status --short` is empty, and after `git fetch` `git -C <integration worktree> rev-parse HEAD` equals `git rev-parse origin/<integration>`. One unit: go to phase 5 (no final verify; the unit's gates were the final ones).

## M5. Final verify (two or more units only): gates, no review

On the integration worktree, with `<base>` = `origin/main`, run **phase 4 A only** (gates; no Self-reviewer, because `dev-review` owns the whole-branch review):

- With E2E requirements, the **E2E verifier** runs first, as in phase 4 A (`low` tier, `medium` effort; it runs the e2e specs of the whole branch and reports, and commits nothing). Never skip it.
- Run `verify.sh <integration worktree> origin/main --coverage` (full unit coverage per touched package).

"Unavailable" is not passed: block.

Red: nobody edits the integration branch. Classify each failure against the requirement ([phase 4](4-verify.md) A), find the owning unit (`git -C <integration worktree> log --oneline origin/main..HEAD -- <file>` shows the unit commit), and add fix unit `<owner id>r<k>` whose one task is the verbatim failing command and its last output lines, with its class (product or test, which you decide; the E2E verifier's label is only a hint) and the requirement it fails; for an e2e failure add the case id and the verifier's file:line and cause. Its builder is `medium` tier, `medium` effort, and its e2e test commits get [Check e2e test fixes](4-verify.md#check-e2e-test-fixes). Run it through M2 and M3 like any unit (build, gates, two self-review rounds, merge), then M5 again. Repeat until green; the stuck check of the Caps section applies. Never open the final PR over a red gate.

## M6. Open the final PR

Two or more units: recheck the integration branch is pushed and clean (M4), and run `flags.sh <integration worktree>` ([dev-review/scripts/flags.sh](../../dev-review/scripts/flags.sh)). Then [phase 5](5-open-pr.md) with head = the run's branch, base `main`, and, for two or more units, the PR agent's `UNITS` (every unit with its unit commit sha and title). `SENSITIVE` is yes if `flags.sh` says so or any unit was. `DECLINED` lists every finding a self-review declined, with its reason, and every `unsure` one. Judgment calls: every unit's builders', Self-reviewers' and Advisor's, plus yours.

On read-back also check: with two or more units the body lists every unit and says it integrates self-reviewed units, and `review:sensitive` is set when sensitive. Then `board.sh status <n> "In review"`, post **PR opened** (units line filled when there are units), and report: issue, branch, units with their commit shas, PR URL, verification results (failures included), judgment calls, each Advisor decision.

## Blocking and resume

On a block (an Advisor `needs_human`; a stuck check or technical failure counts only after the Advisor was asked):

1. Start no new agent. Wait for running ones to return, so each worktree is clean or known; name a dirty one in your report.
2. Push every unit branch with commits (`git -C <unit worktree> push -u origin <unit branch>`). The integration branch is already pushed after each unit merge; never commit half a unit to it to save work.
3. Post **Needs clarification** ([templates/comments.md](../templates/comments.md), "I stopped") with the resume lines: `Work so far is pushed on` the branch, `Units:` with every unit's state (two or more units), and `Stopped at:` the unit or final step that blocked.
4. `board.sh status <n> Blocked`, report, stop.

`Units:` names each unit as `U<id> merged <sha>`, `U<id> started` (branch pushed, not merged) or `U<id> not started`, separated by `; `. `Stopped at:` values, and where each resumes (one unit: leave out `U<id>, `):

- `U<id>, build, task <k> of <total>` or `build (bug fix)`: M3 step 1, task `<k>`
- `U<id>, verify, gates`: M3 step 2, gates from the start
- `U<id>, verify, self-review round <r>`: M3 step 2, gates, then self-review round 1 (a resumed run redoes round 1)
- `U<id>, merging`: M3 step 4
- `final verify`: M5
- `opening the PR`: M6

Triage reads these lines back next run and does not count the run's own unit branches as someone else's.
