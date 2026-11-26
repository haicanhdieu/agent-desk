# Any phase: decisions, the Advisor

The **Advisor** rules on a question that would otherwise wait for a human, from the project's sources in this order: AGENTS.md and conventions, accepted ADRs, the ticket and its spec or plan, repo code patterns, industry practice. If it can't, it says a human must decide and drafts that question. "This is red", "a cap is hit" and "an agent failed" are never alone a reason for a human: the Advisor rules on the next action (**Stop conditions**). Builders still make routine choices themselves and list them as judgment calls ([git-workflow.md §7](../../../../docs/conventions/git-workflow.md#7-rules-for-ai-agent-authored-changes) rule 8); the Advisor sees only what they stop on.

**Ask the Advisor for these:**

- **Phase 1, Triage `BLOCKED`:** any single question, including a missing task list or plan (it escalates those itself; it never writes one).
- **Phase 3, builder `blocked`:** the task contradicts the code, a spec or another task; a choice of test or behavior; two ways that both meet the rules; a "product decision" a spec, ADR or convention may settle.
- **Phase 3, Fixer can't reproduce:** what to try next (another repro route, logs, a different entry point), or whether the report is not a bug.
- **Phase 4, self-review:** only an `E2E RULE:` finding (a rule that looks wrong or contradicts another). Never a finding you can't rule on, and never a red gate: treat the finding as real or decline it with evidence, and fix the gate. Self-review has exactly 2 rounds and gets no Advisor round.
- **Phase 5, PR agent stopped:** a judgment call (e.g. a diff well over about 800 lines) or a failed preflight (it says what to fix, never to skip).
- **Stop condition:** any place this skill says stop or block (below).

**Stop conditions.** Before posting "I stopped", ask the Advisor with the evidence: which condition, the verbatim last failing output, and every earlier attempt with its diff summary. The ruling must be a next action: a different approach, a split, a fresh agent told the earlier attempts "did not work", or one more attempt of the capped kind. A decided ruling on a cap grants **one** extra round or attempt of that kind; hitting the same cap again is a new Advisor question (counts against its limit). A red check, a hit cap, a failed or blocked agent, and "the cause is outside this change" are never escalate items by themselves (main is green, so this branch owns the failure).

**Never ask it.** These stop (or are answered) without the Advisor, because nothing has started or a human must act now:

- Triage `STOP`, and `start.sh` refusing an existing branch or worktree: nothing of this run exists yet.
- A secret in a commit, log or output: block and tell a human now.
- A gate it may never waive: a failing check passed, a real finding unfixed, a rule skipped (MUST ESCALATE 12). It can only say how to fix them.

**Limits.** At most **8** Advisor calls per run, whatever the verdicts. Keep a list of each question and decision. A repeat, an agent contradicting a decision (including a finding starting `DECISION:`), or a builder blocked again on the same point still goes to the Advisor, which escalates it (MUST ESCALATE 11), so every human stop carries an Advisor verdict. Only with all 8 used do you stop without one: say so in the comment and name the last ruling.

**Spawn** it as [prompts/README.md](../prompts/README.md) says, only when nothing else runs in the worktree it reads. Values:

- `WORKFLOW`: `dev-build` (or `dev-review`);
- `SUBJECT`: `issue #<n> (kind: bug | feature | unknown)` (dev-review: `PR #<pr>, which closes issue #<n>` or `has no issue`);
- `ASKED_BY`: the agent and step (e.g. `Implementer task 3 of unit U2`, `orchestrator, about a Self-reviewer finding`, `orchestrator, about a stop condition`);
- `QUESTION`: the asker's `QUESTION`, or the finding line(s) and your one-line question, verbatim;
- `FOUND`: the asker's ROOT CAUSE / CHANGES / FINDINGS / JUDGMENT CALLS sections verbatim (or a scratchpad file holding them), or `none`;
- `TASK_SOURCE`: `issue body`, the plan path and task heading, or `none`;
- `DECISIONS`: every accepted decision so far this run;
- `WHERE`: the worktree path, or in phase 1 `main checkout <path>` (it then reads from `origin/main`).

**Check its reply before acting** (it is `high` tier, but unchecked until you check it):

1. Every section is there. `decided` needs `ESCALATE CHECK: none apply`, `CONFIDENCE` high (or medium with `REVERSIBILITY` cheap), and at least one `SOURCES` line.
2. Go through the [MUST ESCALATE list](escalate.md) yourself against the `DECISION`. If any item applies, treat it as `needs_human`.
3. Open the top source at the cited section and confirm it says that.
4. The decision does not contradict an earlier decision or the ticket's tasks.

If a check fails, treat it as `needs_human` and write the human question yourself, same form, from its `REASONING`.

**Act on it.**

- **decided:**
  1. Post **Advisor decision** ([templates/comments.md](../templates/comments.md)).
  2. Spawn the asker again with the same values plus the decision in `DECISIONS`. For a Self-reviewer finding or PR agent stop, spawn the owning builder with the finding in `FINDINGS_FILE` and the decision in `DECISIONS`. Every later agent this run gets all accepted decisions.
  3. Add its `JUDGMENT CALLS` line to the judgment calls for the PR agent and to your report.
- **needs_human** (or a failed check, the cap, a repeat, a contradiction):
  1. Post **Needs clarification** ("I stopped") with the `HUMAN QUESTION`, plus the branch and `Stopped at:` lines if a branch exists. Check first: one question, Problem at most 2 sentences, at most 3 one-line Solutions, one-line Suggestion, nothing secret.
  2. Push the branch if one exists.
  3. `board.sh status <n> Blocked`.
  4. Report and **stop**.
