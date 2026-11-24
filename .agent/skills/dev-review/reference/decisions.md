# Decisions: the Advisor

The **Advisor** (tier `high`, read-only) rules on would-be-human questions from the project's rules, ADRs and the ticket, or says a human must decide. Same agent and prompt as `dev-build`: spawn it as [prompts/README.md](../prompts/README.md) says, with the prompt file `<main checkout>/.agent/skills/dev-build/prompts/advisor.md`, only when nothing else runs in the worktree. Its values, its stop-condition rules and the checks on its reply are in [dev-build's reference/decisions.md](../../dev-build/reference/decisions.md) and apply unchanged (`WORKFLOW: dev-review`, `SUBJECT` the PR and its issue, `WHERE` the worktree).

## Ask it only for these

- **Phase 2, conflict resolver `blocked`:** the two sides want different behavior, and a spec, ADR, convention or the issue may say which is right.
- **Phase 3, a finding you can't rule on:** under the checker's `UNSURE` or you doubt the checker, and after reading the code you still can't tell; or reviewers disagree and a rule may settle it.
- **Phase 3, a fix choice:** two fixes both meet the rules and the checklist, and no rule picks one.
- **Phase 4, a declined finding:** you can't tell whether the fixer's evidence holds.
- **Stop condition:** any place this skill says Blocked or stop: a cap, an agent that failed twice, a critical or high that will not fix, red CI after the attempts, a merge refused as out of date. Give the evidence and every earlier attempt; it must rule the next action.

## Never ask it

These stop, or are answered by a rule here, without the Advisor:

- Triage `STOP`, and `start.sh` refusing a worktree or branch: nothing of this run exists yet.
- A PR that changes agent rules or CI waiting for human approval ([phase 2](../phases/2-set-up.md#flags)): a repo rule, not a judgment.
- Lowering a verified finding's severity, skipping a reviewer or round, or merging past an open critical, high or medium: it can only say how to fix, never waive (MUST ESCALATE 12).
- A secret in a commit, log or output: block and tell a human now.

A requirement the PR, issue or spec does not give is asked like any question: the Advisor can't invent one and escalates it (MUST ESCALATE 6).

## Limits

At most **8** Advisor calls per run. Keep a list of questions and decisions. A repeat, or a fixer, reviewer or checker contradicting a decision, still goes to the Advisor, which escalates it (MUST ESCALATE 11). Only with all 8 used do you stop without one: say so in the comment.

## Act on its reply

Check it first (all sections present; go through the [MUST ESCALATE list](../../dev-build/reference/escalate.md) yourself; open its top source; no contradiction with an earlier decision).

- **decided:** post **Advisor decision** ([templates/comments.md](../templates/comments.md#advisor-decision-on-the-pr)) on the PR; give the decision to the asker, and to every later agent this run, in `DECISIONS`; add its `JUDGMENT CALLS` line to the PR body's Judgment calls (`gh pr edit`) and your report.
- **needs_human** (or a failed check, the cap, a repeat, a contradiction): **Blocked** ([blocked.md](blocked.md)), with its `HUMAN QUESTION` as the one question.
