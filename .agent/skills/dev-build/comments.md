# Comments

The PR body is owned by the `create-pr` skill, not this file.

Post comments with `gh issue comment <n> --body-file <file>`. Write them in plain everyday language and keep them short ([AGENTS.md › Talking to humans](../../../AGENTS.md#talking-to-humans)). Fill the `<…>` slots; drop a line whose slot is empty.

## Needs clarification

```markdown
**dev-build: I can't start this yet. The requirement isn't clear enough to build without guessing.**

**Problem:** <one or two sentences: what is missing or contradictory>

**What I need:**

1. <question, one line>
2. <question, one line>

**Suggestion:** <the option you'd pick and why, one line>

Reply here (or add a task list / repro steps to the description), move the card back to **Ready**, and run `/dev-build <n>` again.
```

For a feature with no task list, question 1 is always: "Can you add a task list (`- [ ]` steps with what changes and how we know it's done), or link a plan in `docs/superpowers/plans/`?"

## Started

```markdown
**dev-build:** working on this as a **<bug fix | feature>** on branch `<branch>` (from latest `main`).
```

## PR opened

```markdown
**dev-build:** PR ready for review: #<pr>. <one-line summary of the change>.
<For a bug: "Root cause: <one line>.">
This issue stays open until QA passes.
```
