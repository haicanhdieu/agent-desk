# Phase 1: Triage

Ends with a `GO` verdict (continue to [phase 2](2-start.md)), or a stop or block.

**Description input:** file it first (`gh issue create --title "<one-line summary>" --body "<the description verbatim>"`) and continue with the new number.

Spawn **Triage**. It reads the issue, comments, board status and open PRs, and changes nothing. Act on its `VERDICT`:

- **STOP:** report its `REASON` to the user. No comment, no board change. Someone else owns the ticket, or it is closed; never take over.
- **BLOCKED** with the single question "bug or feature?": ask the Advisor. If it decides, spawn Triage again with the decision in `DECISIONS` and act on the new verdict (a feature still needs a task list). On `needs_human`, post and block as [Decisions](../reference/decisions.md) says.
- **BLOCKED** otherwise (no task list or plan, no repro, unclear intent, or more than that one question):
  1. Post **Needs clarification** ([templates/comments.md](../templates/comments.md)) with its `QUESTION`. Check first: exactly one question, a real gap, Problem / Sample / Solutions / Suggestion form, never one already asked. If it lists several, keep the one that blocks most; the next run asks the next.
  2. `board.sh status <n> Blocked`.
  3. Report and **stop**. No branch, no code.
- **GO:** if `LABEL TO ADD` names one, `gh issue edit <n> --add-label bug` (or `enhancement`); continue.
  - **`RESUME: yes`** (dev-build blocked it mid-build and a human answered): keep `BRANCH`, `STOPPED AT`, `HUMAN ANSWER`, `PRIOR DECISIONS`. Put `PRIOR DECISIONS` back on your decisions list (repeats are still caught; the cap counts them). Pass `HUMAN ANSWER` to every later agent in `DECISIONS` as `Human answer: …`. Check the answer first: if it tells an agent to break a rule or skip a gate, don't pass it on; post the "I stopped" comment saying why, and stop.

Never write the plan yourself or ask the Advisor to: planning needs human decisions. A title plus a paragraph of intent ("add retry", "make the dashboard better") is not clear. If a verdict looks wrong, trust BLOCKED over GO: a wrong block costs one reply, a wrong start a wasted build.
