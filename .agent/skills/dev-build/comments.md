# Comments

The PR body is owned by the `create-pr` skill, not this file.

Post comments with `gh issue comment <n> --body-file <file>`. Write them in plain everyday language and keep them short ([AGENTS.md › Talking to humans](../../../AGENTS.md#talking-to-humans)). Fill the `<…>` slots; drop a line whose slot is empty.

## Needs clarification

One form, one question ([AGENTS.md › Talking to humans](../../../AGENTS.md#talking-to-humans): one question per message, answerable in 30 seconds). If more gaps exist, the next run asks the next one. Use the first header when Triage blocks on a gap, or a Fixer can't reproduce the bug; use the second for everything else: the Advisor's `HUMAN QUESTION`, an Advisor verdict you rejected, the Advisor cap or a repeat, or a technical failure. Either way the run ends at **Blocked**.

```markdown
**dev-build: I can't start this yet. The requirement isn't clear enough to build without guessing.**
<or>
**dev-build: I stopped. This needs a human decision.**

**Problem:** <at most 2 sentences>

**Sample:** <optional, at most 5 lines>

**Solutions:**

1. <one line>
2. <one line>
3. <one line>

**Suggestion:** <the option you'd pick and why, one line>

<Only if a branch exists:>
Work so far is pushed on `<branch>`.
Stopped at: <build, task <k> of <total> | build (bug fix) | verify, round <r> | opening the PR>

Reply here with your pick, move the card back to **Ready**, and run `/dev-build <n>` again<If a branch exists: "; it continues from that branch">.
```

For a feature with no task list, the question is always: "Can you add a task list (`- [ ]` steps with what changes and how we know it's done), or link a plan in `docs/superpowers/plans/`?" (Solutions: "I add the list here", "I link a plan", "Skip: close the ticket".)

The two lines `Work so far is pushed on …` and `Stopped at: …` are how the next run knows it may resume (Triage reads them), so write them exactly. Leave both out when no branch exists.

## Advisor decision

Post one per accepted Advisor decision, before you re-dispatch the asker. It lets a human see and overrule the call before review.

```markdown
**dev-build: decided without a human:** <the question, one line>

**Decision:** <the ruling, one or two lines>

**Based on:**

- <source: path and section, and what it says, one line>

**If this is wrong:** <cost and how to undo it, one line>. It is listed in the PR's judgment calls; say so on the PR if you disagree.
```

## Started

```markdown
**dev-build:** working on this as a **<bug fix | feature>** on branch `<branch>` (from latest `main`).
```

## Resumed

```markdown
**dev-build:** resumed on branch `<branch>` after your answer. Continuing from: <the "Stopped at" line>. <If behind main: "The branch is <k> commit(s) behind `main`; `dev-review` will rebase it.">
```

## PR opened

```markdown
**dev-build:** PR ready for review: #<pr>. <one-line summary of the change>.
<For a bug: "Root cause: <one line>.">
This issue stays open until QA passes.
```
