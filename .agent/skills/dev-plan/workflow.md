# Workflow

Create a todo per phase. Do not skip or reorder them. Read each phase's file when you enter it, not from memory.

| Phase | File                                                   | Done by                                                        | Gates  |
| ----- | ------------------------------------------------------ | -------------------------------------------------------------- | ------ |
| 0     | [Intake](phases/0-intake.md)                           | You                                                            |        |
| 1     | [Brainstorm](phases/1-brainstorm.md)                   | 4 **Analysts** in parallel; you triage and relay               |        |
| 2     | [Design and spec](phases/2-design-and-spec.md)         | You (gate), the **Spec writer**, then the **Coverage checker** | AR     |
| 3     | [Prototype](phases/3-prototype.md) (UI only, optional) | **Prototyper**                                                 | P1, P2 |
| 4     | [Spec approval](phases/4-spec-approval.md)             | You, with the Spec writer for changes                          | A      |
| 5     | [E2E requirements](phases/5-e2e.md) (optional)         | **Test planner**                                               | B, C   |
| 6     | [Plan](phases/6-plan.md)                               | **Planner**                                                    | D      |
| 7     | [PR and report](phases/7-pr-and-report.md)             | You commit; **PR agent** runs `create-pr`                      |        |

Roles, tiers and efforts: [prompts/README.md](prompts/README.md). Reply shapes: [templates/replies.md](templates/replies.md). Spec sections: [templates/spec-sections.md](templates/spec-sections.md). Everything you send the human: [templates/asks.md](templates/asks.md).

## Flow

```
0 Intake
   │
1 Brainstorm: spawn 4 analysts in parallel (business, architecture, ui-ux, testing)
   │
   ▼
 round: every active analyst replies ◄──────────────────────────────┐
   │                                                                │
   ├─ any STATUS: questions ─► triage (ask | merge | hand-off |     │
   │                           conflict) ─► ask the human one by    │
   │                           one ─► resume every active analyst ──┘  (cap: 3 rounds)
   │
   └─ all STATUS: design
   │
2 Gate AR (combined design) ─► Spec writer writes the spec
   │
   ├─► Coverage checker: spec vs requirement ─ gaps ─► ask the human one by one
   │        ▲                                     ─► add/change: analysts + Spec writer revise
   │        └──────────── re-check ◄────────────────┘   (leave out: recorded, no change)
   │
   ├─ UI: yes ─► 3 Gate P1 ─ yes ─► Prototyper ─► Gate P2 ─► Spec writer syncs boards
   │                  └─ no ──────────────────────────────────────┐
   ▼                                                               ▼
 stamp spec ◄──────────────────────────────────────────────────────┘
   │
4 Gate A (spec)
   │
5 Gate B ─ yes ─► Test planner ─► Gate C
   │ no                                                │
   ▼◄──────────────────────────────────────────────────┘
6 Planner ─► graph --write ─► stamp ─► Gate D
   │ yes
7 commit ─► PR agent (create-pr, label dev-plan) ─► report
```

## Where to enter

| Situation                                              | Enter at                                                                                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| No spec for this slug                                  | Phase 1                                                                                                                       |
| Update mode: the spec is on `main`                     | Phase 1, the analysts comparing that spec with `requirement.md`; the Spec writer revises the same file                        |
| `MODE=resume`: an unmerged spec on the branch, no plan | Gate A (ask again), after `stamp` if `check` says `edited` or `unstamped`; gate P2 first when the spec lists prototype boards |
| `MODE=resume`: spec and plan on the branch             | Gate A (gate P2 first, as above), then phase 6 if the plan is `stale`, else gate D                                            |
| `OPEN_PR` is a number                                  | Same as the two rows above; phase 7 then updates that PR instead of opening a second                                          |

On a resumed run, gate A also reports the spec's design sections in the gate AR shape, since gate AR was not answered in this session.

## Working files

All in `<workdir>`, none committed:

| File              | Written by             | Holds                                                       |
| ----------------- | ---------------------- | ----------------------------------------------------------- |
| `requirement.md`  | You (phase 0)          | The requirement, untrusted                                  |
| `areas/<area>.md` | Each Analyst           | Its findings and decisions per deep-dive item               |
| `triage.md`       | You (phase 1)          | Each round's questions and their dispositions               |
| `answers.md`      | You                    | Every question and answer, design change, dependency answer |
| `e2e-section.md`  | Test planner (phase 5) | The e2e cases for the spec's rules                          |

Version marker and check states: [reference/version-marker.md](reference/version-marker.md). After the merge: [reference/after-merge.md](reference/after-merge.md). Before you finish, scan [reference/common-mistakes.md](reference/common-mistakes.md).
