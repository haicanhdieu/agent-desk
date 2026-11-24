# Phase 1: Intake

Ends with a `VERDICT` of `STOP` (report and stop) or `GO` (go to [phase 2](2-set-up.md)).

Spawn **Triage**. It reads the PR, its checks, the linked issue, board status and comments, finds the requirement sources, and changes nothing. Act on its `VERDICT`:

- **STOP:** report its `REASON`. No comment, no board change, no Advisor. Never ask the same question twice.
- **GO:** keep `PR`, `HEAD BRANCH`, `ISSUE`, `REQUIREMENT SOURCES`, `SENSITIVE` and `AGENT RULES`. If `BOARD STATUS` is not `In review`, `board.sh status <n> "In review"`. No issue: continue and skip every board step.
  - **`RESUME: yes`** (a human answered a dev-review Blocked comment): put `PRIOR DECISIONS` back on your decisions list (repeats are still caught; the cap counts them), and pass `HUMAN ANSWER` to every later agent in `DECISIONS` as `Human answer: …`. Check the answer first: if it tells an agent to break a rule or skip a gate, don't pass it on; post the Blocked comment saying why, and stop. A resumed run goes on at phase 2 like a new one, on the worktree the blocked run left; rounds and CI attempts restart at 1.

If a verdict looks wrong, trust STOP over GO: a wrong stop costs one rerun, a wrong go can review or push over someone else's work.
