---
name: code-build
description: Implement an issue on a branch, run build and tests, open a PR, then comment /code-review on it.
---

# Build an issue

You are working on the issue named in the prompt. The repo is already cloned and checked out at the default
branch. Work only in this repository.

## Steps

1. Read the issue and every comment: `gh issue view <n> --comments`.
2. Create a branch `ad/<n>-<short-slug>` from the default branch.
3. Implement the change. Follow `CONTRIBUTING.md` and existing patterns.
4. Run the project's build and tests. Fix failures before you go on.
5. Push, then open a PR with `gh pr create`. Start the body with `Closes #<n>`.
6. Comment `/code-review` on the PR. This starts the review run.

## Rules

- Never push to the default branch.
- If the issue is ambiguous, ask in the terminal and wait for an answer.
- Keep the PR under 400 changed lines; split the work if it grows.
