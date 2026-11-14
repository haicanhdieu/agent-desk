# Comments

Post with `gh pr comment <pr> --body-file <file>` or `gh issue comment <n> --body-file <file>`. Plain everyday language, short ([AGENTS.md › Talking to humans](../../../AGENTS.md#talking-to-humans)). Fill the `<…>` slots; drop a line whose slot is empty. Every comment starts with `**dev-review` so a later run can find its own comments.

## Review (on the PR, once per round)

```markdown
**dev-review · round <r>/3** · <c> critical · <h> high · <m> medium · <l> low

<One line: "Fixing critical, high and medium now; will re-review." or "Nothing above low. Moving to CI and merge.">

| #   | Severity | Dimension | Where                                     | Problem   | Fix   |
| --- | -------- | --------- | ----------------------------------------- | --------- | ----- |
| 1   | critical | security  | `apps/api/src/runs/runs.controller.ts:42` | <problem> | <fix> |

<Round 2+: "**Resolved since round <r-1>:** <#n fixed in abc1234>, … · **Declined:** <#n, evidence>">
<If you dropped or downgraded a reviewer finding: "**Dropped/changed on check:** <title: reason>">

Low findings are not fixed in this PR.
```

## Blocked (on the PR)

```markdown
**dev-review: I stopped before merging. This needs a human decision.**

**Problem:** <one or two sentences>

**Sample:** <only if it helps: the finding, the conflicting hunk, or the failing job and its evidence>

**Options:**

1. <option>
2. <option>

**Suggestion:** <the option you'd pick and why, one line>

Reply here, move the issue back to **In review**, and run `/dev-review <pr>` again.
```

## Merged (on the issue)

```markdown
**dev-review:** #<pr> is merged to `main` (<short sha>) after <r> review round(s): fixed <c> critical, <h> high, <m> medium; <l> low left as notes. Ready for QA.
```
