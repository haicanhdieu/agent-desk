# Comments

Post with `gh pr comment <pr> --body-file <file>` or `gh issue comment <n> --body-file <file>`. Plain everyday language, short ([AGENTS.md › Talking to humans](../../../AGENTS.md#talking-to-humans)). Fill the `<…>` slots; drop a line whose slot is empty. Every comment starts with `**dev-review` so a later run can find its own comments. Triage reads three headers to decide stop or resume: `**dev-review · round 1/3**`, `**dev-review: I stopped` and `**dev-review: decided without a human`. Write them exactly.

## Review (on the PR, once per round)

```markdown
**dev-review · round <r>/3** · <c> critical · <h> high · <m> medium · <l> low

<One line: "Fixing critical, high and medium now; will re-review." or "Nothing above low. Moving to CI and merge.">

| #   | Severity | Dimension | Where                                     | Problem   | Fix   |
| --- | -------- | --------- | ----------------------------------------- | --------- | ----- |
| 1   | critical | security  | `apps/api/src/runs/runs.controller.ts:42` | <problem> | <fix> |

<Round 2+: "**Resolved since round <r-1>:** <#n fixed in abc1234>, … · **Declined:** <#n, evidence>">
<If you dropped or downgraded a reviewer finding: "**Dropped/changed on check:** <title: reason and evidence>">
<If a fix failed its diff review: "**Not applied:** <#n → the problem the fix caused; known limitation noted in the PR body>">
<If you reverted a fix: "**Reverted:** <#n fix abc1234 → the new problem it caused>">

Low findings are not fixed in this PR.
```

## Blocked (on the PR)

```markdown
**dev-review: I stopped before merging. This needs a human decision.**

**Problem:** <at most 2 sentences>

**Sample:** <optional, at most 5 lines: the finding, the conflicting hunk, or the failing job and its evidence>

**Solutions:**

1. <one line>
2. <one line>
3. <one line>

**Suggestion:** <the option you'd pick and why, one line>

<Only if a fix was discarded or reverted: "Not applied: the fix for <finding> did not pass its checks, so it was <discarded | reverted in abc1234>.">

Reply here, move the issue back to **In review**, and run `/dev-review <pr>` again. The next run reuses the worktree and starts with a fresh review.
```

## Advisor decision (on the PR)

Post one per accepted Advisor decision, before you re-dispatch the agent that asked. It lets a human see and overrule the call before merge.

```markdown
**dev-review: decided without a human:** <the question, one line>

**Decision:** <the ruling, one or two lines>

**Based on:**

- <source: path and section, and what it says, one line>

**If this is wrong:** <cost and how to undo it, one line>. It is listed in the PR's judgment calls; reply here if you disagree.
```

## Merged (on the issue)

```markdown
**dev-review:** #<pr> is merged to `main` (<short sha>) after <r> review round(s): fixed <c> critical, <h> high, <m> medium; <l> low left as notes. Ready for QA.
```
