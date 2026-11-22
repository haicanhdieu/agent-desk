# Phase 7: PR and report (only after a written yes at gate D)

## PR

1. `dev-plan.mjs check <spec> <plan>` prints `check: clean.`, `dev-plan.mjs graph <plan>` prints `graph: clean.`, and `git -C <worktree> status --short` lists only those two files plus the board files approved at gate P2. Anything else: stop and report.
2. Commit them, and only them: `docs(superpowers): add <slug> spec and plan` (`update` on a re-run), ending with the session's attribution lines.
3. `(cd <worktree> && devbox run -- pnpm install)`, so `create-pr`'s preflight can run there.
4. `gh label create dev-plan --color 1d76db --description "Spec and plan written by the dev-plan skill (PR), or tracked by it (issue)" --force`.
5. Spawn the **PR agent** ([prompts/pr-agent.md](../prompts/pr-agent.md), `low`, effort `low`; `<repo>` is `gh repo view --json nameWithOwner --jq .nameWithOwner`). With `OPEN_PR` set it updates that PR. It runs `create-pr` with `Refs #<n>` (never `Closes`: the issue is done when `dev-build` ships it) and adds the `dev-plan` label.
6. Read the PR back yourself: `gh pr view <pr> --json state,baseRefName,title,body,labels,files,url`. It is open against `main`; **its labels include `dev-plan`** (without it the merge syncs nothing: add it with `gh pr edit <pr> --add-label dev-plan`); the body has no `Closes #`; its files are the spec, the plan and the approved boards only.

Do not merge. `dev-review` or a human does.

## Report

PR URL; the spec and the plan as full GitHub `blob` links at the PR head ([templates/asks.md › File links](../templates/asks.md#file-links)), each with `rev` and `hash`; the areas that were active (and why any was not applicable); the prototype boards (or "no UI", or "prototype skipped"); rules and cases (or "no e2e section"); the waves; every `Agent call:`; open questions; and what happens next ([reference/after-merge.md](../reference/after-merge.md)).
