# Workflow

Create a todo per phase. Do not skip or reorder them. Read each phase's file when you enter it, not from memory.

| Phase     | File                                   | Done by                                                                        | Tier / effort                                                                                                         |
| --------- | -------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 1         | [Intake](phases/1-intake.md)           | Triage agent                                                                   | `medium` / `medium`                                                                                                   |
| 2         | [Set up](phases/2-set-up.md)           | `scripts/start.sh` (no model); Conflict resolver if the rebase conflicts       | `medium` / `medium` (resolver)                                                                                        |
| 3         | [Review](phases/3-review.md)           | Five reviewers in parallel, then the Findings checker                          | reviewers `medium` / `medium` (security `high` effort when sensitive, tier stays `medium`); checker `medium` / `high` |
| 4         | [Fix](phases/4-fix.md)                 | Fixers, one group at a time; five reviewers per staged diff; then the Verifier | behavior fixer `medium` / `medium`, mechanical `medium` / `low`; Verifier `low` / `low`                               |
| 5         | [CI](phases/5-ci.md)                   | CI watcher; CI fixer for a failure this PR caused                              | watcher `low` / `low`; CI fixer `medium` / `medium`                                                                   |
| 6         | [Merge](phases/6-merge.md)             | You                                                                            |                                                                                                                       |
| 7         | [QA hand-off](phases/7-qa-hand-off.md) | You                                                                            |                                                                                                                       |
| Any phase | [Advisor](reference/decisions.md)      | Advisor, only for would-be-human questions (max 8 per run)                     | `high` / `high`                                                                                                       |

Roles, tiers and efforts: [prompts/README.md](prompts/README.md). Severity: [reference/severity.md](reference/severity.md). Every comment you post: [templates/comments.md](templates/comments.md). Stopping: [reference/blocked.md](reference/blocked.md).

## Flow

```
1 Intake: Triage ─ STOP ─► report, stop
   │ GO (RESUME: yes restarts here too, on the blocked run's worktree)
   ▼
2 start.sh ─ exit 3 ─► report, stop
   │  └─ exit 4 (conflicts) ─► Conflict resolver ─► push ─► rerun start.sh
   │ flags: review:sensitive label; agent rules/CI ─► no merge in phase 6
   ▼
3 Review: 5 reviewers in parallel ─► Findings checker ─► you verify ─► Review comment ◄──┐
   │                                                                                     │
   ├─ critical/high/medium left ─► 4 Fix: per group ─► fixer ─► your read ─► diff review │
   │                                     ─► commit ─► Verifier ─► push ─────────────────┘  (cap: 3 rounds)
   │ none left
   ▼
5 CI: CI watcher ─ red ─► devbox run fix | CI fixer ─► Verifier ─► push ─► watch again  (cap: 6 + 1 high)
   │ green (your own gh pr checks)
   ▼
6 Merge gates 1–4 ─► gh pr merge --squash ─► MERGED   (refused as out of date ─► 5)
   │
7 close issue ─► board.sh QA ─► Merged comment ─► remove worktree ─► report

Any stop condition ─► Advisor ─ decided ─► go on │ needs_human ─► Blocked
```

## Caps per run

Review rounds: **3** total (CI or conflict fixes don't reset it). Amend loops per fix group: **2**. Verifier runs per round: **2**, plus one to confirm a revert. CI fix attempts: **6**, then one last `high` attempt ([phase 5](phases/5-ci.md)). Advisor calls: **8**. A hit cap, or an agent failing twice for a technical reason (no reply, broken format, a crash; re-dispatched **once** with the error), is a stop condition: ask the Advisor ([reference/decisions.md](reference/decisions.md)); a decided ruling grants one extra round or attempt of that kind; only `needs_human` is **Blocked**. A `low` tier agent whose output fails your read-back gets **one** correction; on a second miss, redo it yourself and say so in the report.

## Where to enter

| Situation                                                 | Enter at                                                                                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| A new run                                                 | Phase 1                                                                                                                            |
| Triage `RESUME: yes` (a human answered a Blocked comment) | Phase 2, like a new run, on the worktree the blocked run left; rounds and CI attempts restart at 1 ([phase 1](phases/1-intake.md)) |
| Conflict resolver `done`                                  | Push, then rerun `start.sh` ([phase 2](phases/2-set-up.md))                                                                        |
| `main` moved during CI                                    | Rerun `start.sh` ([phase 5](phases/5-ci.md) item 1)                                                                                |
| Merge refused as out of date                              | Phase 5                                                                                                                            |

## Working files

Write comment bodies, reviewer outputs and finding files to your scratchpad (or `mktemp`), never into the repo:

| File                  | Written by                        | Holds                                                 |
| --------------------- | --------------------------------- | ----------------------------------------------------- |
| Reviewer replies      | You, one per dimension (phase 3)  | Each reviewer's JSON list of findings                 |
| Earlier findings file | You (rounds 2–3 and diff reviews) | Earlier findings, evidence and how they were resolved |
| Group findings file   | You (phase 4 diff review)         | The findings a staged fix is meant to fix             |
| Comment bodies        | You                               | Each comment, posted with `--body-file`               |

Red flags, which hold even when the user says to hurry: [reference/common-mistakes.md](reference/common-mistakes.md).
