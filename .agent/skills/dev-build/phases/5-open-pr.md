# Phase 5: Open the PR

Ends with the PR open against `main` and the card in `In review`.

Spawn the **PR agent**. It runs the **`create-pr`** skill, which owns the title, body template, labels, local preflight and `gh pr create`. Neither you nor the agent writes a PR body or runs `gh pr create` by hand for a PR to `main`. Its values:

- `TYPE` `bugfix` or `feature` (Triage's `KIND`), the issue number (it writes `Closes #<n>`, so merging closes the issue);
- `VERIFY`: the head `verify.sh` passed on and the path of its log, so `create-pr` reuses it;
- the summary, root cause (bugs), plan path (feature), and the judgment calls of the builders, Self-reviewer, Advisor and you;
- with E2E requirements, `E2E`: the e2e commands and their results, the number of cases covered out of the section's total, and any local spec "written, not run" with the reason. "Written, not run" is allowed only for `NO_ENGINE`. A test cut short by memory, a killed process or a pod restart never reaches this phase: it is a red [phase 4](4-verify.md) round.

The PR agent is `low` tier; read the PR back before you trust it:

```sh
gh pr view <pr> --json state,isDraft,baseRefName,title,body,labels,url
```

It must be open, target `main`, have a Conventional Commits title with the package scope, a `Closes #<n>` line, no leftover `<…>` slot or HTML comment, no "Authored by an AI agent" line (`agent-authored` is the label), and labels `bug` or `enhancement`, `agent-authored`, plus `review:sensitive` when the diff touches a sensitive path. A body that says some cases or tests were not run for any reason but `NO_ENGINE` is wrong: go back to phase 4. If wrong, send the agent one correction; if still wrong, fix it with `gh pr edit` and say so in the report. A `stopped` on a failed precondition or preflight is treated like a [phase 4](4-verify.md) failure. A judgment-call stop (e.g. a diff well over about 800 lines) may go to the Advisor; a failing check never does.

Then:

1. `board.sh status <n> "In review"`.
2. Post **PR opened** ([templates/comments.md](../templates/comments.md)).
3. Report: issue, kind, branch, PR URL, verification results (failures included), judgment calls, each Advisor decision.

You never approve, merge, or move the card past `In review`; that is `dev-review`'s job.
