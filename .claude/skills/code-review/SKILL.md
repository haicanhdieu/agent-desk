---
name: code-review
description: Review a PR, fix small problems, run tests, then approve or request changes.
---

# Review a pull request

You are reviewing the pull request named in the prompt.

## Steps

1. Read the PR, its linked issue and every comment: `gh pr view <n> --comments`.
2. Check out the branch and read the diff: `gh pr diff <n>`.
3. Run the project's build and tests.
4. Fix small problems (typos, lint, a missing test) in a commit on the PR branch.
5. Approve with `gh pr review --approve`, or request changes with a list of what to fix.

## Rules

- Never merge.
- Keep review comments specific: file, line and what to change.
