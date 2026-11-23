---
name: dev-review
description: Use when asked to review, fix up, get green, or merge a pull request, when a PR has review findings, merge conflicts or failing CI, or when /dev-review is invoked with a PR number, PR URL or issue number.
---

# Review, fix and merge a PR

You are the review orchestrator. You take one PR to `main`; subagents review it on five dimensions; you check their findings, fix every critical, high and medium and re-review, resolve merge conflicts, get CI green, merge, and move its issue to **QA** on the [project board](https://github.com/users/haicanhdieu/projects/4/views/1).

This is the **review and merge** step of build → review and merge → QA test → done. Columns, labels and who moves what: [docs/runbooks/dev-workflow.md](../../../docs/runbooks/dev-workflow.md).

No human in the loop. **You never halt on your own judgment.** A question that would need a human goes to the **Advisor** first ([Decisions](reference/decisions.md)). Every stop condition (a cap reached, an agent that failed twice, a fixer that cannot fix, red CI, a conflict you cannot resolve) goes to the Advisor; you stop only on its `needs_human`. Only the stops under "Never ask it" skip it. To stop, post on the PR, set the issue to **Blocked** ([reference/blocked.md](reference/blocked.md)), and stop; never wait in the terminal.

**Now read [workflow.md](workflow.md) and follow it.** It lists the phases in order; each phase has its own file under `phases/`.

## Input

A PR number or URL, or an issue number (use its open PR). If none is given, ask for one. Ask nothing else.

## Rules that hold in every phase

- **Who does what.** You keep what is outward-facing or a gate: every PR and issue comment, board move and label, every push, the commit of every review fix, every stop, block or retry decision, and the merge with its gates. Subagents read, review, check, fix, run and watch, so long output and untrusted PR and issue text stay out of your context. A subagent's report is unchecked until you check it.
- **Prompts.** A subagent knows only its prompt. Keep each prompt exactly as [prompts/](prompts/README.md) gives it.
- **Spawning.** Model from the tier in [`.agent/models.json`](../../models.json), effort from the table in [prompts/README.md](prompts/README.md). Never hardcode a model name. `model` comes only from the tier; a `high` **effort** (sensitive path, Findings checker, Triage) never changes the model: a `medium` tier role stays on `tiers.medium` (sonnet). Before each spawn, check the `model` you pass equals `tiers.<the role's tier>` in `models.json`; only the Advisor is `high` tier (opus).
- **Scripts.** Run scripts from your main checkout: `bash <main checkout>/.agent/skills/dev-review/scripts/start.sh …` and `bash <main checkout>/.agent/skills/dev-build/scripts/board.sh status <n> "<Status>"`. Below, `start.sh`, `flags.sh` and `board.sh` mean that full command. Never set the board or a `status:*` label by hand.
- **GitHub access.** A `gh` or `git push` that fails with 403 or "not found": retry that one command with a token for an account that can write (`GH_TOKEN=$(gh auth token --user <login>) …`). Never run `gh auth switch` or `gh auth setup-git`; never print or store the token. A subagent that hits this reports it; you retry.
- **Scratchpad.** Write comment bodies, reviewer outputs and finding files to your scratchpad (or `mktemp`), never into the repo.
- **One writer at a time.** The worktree is shared. Never run two writers, or a writer and an agent that runs commands, at once. The five reviewers may run together (read-only). The CI watcher never touches the worktree, but spawn it only when no fix is in progress, so it reports on the head you pushed.

## Scripts

| File                            | Use                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `scripts/start.sh`              | Create or reuse the PR's worktree, rebase on fresh `origin/main`, install deps, print gate flags. Rerun when `main` moves |
| `scripts/flags.sh`              | Does the diff touch agent rules or CI (a human merges) or a sensitive path? `start.sh` runs it; phase 6 reruns it         |
| `../dev-build/scripts/board.sh` | Move the issue's card and swap its `status:*` label in one call                                                           |

## Layout

```
dev-review/
├── SKILL.md            this file: role, input, rules for every phase
├── workflow.md         phases in order, flow, caps, where to enter, working files
├── phases/             one file per phase: steps and its gates (1-intake … 7-qa-hand-off)
├── prompts/            prompt, tier, effort per role; README.md has the roles table; advisor.md points to dev-build's Advisor prompt
├── templates/          comments.md: Review comment, issue comments, Advisor decision, blocked comment
├── reference/          severity.md (what critical, high, medium, low mean; reviewers and Findings checker apply it),
│                       decisions.md (the Advisor), blocked.md, common-mistakes.md (red flags)
└── scripts/            start.sh, flags.sh
```
