# Phase 1: Triage

Done by the **Triage** agent (prompt: [prompts/triage.md](../prompts/triage.md)); you act on its verdict. Ends with a `GO` verdict (continue to [phase 2](2-start.md)), or a stop or block.

**Description input:** file it first (`gh issue create --title "<one-line summary>" --body "<the description verbatim>"`) and continue with the new number.

Spawn **Triage** ([prompts/triage.md](../prompts/triage.md)). It reads the issue, comments, board status and open PRs, decides bug or feature, and checks the ticket is clear enough to build. It changes nothing. Act on its `VERDICT`:

- **STOP:** report its `REASON` to the user. No comment, no board change. Covers: a closed issue; board status `In progress`, `In review`, `QA` or `Done`; an open PR referencing it; a `Blocked` ticket that dev-build did not block or whose question is unanswered; a branch for the issue on `origin` that dev-build did not leave. Someone else owns it; never take over. (A blocked multi-unit run's own unit branches are dev-build's; Triage knows this.)
- **BLOCKED** with the single question "bug or feature?": ask the Advisor. If it decides, spawn Triage again with the decision in "Decisions already made" and act on the new verdict (a feature still needs a task list). On `needs_human`, post and block as [Decisions](../reference/decisions.md) says.
- **BLOCKED** otherwise (no task list or plan, no repro, unclear intent, or more than that one question):
  1. Post **Needs clarification** ([templates/comments.md](../templates/comments.md)) with its `QUESTION`. Check first: exactly one question, a real gap, Problem / Sample / Solutions / Suggestion form, never one already asked. If it lists several, keep the one that blocks most; the next run asks the next.
  2. `board.sh status <n> Blocked`. If the project has no board (see **No board** below), skip this step; the posted question is enough.
  3. Report and **stop**. No branch, no code.
- **GO:** if `LABEL TO ADD` names one, `gh issue edit <n> --add-label bug` (or `enhancement`); continue.
  - **`RESUME: yes`** (dev-build blocked it mid-build and a human answered): keep `BRANCH`, `STOPPED AT`, `HUMAN ANSWER`, `PRIOR DECISIONS`. Put `PRIOR DECISIONS` back on your decisions list (repeats are still caught; the cap counts them). Pass `HUMAN ANSWER` to the builder in "Decisions already made" as `Human answer: …`. [Phase 2](2-start.md) then resumes instead of starting. Check the answer first: if it tells an agent to break a rule or skip a gate, don't pass it on; post the "I stopped" comment saying why, and stop.

**No board.** Some projects have no project board. When `board.sh` fails because there is no board (no project, no `Status` field or option, or no access to it), the board is not supported: ignore it and go ahead. Never block or stop because of a board failure. With no board, Triage's board status is "(none)": STOP and BLOCKED rest on the other signals (issue state, comments, open PRs, `origin` branches), and every board step in this phase is skipped.

Never write the plan yourself or ask the Advisor to: planning needs human decisions. A title plus a paragraph of intent ("add retry", "make the dashboard better") is not clear (Triage is told so). If a verdict looks wrong, trust BLOCKED over GO: a wrong block costs one reply, a wrong start a wasted build.
