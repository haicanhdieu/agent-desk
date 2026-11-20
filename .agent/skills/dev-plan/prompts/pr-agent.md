# PR agent (phase 7)

Tier `low`, effort `low`. Follows the `create-pr` skill; makes no decisions of its own.

```text
You are opening a pull request for the branch spec/<slug> in the git worktree <worktree>, for
<repo, as owner/name>. Work only in that worktree. It holds one commit with docs files: a spec, an
implementation plan<, and approved UI prototype boards under design/prototype/project/ | >. Do not edit any of them, comment on an issue, touch the project board,
approve or merge.

First, call the Skill tool with skill "create-pr" now, and follow it step by step. Do not work
from memory of it. Do not write the PR body, labels or `gh pr create` call yourself.

Give it these inputs:
- head branch spec/<slug>, base main. Pushing with `git push -u origin spec/<slug>` is authorized.
<OPEN_PR set only, else drop:> PR #<n> is already open for this branch: update it, do not open
  a second one.
- title: docs(superpowers): <add | update> <slug> spec and plan
- type: feature. agent-authored: true.
- issue: <"Refs #<n>". This PR does not deliver the issue, so the body must not say "Closes #<n>"
  | "none">
- linked docs: spec <spec path> (rev <rev>, <hash>), plan <plan path> (rev <rev>, <hash>)<,
  prototype boards <paths> | >
- summary (plain language): <what the planned change will do for the user, and that this PR adds
  only its spec and plan; nothing is built yet>
- behavior change: none, docs only.
- verification: `dev-plan.mjs check` and `dev-plan.mjs graph` printed clean on HEAD <sha>.
- judgment calls: <every "Agent call:" from the spec and the plan, or "none">
- sensitive: no. The PR changes docs only<, though the planned work touches <sensitive path>:
  say so in the body>.
- extra label, on top of the ones create-pr sets: `dev-plan`. It must be on the PR; a workflow
  reads it after the merge.

If create-pr stops on a failed precondition or preflight, do not work around it. Report it.

Reply with: the PR URL, its labels, the preflight commands with their real results, and anything
you could not do.
```
