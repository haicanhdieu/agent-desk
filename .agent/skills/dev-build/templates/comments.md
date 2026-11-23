# Comments

The PR body is owned by the `create-pr` skill, not this file.

Post with `gh issue comment <n> --body-file <file>`. Plain everyday language, short ([AGENTS.md › Talking to humans](../../../../AGENTS.md#talking-to-humans)). Fill the `<…>` slots; drop a line whose slot is empty.

## Needs clarification

One form, one question ([AGENTS.md › Talking to humans](../../../../AGENTS.md#talking-to-humans): one question per message, answerable in 30 seconds); the next run asks the next gap. First header: Triage blocks on a gap, or a Fixer can't reproduce the bug. Second header: everything else (the Advisor's `HUMAN QUESTION`, an Advisor verdict you rejected, the Advisor cap or a repeat, a technical failure). Either way the run ends at **Blocked**.

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
<Multi-unit only:> Units: <U<id> merged <sha> | U<id> started | U<id> not started, joined by "; ">
Stopped at: <build, task <k> of <total> | build (bug fix) | verify, round <r> | opening the PR | multi-unit: a value from the table in phases/multi-unit.md, Blocking and resume>

Reply here with your pick, move the card back to **Ready**, and run `/dev-build <n>` again<If a branch exists: "; it continues from that branch">.
```

For a feature with no task list, the question is always: "Can you add a task list (`- [ ]` steps with what changes and how we know it's done), or link a plan in `docs/superpowers/plans/`?" (Solutions: "I add the list here", "I link a plan", "Skip: close the ticket".)

Triage reads `Work so far is pushed on …` and `Stopped at: …` (plus `Units: …` in multi-unit mode, where the branch is the integration branch) to resume, so write them exactly. Omit them when no branch exists.

## Advisor decision

One per accepted Advisor decision, before re-dispatching the asker, so a human can see and overrule it before review.

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

## Units plan

Multi-unit only, instead of **Started**. Triage copies the table back on a resume: keep its columns exactly.

```markdown
**dev-build:** working on this as a **feature** in <N> parts on branch `<integration>` (from latest `main`). Each part is checked on its own before it joins that branch; you get one PR to `main` at the end.

| Unit                | Tasks                          | After              |
| ------------------- | ------------------------------ | ------------------ |
| U<id> <short title> | <task titles, comma-separated> | <U ids, or "none"> |
```

## Unit merged

Multi-unit only, after each unit merges into the integration branch.

```markdown
**dev-build:** part U<id> (<k> of <N>) is done and checked: merged into `<integration>` as <sha>. <m> part(s) to go.
```

## Resumed (units)

Multi-unit only, instead of **Resumed**.

```markdown
**dev-build:** resumed on branch `<integration>` after your answer. Parts done: <k> of <N>. Continuing from: <the "Stopped at" line>.
```

## Resumed

```markdown
**dev-build:** resumed on branch `<branch>` after your answer. Continuing from: <the "Stopped at" line>. <If behind main: "The branch is <k> commit(s) behind `main`; `dev-review` will rebase it.">
```

## PR opened

```markdown
**dev-build:** PR ready for review: #<pr>. <one-line summary of the change>.
<For a bug: "Root cause: <one line>.">
<Multi-unit only: "It brings together <N> parts that were each checked on their own: <sha>, <sha>, ….">
This issue stays open until QA passes.
```
