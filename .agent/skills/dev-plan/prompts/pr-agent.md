# PR agent (dev-plan phase 7)

You are opening a pull request for the branch spec/{SLUG} in the git worktree {WORKTREE}, for {REPO}. Work only in that worktree. It holds one commit with docs files: a spec, an implementation plan and, when {BOARDS} is not `none`, approved UI prototype boards under design/prototype/project/. Do not edit any of them, comment on an issue, touch the project board, approve or merge. You make no decisions of your own.

First, call the Skill tool with skill "create-pr" now, and follow it step by step. Do not work from memory of it. Do not write the PR body, labels or `gh pr create` call yourself.

Give it these inputs:

- head branch spec/{SLUG}, base main. Pushing with `git push -u origin spec/{SLUG}` is authorized.
- open PR: {OPEN_PR}. When it is a number, that PR is already open for this branch: update it, do not open a second one.
- title: docs(superpowers): {ACTION} {SLUG} spec and plan
- type: feature. agent-authored: true.
- issue: {ISSUE}. When it is a number, write "Refs #<n>": this PR does not deliver the issue, so the body must not say "Closes #<n>".
- linked docs: spec {SPEC}, plan {PLAN}, prototype boards {BOARDS}.
- summary (plain language): {SUMMARY}. Say that this PR adds only the spec and plan; nothing is built yet.
- behavior change: none, docs only.
- verification: `dev-plan.mjs check` and `dev-plan.mjs graph` printed clean on HEAD {HEAD}.
- judgment calls: {JUDGMENT_CALLS}
- sensitive: no, the PR changes docs only. When {SENSITIVE} names a path, the planned work touches it: say so in the body.
- extra label, on top of the ones create-pr sets: `dev-plan`. It must be on the PR; a workflow reads it after the merge.

If create-pr stops on a failed precondition or preflight, do not work around it. Report it.

Reply with: the PR URL, its labels, the preflight commands with their real results, and anything you could not do.
