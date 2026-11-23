# Workflow

Create a todo per phase. Do not skip or reorder them.

| Phase | File                                | Done by                                                                                                                       | Tier / effort                                                   |
| ----- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1     | [Triage](phases/1-triage.md)        | Triage agent                                                                                                                  | `medium` / `high`                                               |
| 2     | [Start](phases/2-start.md)          | `scripts/start.sh` (no model)                                                                                                 |                                                                 |
| 3     | [Build](phases/3-build.md)          | Fixer or Implementer(s)                                                                                                       | `medium` / `high` (Fixer), `medium` (Implementer)               |
| 4     | [Verify](phases/4-verify.md)        | E2E verifier first (with E2E requirements), then Verifier and Self-reviewer in parallel                                       | `medium` / `medium`, then `low` / `low` and `medium` / `medium` |
| 5     | [Open PR](phases/5-open-pr.md)      | PR agent                                                                                                                      | `low` / `low`                                                   |
| M1-M7 | [Multi-unit](phases/multi-unit.md)  | Instead of the rest of phase 2 and phases 3 to 5 when Triage returns two or more `UNITS`; returns to phase 5 for the final PR | as phases 3 to 5, plus the Reviewer                             |
| Any   | [Decisions](reference/decisions.md) | Advisor, only for would-be-human questions (max 8 per run)                                                                    | `high` / `high`                                                 |

Multi-unit mode adds a **Reviewer** (tier `medium`, effort `medium`; effort `high` when sensitive, tier stays `medium`) per unit and once for the whole branch.

Roles, tiers and efforts: [prompts/README.md](prompts/README.md). The issue comments you post: [templates/comments.md](templates/comments.md).

## Flow

```
1 Triage ─ STOP ─────────────────────────────► report, no comment
   │      ─ BLOCKED ─► (bug or feature? ─► Advisor) ─► Needs clarification ─► Blocked, stop
   │ GO
2 Start (start.sh new or --resume) ─► In progress ─► Started / Resumed
   │
   ├─ UNITS: 2 or more ─► multi-unit M1 … M7 ─────────────────────┐
   │                                                              │
3 Build: Fixer, or one Implementer per task in order              │
   │                                                              │
4 Verify ◄──────────────────────────────────────────┐             │
   │  E2E verifier (with E2E requirements)          │             │
   │  then Verifier ∥ Self-reviewer                 │             │
   │                                                │             │
   ├─ red or findings ─► builder fixes ─────────────┘ (cap: 3 rounds)
   │ green                                                        │
   ▼◄─────────────────────────────────────────────────────────────┘
5 PR agent (create-pr) ─► read back ─► In review ─► PR opened ─► report

Any phase: a would-be-human question or stop condition ─► Advisor
   decided ─► Advisor decision comment, re-dispatch the asker
   needs_human ─► Needs clarification ("I stopped") ─► push ─► Blocked, stop
```

## Where to enter

Every run enters at phase 1: Triage decides whether this is a new run or a resume. After [phase 2](phases/2-start.md), continue at:

| Situation                                               | Continue at                                                                                   |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| New run, `UNITS: single`                                | Phase 3                                                                                       |
| New run, two or more `UNITS`                            | [Multi-unit](phases/multi-unit.md) M1                                                         |
| `RESUME: yes`, `STOPPED AT: build, task <k> of <total>` | Phase 3 at task `<k>` (earlier tasks are committed)                                           |
| `RESUME: yes`, `STOPPED AT: build (bug fix)`            | Phase 3, re-dispatch the Fixer, which continues from the branch's commits                     |
| `RESUME: yes`, `STOPPED AT: verify`                     | Phase 4                                                                                       |
| `RESUME: yes`, `STOPPED AT: opening the PR`             | Phase 5                                                                                       |
| `RESUME: yes` with a `UNIT STATE` line                  | [Multi-unit](phases/multi-unit.md) M1, Resume; `STOPPED AT` per its Blocking and resume table |

## Working files

| What                     | Made by                          | Holds                                                                            |
| ------------------------ | -------------------------------- | -------------------------------------------------------------------------------- |
| Worktree `<root>-wt/<n>` | `start.sh` (phase 2 or M1)       | The branch (or integration branch); every agent works only here                  |
| Unit worktrees           | `start.sh --unit` (M2)           | One per unit: `<root>-wt/<n>-u<id>` on `<integration>--u<id>`                    |
| Decisions list           | You                              | Each Advisor question and decision; every later prompt carries the accepted ones |
| Reviewer replies         | You (M3, M6), in your scratchpad | Each Reviewer's JSON findings and how each was resolved, for round 2             |

Red flags (hold even when the user says to hurry or skip a step): [reference/common-mistakes.md](reference/common-mistakes.md).
