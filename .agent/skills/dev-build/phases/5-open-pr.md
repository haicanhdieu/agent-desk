# Phase 5: Open the PR

Done by the **PR agent** (prompt: [prompts/pr-agent.md](../prompts/pr-agent.md)); you read the PR back. Ends with the PR open against `main` and the card in `In review`.

Spawn the **PR agent** ([prompts/pr-agent.md](../prompts/pr-agent.md)). It runs the **`create-pr`** skill ([create-pr/SKILL.md](../../create-pr/SKILL.md)), which owns the title, body template, labels, local preflight and `gh pr create`. Neither you nor the agent writes a PR body or runs `gh pr create` by hand for a PR to `main`. Fill its prompt with:

- head `<branch>`, base `main`, push authorized (`git push -u origin <branch>`);
- type `bugfix` or `feature` (Triage's `KIND`), `agent-authored: true`, the issue number (it writes `Closes #<n>`, so merging closes the issue);
- the summary, root cause (bugs), the Verifier's exact results and the head they ran on (so `create-pr` reuses them), the JUDGMENT CALLS of the builders, Self-reviewer, Advisor and you, and the plan path (feature);
- with E2E requirements: under verification, the e2e commands and their results, the number of cases covered out of the section's total, and any local spec "written, not run" with the reason.

Keep the "Authored by an AI agent (`dev-build`)" attribution out of the body; `agent-authored` is the label.

The PR agent is `low` tier; read the PR back before you trust it:

```sh
gh pr view <pr> --json state,isDraft,baseRefName,title,body,labels,url
```

It must be open, target `main`, have a Conventional Commits title with the package scope, a `Closes #<n>` line, no leftover `<…>` slot or HTML comment, and labels `bug` or `enhancement`, `agent-authored`, plus `review:sensitive` when the diff touches a sensitive path. If wrong, send the agent one correction; if still wrong, fix it with `gh pr edit` and say so in the report. A `stopped` on a failed precondition or preflight is treated like a [phase 4](4-verify.md) failure. A judgment-call stop (e.g. a diff well over about 800 lines) may go to the Advisor; a failing check never does.

Then:

1. `board.sh status <n> "In review"`.
2. Post **PR opened** ([templates/comments.md](../templates/comments.md)).
3. Report: issue, kind, branch, PR URL, verification results (failures included), judgment calls, each Advisor decision.

You never approve, merge, or move the card past `In review`; that is `dev-review`'s job.
