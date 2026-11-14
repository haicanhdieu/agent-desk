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

## Type of change

- [ ] feat
- [ ] fix
- [ ] refactor / perf
- [ ] test
- [ ] docs / spec / ADR
- [ ] chore / ci / build / deps
- [ ] Breaking change (`!` in title, callers updated)

## Checklist

Full detail: [docs/conventions/code-review-checklist.md](../docs/conventions/code-review-checklist.md)

- [ ] One concern, about 400 changed lines or fewer (or explained below)
- [ ] `devbox run fix` clean; `lint`, `typecheck`, `test` pass locally for touched packages
- [ ] Tests added or updated for new behavior and fixed bugs
- [ ] Shapes from `packages/contracts`; inputs validated with Zod
- [ ] Tenancy: new tables have `org_id` + RLS; DB access only via `withOrg`
- [ ] Migrations: new migration only; no applied migration edited
- [ ] No secrets, `.env`, tokens, or credentials committed or logged
- [ ] Provider-agnostic names (no `github_*`); provider specifics in adapters
- [ ] Sensitive paths touched (run Job, webhooks, secrets, auth, terminal, RLS, CI)? `review:sensitive` label added
- [ ] Spec, plan, ADR, or runbook updated if behavior or decisions changed
- [ ] Authored by an AI agent? Verification output below; judgment calls listed

## Test evidence

<!-- For a bug: the test that failed before and passes now. Then the preflight commands and their real results, including checks skipped or unavailable. -->

```text
<commands run and result summary>
```

## Judgment calls

<!-- Each ruling and its cost if wrong, or "None". -->

<judgment calls>

## Screenshots (UI changes)

<!-- Before / after, or Storybook story names. Delete if no UI change. -->

## Risk and rollback

<what could break, who is affected; rollback: revert this PR (or forward-fix migration / flag)>

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
