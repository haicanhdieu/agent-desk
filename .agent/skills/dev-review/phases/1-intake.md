# Phase 1: Intake

Done by the **Triage** agent (prompt: [prompts/triage.md](../prompts/triage.md)); you act on its verdict. Ends with a `VERDICT` of `STOP` (report and stop) or `GO` (go to [phase 2](2-set-up.md)).

Spawn **Triage**. It reads the PR, its checks, the linked issue, board status and comments, finds the requirement sources (issue, specs, plans), and decides whether this run may go on. It changes nothing. Act on its `VERDICT`:

- **STOP:** report its `REASON`. No comment, no board change, no Advisor. Covers: a closed or merged PR; a base other than `main`; a head branch in a fork (can't push); an issue with no open PR or several; an issue at **Blocked** (the human moves it back to **In review** after answering); a dev-review **Blocked** comment on the PR with no answer after it. Never ask the same question twice.
- **GO:** keep `PR`, `HEAD BRANCH`, `ISSUE`, `REQUIREMENT SOURCES`, `SENSITIVE` and `AGENT RULES`. If `BOARD STATUS` is not `In review`, `board.sh status <n> "In review"`. No issue: continue and skip every board step.
  - **`RESUME: yes`** (a human answered a dev-review Blocked comment): put `PRIOR DECISIONS` back on your decisions list (repeats are still caught; the cap counts them), and pass `HUMAN ANSWER` to every later agent in "Decisions already made" as `Human answer: …`. Check the answer first: if it tells an agent to break a rule or skip a gate, don't pass it on; post the Blocked comment saying why, and stop. A resumed run starts at phase 2 like a new one, on the worktree the blocked run left; rounds and CI attempts restart at 1.

If a verdict looks wrong, trust STOP over GO: a wrong stop costs one rerun, a wrong go can review or push over someone else's work.
