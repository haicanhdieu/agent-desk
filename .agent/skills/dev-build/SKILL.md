---
name: dev-build
description: Use when asked to build, fix, implement or pick up a GitHub issue or a short bug/feature description and deliver it as a PR to main, or when /dev-build is invoked with an issue number or text.
---

# Build a ticket into a PR

You are the dev orchestrator. You take one ticket (a GitHub issue, or a description you file as one), decide whether it is a bug or a feature, get it built on a fresh branch by subagents, verify it, open a PR to `main`, and keep the [project board](https://github.com/users/haicanhdieu/projects/4/views/1) and labels in step.

This is the **build** step of build → review and merge → QA test → done. The columns, labels and who moves what are in [docs/runbooks/dev-workflow.md](../../../docs/runbooks/dev-workflow.md). Read it once before your first run.

The run needs no human in the loop. When you need a human decision, you post it on the issue and stop; you never wait in the terminal.

## Input

- An issue number or URL (`42`, `#42`, `https://github.com/<owner>/<repo>/issues/42`), **or**
- A description in quotes.

If neither is given, ask for one. Ask nothing else.

## Files

| File                                 | Use                                                     |
| ------------------------------------ | ------------------------------------------------------- |
| [agent-prompts.md](agent-prompts.md) | Prompt, tier and effort for the fixer and implementer   |
| [comments.md](comments.md)           | The issue comments you post, word for word              |
| `scripts/board.sh`                   | Move the card and swap the `status:*` label in one call |

Run it from your main checkout (the worktree is cut from `main` and may not have this skill yet): `bash <main checkout>/.agent/skills/dev-build/scripts/board.sh status <n> "<Status>"`. Below, `board.sh` means that full command. Statuses: `Ready`, `In progress`, `Blocked`, `In review`. Never set the board or a `status:*` label by hand.

**GitHub access.** If a `gh` or `git push` call fails with 403 or "not found", the active account can't write here. Retry that one command with a token for an account that can (`GH_TOKEN=$(gh auth token --user <login>) …`). Never run `gh auth switch` or `gh auth setup-git`, and never print or store the token.

## Steps

Create a todo per step. Do not skip or reorder them.

### 1. Load the ticket

- **Description:** file it first: `gh issue create --title "<one-line summary>" --body "<the description verbatim>"`, then continue with the new number. Add the type label in step 2.
- **Issue:** read everything:

  ```sh
  gh issue view <n> --json number,title,body,labels,state,comments,url
  gh api repos/{owner}/{repo}/issues/<n> --jq '.type.name // empty'   # issue type, if the repo has types
  bash .agent/skills/dev-build/scripts/board.sh get <n>
  gh pr list --state open --search "<n> in:body" --json number,headRefName,url
  ```

Stop and report to the user (no comment, no board change) when:

- the issue is closed;
- the board says `In progress`, `In review`, `QA` or `Done`, or an open PR already references it. Someone else owns it.

If it is `Blocked`, read the comments after your last `**dev-build:` comment. Continue only if they answer it; otherwise stop and report. Never post the same question twice.

### 2. Decide: bug or feature

Use the first rule that matches:

| Signal                                                                                                                            | Kind                        |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Label `bug` or `qa:failed`, or issue type `Bug`                                                                                   | bug                         |
| Label `enhancement`, or issue type `Feature` / `Task`                                                                             | feature                     |
| Body or comments describe broken existing behavior: an error, a stack trace, "expected … but …", steps to reproduce, a regression | bug                         |
| Body asks for behavior that does not exist yet                                                                                    | feature                     |
| Still unsure                                                                                                                      | Blocked, ask which (step 3) |

Add the type label if missing: `gh issue edit <n> --add-label bug` (or `enhancement`).

### 3. Check it is clear enough to build

**Bug** is clear when it says what was done, what was expected and what happened instead (error text, screenshot, run id, or failing test). One line each is enough. For `qa:failed`, the QA comment is the repro.

**Feature** is clear when either:

- the issue body or a comment has a task list an implementer can follow without guessing: `- [ ]` items or numbered steps that each name a behavior and where it goes, and some way to tell it is done (acceptance criteria, expected UI, test to pass); **or**
- it links a plan in `docs/superpowers/plans/` that exists on `origin/main` and covers the ticket.

A title plus a paragraph of intent ("add retry", "make the dashboard better") is **not** clear. Neither is a list of goals with no steps. Do not write the plan yourself: planning needs human decisions, and this skill is for building.

If not clear:

1. Post the **Needs clarification** comment from [comments.md](comments.md), listing exactly what is missing (only real gaps, at most 3 questions, one line each; do not pad to 3).
2. `board.sh status <n> Blocked`.
3. Report to the user and **stop**. No branch, no code.

### 4. Branch from the latest main

```sh
git fetch origin main
root=$(git rev-parse --show-toplevel)
git worktree add -b <type>/<n>-<slug> "$root-wt/<n>" origin/main
```

`<type>` is `fix` for a bug, `feat` for a feature; `<slug>` is 2–4 kebab-case words from the title. Do all work in that worktree; leave the user's checkout alone. Install deps there (`pnpm install` inside `devbox shell`, or `devbox run` scripts).

Then:

1. `board.sh status <n> "In progress"`.
2. Post the **Started** comment from [comments.md](comments.md).

### 5. Build

Dispatch subagents with the Agent tool, using the prompts, tier and effort in [agent-prompts.md](agent-prompts.md). They work in the worktree and commit there; you do not edit code yourself.

- **Bug:** one **Fixer**. It applies `superpowers:systematic-debugging` to find the root cause, then `superpowers:test-driven-development`: a failing test that reproduces the bug first (repo rule 9), then the fix.
- **Feature:** one **Implementer** per task in the task list or plan, **in order**, each applying `superpowers:test-driven-development`. Wait for each before sending the next. Tick the task's checkbox in the plan file (if the plan is in the repo) in the same commit.

A subagent that reports it is blocked by the requirement (contradiction, missing decision): post the **Needs clarification** comment with its question, `board.sh status <n> Blocked`, push the branch so work is not lost, and stop. A subagent that fails for a technical reason: re-dispatch once with the error; if it fails again, treat it as blocked.

### 6. Verify

In the worktree, run and read the output yourself (`superpowers:verification-before-completion`):

```sh
devbox run fix                                  # must print "fix: clean."
pnpm --filter @agentdesk/<pkg> typecheck        # once per touched package:
pnpm --filter @agentdesk/<pkg> test             # api, worker, web, contracts, core, db
```

Failures go back to the subagent that owns them (step 5 rules). Do not claim success, open the PR or move the card on output you did not see pass. `format:check` fails repo-wide until the one-time reformat lands; `fix` covers your files.

Self-review the diff against [code-review-checklist.md](../../../docs/conventions/code-review-checklist.md). Check scope: only what the ticket asks for, about 400 changed lines or fewer.

### 7. Open the PR

Invoke the **`create-pr`** skill ([create-pr/SKILL.md](../create-pr/SKILL.md)). It owns the title, body template, labels, local preflight and the `gh pr create` call; do not write a PR body or run `gh pr create` yourself. Run it from the worktree. Pass it:

- head branch `<branch>`, base `main`, and push authorization (`git push -u origin <branch>` is allowed);
- type `bugfix` or `feature` (from step 2), `agent-authored: true`, and the issue number (it writes `Closes #<n>`, so merging closes the issue);
- the summary, root cause (bugs), verification results from step 6, the subagents' JUDGMENT CALLS and your own, and the plan path for a feature.

Keep the PR's "Authored by an AI agent (`dev-build`)" attribution out of the body; `agent-authored` is the label. If `create-pr` stops on a failed preflight, treat it like a step 6 failure.

Then:

1. `board.sh status <n> "In review"`.
2. Post the **PR opened** comment from [comments.md](comments.md).
3. Report to the user: issue, kind, branch, PR URL, verification results (failures included), judgment calls.

You never approve, merge, or move the card past `In review`; that is `dev-review`'s job.

## Red flags: stop

These hold even when the user says to hurry or to skip a step. Say so in your report and keep the rule.

| Thought                                            | Reality                                                   |
| -------------------------------------------------- | --------------------------------------------------------- |
| "The feature is vague but I can infer the tasks"   | Inferred tasks are guesses. Ask (step 3).                 |
| "I'll write a quick plan and build it"             | Planning is a human decision. Ask.                        |
| "The bug is obvious, skip the failing test"        | Rule 9: the failing test comes first. Every time.         |
| "Tests mostly pass; open the PR and note it"       | Fix or block. A PR is only opened on green verification.  |
| "There's already a branch for this, I'll reuse it" | Someone owns it. Stop and report (step 1).                |
| "I'll branch from my current checkout"             | Branch from freshly fetched `origin/main`, in a worktree. |
| "`Refs #n` links the PR well enough"               | It leaves the issue open after merge. `Closes #n`.        |
| "The user said skip the test / just build it"      | The rules still apply. Explain why in the report.         |
| "I'll ask in the terminal and wait"                | Post on the issue, set Blocked, stop.                     |
| "Small fix nearby, I'll include it"                | Out of scope. Mention it in the PR instead.               |
