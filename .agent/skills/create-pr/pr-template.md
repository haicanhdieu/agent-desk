## Summary

<!-- Plain daily language, 2-4 sentences: the problem and the resulting behavior. No file, function or tool names. -->

<summary>

## Root cause

<!-- Bug-fix PRs only. Delete this whole section for features. 1-3 short plain sentences per cause; the cause, not the symptom. Several causes: a short numbered list. If unknown, say what is unknown. -->

<root cause>

## Behavior change

<!-- Every PR. Business, logic and app behavior in words an owner/PM can read. If nothing observable changes (refactor/docs/CI), replace the table with one line saying so. -->

| Area                                 | Current (before this PR) | Expected (after merge)     | How it is supported                                         |
| ------------------------------------ | ------------------------ | -------------------------- | ----------------------------------------------------------- |
| <user flow, rule or system behavior> | <what happens today>     | <what happens once merged> | <the mechanism (rule, check, gate, data flow) and its home> |

## Linked spec / issue

<!-- One `Closes #<n>` per issue the PR delivers (`Refs #<n>` only for related issues it does not finish). Spec, plan or ADR paths; "None" only for fixes, refactors, deps. -->

Closes #<n>
Spec / plan / ADR: <docs/superpowers/... or None>

## Architecture changes

<!-- Only if the PR changes architecture; otherwise delete this section. Brief high-level change as ONE Mermaid diagram showing old, new and what changed (e.g. flowchart with before/after subgraphs; mark added nodes/edges green, removed red, changed amber via classDef). -->

```mermaid
<old / new / changed diagram>
```

## DB schema changes

<!-- Only if the PR changes the database schema; otherwise delete this section. Mermaid erDiagram(s) showing old, new and what changed (added/removed/changed tables, columns, constraints, RLS). -->

```mermaid
<old / new / changed diagram>
```

## API endpoints / contract changes

<!-- Only if the PR changes API routes or `packages/contracts` schemas; otherwise delete this section. Show old, new and what changed (Mermaid diagram or a before/after table of routes and request/response shapes). -->

```mermaid
<old / new / changed diagram>
```

## Screenshots (UI changes)

<!-- Before / after, or Storybook story names. Delete if no UI change. -->

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
