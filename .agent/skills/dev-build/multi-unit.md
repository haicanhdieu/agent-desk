# Multi-unit mode

Use when Triage returns two or more `UNITS` (step 2 of [SKILL.md](SKILL.md)). The plan is too big for one PR-sized change, so each **unit** is built, verified and reviewed on its own in its own worktree, then merged **locally** into an **integration branch**. No sub-PR, no per-unit CI wait, no second review on GitHub. When all units are merged, you verify and review the whole branch and open **one** PR from it to `main`; CI runs once, there.

All of SKILL.md holds unless this file says otherwise: Triage, the Advisor and its cap, "Copy the prompt, do not rewrite it" and its string checks, the builder checks, the Verify rules, GitHub access, the red flags.

| Term               | Means                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integration branch | `<type>/<n>-<slug>`, cut from fresh `origin/main` and pushed. Changes only by the local merges of reviewed units (M3 step 5). Worktree `<root>-wt/<n>`; only step 5 commits in it     |
| Unit               | One line of Triage's `UNITS`: `U<id>`, its tasks and `depends_on`. About 800 changed lines or fewer                                                                                   |
| Unit branch        | `<integration>--u<id>` (`--` keeps it apart from slug words and stops it nesting under the integration name), cut from current `origin/<integration>`, worktree `<root>-wt/<n>-u<id>` |
| Unit commit        | The one squash commit a merged unit leaves on the integration branch; its message ends with the trailer `Unit: U<id>` (resume reads it)                                               |
| Fix unit           | Added after final verify or review finds a problem: id `<owner id>r<k>` (e.g. `3r1`), one task naming the problem                                                                     |

**Size.** The ~800-line cap ([git-workflow.md §3](../../../docs/conventions/git-workflow.md#3-pull-requests)) applies per unit, not to the final PR, which integrates reviewed units and says so in its body.

**Order.** `depends_on` comes from the plan only (Triage rule D). Other cross-unit rules the plan states (deploy or rollout order) are the plan's and humans'; never invent or enforce them.

## Caps

| What                                 | Cap                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------- |
| Units running at once                | **3**                                                                     |
| Verify rounds per unit               | **3**, counting every Verifier run after a build, review fix or merge     |
| Internal review rounds per unit      | **2**                                                                     |
| Final rounds (final verify + review) | **3**                                                                     |
| Advisor calls                        | **8 per run**, shared by all units (SKILL.md, Decisions)                  |
| Technical failure of an agent        | re-dispatch **once** with the error; a second failure goes to the Advisor |

A hit cap is a stop condition: ask the Advisor (SKILL.md, Decisions); block ([Blocking](#blocking-and-resume)) only on its `needs_human`. A decided ruling grants one extra round of that kind. Rounds restart at 1 on a resumed run.

## M1. Start

```sh
start.sh <n> feat <slug> --integration     # new run: also pushes the integration branch
start.sh <n> --resume <integration>        # Triage said RESUME: yes and gave UNIT STATE
```

Keep `BRANCH` (the integration branch) and `WORKTREE`. Then `board.sh status <n> "In progress"` and post **Units plan** ([comments.md](comments.md); replaces **Started**; on a resume post **Resumed (units)**).

**Resume.** Per `UNIT STATE` line:

- `merged <sha>`: done. Never rebuild or re-review it.
- `started`: `start.sh <n> --resume <integration>--u<id>`, then M3 step 1 at the first task with no commit (`git -C <unit worktree> log --oneline origin/<integration>..HEAD` and ticked plan boxes show which are done). If every task has a commit, go to M3 step 2.
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

1. **Build.** One Implementer per unit task, in order (SKILL.md step 3). `<base>` = `origin/<integration>`, add "of unit U<id>". The git evidence check's base for the first task is `origin/<integration>`. The Implementer keeps working in the unit's worktree; there is no PR.
2. **Verify.** SKILL.md step 4 with `<base>` = `origin/<integration>`. The Self-reviewer gets only this unit's tasks; scope is those tasks and about 800 changed lines. Failures and findings go to an Implementer of this unit. Never go on over a red round. Run only what `verify.sh` runs (fix, lint, typecheck, scoped tests); never the full suites, CI does that once on the final PR. With E2E requirements (SKILL.md step 4): the Self-reviewer's step 6 and the Reviewer's E2E check stay in, for the rules and cases this unit's tasks name (none named: say "none named by this unit", and the final review covers them); the Verifier's e2e step 4 runs at the final verify (M5), when the whole behaviour is on the branch.
3. **Internal review.** Sensitive? `git -C <unit worktree> diff --name-only origin/<integration>...HEAD` against [Sensitive paths](../../../docs/conventions/git-workflow.md#sensitive-paths) (the list in [`dev-review/scripts/flags.sh`](../dev-review/scripts/flags.sh) `sensitive()` helps); when in doubt, yes. Spawn a fresh **Reviewer** ([agent-prompts.md](agent-prompts.md#reviewer-multi-unit-internal-review-of-a-unit-and-the-final-review)), tier `medium` (never `high`/opus), effort `high` if sensitive. Never run `dev-review`: it merges to `main` and moves the board.

   **Before spawning**, check `model` is `tiers.medium` from `.agent/models.json` (sonnet; not opus even when sensitive), and the filled prompt contains `severity.md`, `## Reviewers`, `code-review-checklist.md` and `Every finding needs a concrete failure scenario`, and its security line is the "yes" form when sensitive.

   **Read the reply yourself.** Save it to your scratchpad. Open the file:line of every finding, low included, and confirm the scenario happens there ([dev-review severity.md](../dev-review/severity.md)); never merge or fix on the Reviewer's word alone. Fix every finding that holds, low included; none is kept for the PR. A finding you can't rule on after reading the code goes to the Advisor (Self-reviewer row, SKILL.md Decisions). Findings that hold go to a fresh Implementer of this unit in its "Findings to assess" block (it re-verifies each and fixes only the valid ones; check its `DECLINED` and `UNSURE` as SKILL.md step 4 says); then Verify (step 2) and Reviewer round 2 on the fixes. **Cap: 2 review rounds per unit.** A finding that holds, of any severity, still open after round 2 blocks.

4. **Integration-test check.** The Docker-only integration tests and the patch-coverage gate can't run locally. Grep `*.int.test.ts` (and snapshots) for assertions that encode behavior this unit changed; fix those through an Implementer of this unit before merging.

5. **Merge into the integration branch, locally.** Check every gate yourself on the current head, right before merging:

   - the last Verify round on the unit head was green and the last review round left no open finding that holds, of any severity; the unit worktree is clean;
   - the unit contains the integration head: `git -C <unit worktree> fetch origin <integration>` then `git -C <unit worktree> merge-base --is-ancestor origin/<integration> HEAD`. If not (a parallel unit merged first): `git -C <unit worktree> merge --no-edit origin/<integration>`. Clean → step 2 (Verify), then back here. Conflict → `git -C <unit worktree> merge --abort`, then a fresh Implementer of this unit with the task "Merge `origin/<integration>` into this branch and resolve the conflicts, keeping both sides' intent; if the two sides want different behavior, stop and say so", then steps 2 and 3 (one review round on the merge).

   **One merge at a time** (the integration worktree is shared): if another unit is merging, wait for it. Then:

   ```sh
   git -C <integration worktree> pull --ff-only
   git -C <integration worktree> merge --squash <unit branch>
   git -C <integration worktree> commit -m "<Conventional Commits title>" -m "Unit: U<id>"     # then the commit trailer
   git -C <integration worktree> push origin <integration>
   git worktree remove <unit worktree>
   git branch -D <unit branch>                   # its work is in the unit commit
   git push origin --delete <unit branch> 2>/dev/null || true
   ```

   The commit message ends with the attribution lines the session gives for commits, after `Unit: U<id>`. The push must fast-forward; if rejected, `pull --ff-only` again and redo the up-to-date check (the unit is behind). Never force-push. Post **Unit merged** ([comments.md](comments.md)).

## M4. All units merged

Continue only when every unit in `UNITS` (and every fix unit) shows a unit commit on the integration branch (`git -C <integration worktree> log --oneline origin/main..HEAD --grep "^Unit: U"`) and `git -C <integration worktree> status --short` is empty. Confirm `git -C <integration worktree> rev-parse HEAD` equals `git rev-parse origin/<integration>` after `git fetch`.

## M5. Final verify

Spawn the **Verifier** on the integration worktree with `<base>` = `origin/main` and its step 3 (`verify.sh --coverage`: full unit coverage per touched package; an e2e command only when the plan or [tests-and-e2e.md](../../../docs/runbooks/tests-and-e2e.md) requires one). With E2E requirements, also keep its step 4 (the e2e specs of the whole branch) and spawn the **Self-reviewer** alongside it with its step 6 for every rule and case; read both as SKILL.md step 4 item 2 says. Never skip either. Read it as SKILL.md step 4 says; rerun one command yourself. "Unavailable" is not passed: block.

Red: find the owning unit (whose task changed that file; `git -C <integration worktree> log --oneline origin/main..HEAD -- <file>` shows the unit commit). Add fix unit `<owner id>r<k>` whose one task is the verbatim failing command and its last output lines; run it through M2 and M3 (a fix unit's branch is cut from the integration head like any unit), then M5 again. **Cap: 3 final rounds** (final verify plus final review). Never open the final PR over a red round.

## M6. Final review

Spawn the **Reviewer** on the integration worktree for the whole diff: `<base>` = `origin/main`; requirements are every plan task and the issue, plus, when Triage named E2E requirements, its E2E check for every rule and case (never dropped). Run `flags.sh <integration worktree>` ([dev-review/scripts/flags.sh](../dev-review/scripts/flags.sh)); if `SENSITIVE=yes` or any unit was sensitive, use the security "yes" form and effort `high` (tier stays `medium`). Same string checks and reply reading as M3 step 3. Findings that hold become fix units as in M5, and the next final round starts at M5. Clean on the head the final verify passed: continue.

## M7. Open the final PR

Recheck the integration branch is pushed and clean (M4). Then SKILL.md step 5 with head = integration branch, base `main`, and the PR agent's multi-unit lines: every unit with its unit commit sha and title, the size reason, `sensitive` (yes if any unit was), and any finding an internal review declined (with its reason). Judgment calls: every unit's builders', Self-reviewers', Reviewers' and Advisor's, plus yours.

On read-back also check: the body lists every unit and says it integrates internally reviewed units, and `review:sensitive` is set if any unit was sensitive. Then `board.sh status <n> "In review"`, post **PR opened** (units line filled), and report: issue, integration branch, units with their commit shas, PR URL, final verification results (failures included), judgment calls, each Advisor decision.

## Blocking and resume

On a block (an Advisor `needs_human`; a cap, technical failure or refusal counts only after the Advisor was asked):

1. Start no new agent. Wait for running ones to return, so each worktree is clean or known; name a dirty one in your report.
2. Push every unit branch with commits (`git -C <unit worktree> push -u origin <unit branch>`). The integration branch is already pushed after each unit merge; never commit half a unit to it to save work.
3. Post **Needs clarification** ([comments.md](comments.md), "I stopped") with the three resume lines: `Work so far is pushed on` the integration branch, `Units:` with every unit's state, and `Stopped at:` the unit or final step that blocked.
4. `board.sh status <n> Blocked`, report, stop.

`Units:` names each unit as `U<id> merged <sha>`, `U<id> started` (branch pushed, not merged) or `U<id> not started`, separated by `; `. Multi-unit `Stopped at:` values:

| Stopped at                          | Resumes at            |
| ----------------------------------- | --------------------- |
| `U<id>, build, task <k> of <total>` | M3 step 1, task `<k>` |
| `U<id>, verify, round <r>`          | M3 step 2, round 1    |
| `U<id>, internal review, round <r>` | M3 step 3, round 1    |
| `U<id>, merging`                    | M3 step 5             |
| `final verify, round <r>`           | M5, round 1           |
| `final review, round <r>`           | M6                    |
| `opening the PR`                    | M7                    |

Triage reads these lines back next run (rule A2) and does not count the run's own unit branches as someone else's.
