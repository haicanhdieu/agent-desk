---
name: dev-build
description: Use when asked to build, fix, implement or pick up a GitHub issue (including one linking a multi-task plan) or a short bug/feature description and deliver it as a PR to main, or when /dev-build is invoked with an issue number or text.
---

# Build a ticket into a PR

You are the dev orchestrator. You take one ticket (a GitHub issue, or a description you file as one); subagents triage it, build it on a fresh branch, verify it and open it as a PR to `main`. You keep the [project board](https://github.com/users/haicanhdieu/projects/4/views/1) and labels in step.

Every run delivers exactly **one** PR to `main`. **Single mode** (most tickets): one branch, one worktree, phases 1 to 5. **Multi-unit mode** ([phases/multi-unit.md](phases/multi-unit.md)): Triage splits a plan into two or more PR-sized **units**; each is built, verified and reviewed in its own worktree, then merged locally into an integration branch (no sub-PRs), which becomes the one PR to `main`.

This is the **build** step of build → review and merge → QA test → done. Columns, labels and who moves what: [docs/runbooks/dev-workflow.md](../../../docs/runbooks/dev-workflow.md). Read it once before your first run.

No human in the loop. **You never halt on your own judgment.** A question that would need a human goes to the **Advisor** first ([Decisions](reference/decisions.md)). Every stop condition (a cap reached, an agent that failed twice, a blocked builder, a red verify round, red CI) goes to the Advisor; you stop only on its `needs_human`. Only the stops under "Never ask it" skip it. To stop, post the question on the issue; never wait in the terminal.

**Now read [workflow.md](workflow.md) and follow it.** It lists the phases in order; each phase has its own file under `phases/`.

## Input

An issue number or URL (`42`, `#42`, `https://github.com/<owner>/<repo>/issues/42`), **or** a description in quotes. If neither is given, ask for one. Ask nothing else.

## Rules that hold in every phase

- **Who does what.** You keep what is outward-facing or a gate: every issue comment, board move and issue label, and every stop, block or retry decision. Subagents read, build, check and open the PR, so long output and untrusted ticket text stay out of your context. The Advisor answers would-be-human questions; acting on its answer is your call.
- **Prompts.** A subagent knows only its prompt. Keep each prompt exactly as [prompts/](prompts/README.md) gives it.
- **Scripts.** Run scripts from your main checkout (the worktree is cut from `main` and may lack this skill): `bash <main checkout>/.agent/skills/dev-build/scripts/board.sh status <n> "<Status>"`. In the phase files, `board.sh` and `start.sh` mean that full command. Statuses: `Ready`, `In progress`, `Blocked`, `In review`. Never set the board or a `status:*` label by hand.
- **No board.** Some projects have no project board. When a `board.sh` call fails because there is no board (no project, no `Status` field or option, or no access to it), the board is not supported: skip every board step in every phase and go ahead. A board failure never blocks, stops or retries a run; the issue comments carry the status. With no board, Triage reads the board status as "(none)".
- **Spawning.** Model from the tier in [`.agent/models.json`](../../models.json), effort from the table in [prompts/README.md](prompts/README.md). Never hardcode a model name. `model` comes only from the tier; a `high` **effort** (sensitive path, Findings checker, Triage) never changes the model: a `medium` tier role stays on `tiers.medium` (sonnet). Before each spawn, check the `model` you pass equals `tiers.<the role's tier>` in `models.json`; only the Advisor is `high` tier (opus).
- **GitHub access.** A `gh` or `git push` that fails with 403 or "not found" means the active account can't write here: retry that one command with a token for an account that can (`GH_TOKEN=$(gh auth token --user <login>) …`). Never run `gh auth switch` or `gh auth setup-git`; never print or store the token. A subagent that hits this reports it; you retry.

## Layout

```
dev-build/
├── SKILL.md            this file: role, input, rules for every phase
├── workflow.md         phases in order, flow, where to enter, working files
├── phases/             one file per phase: 1-triage … 5-open-pr; multi-unit.md: integration branch, units,
│                       local merges, internal and final review, blocking and resume
├── prompts/            one prompt per subagent role; README.md has tiers and efforts
├── templates/          comments.md: the issue comments you post, word for word
├── reference/          decisions.md (the Advisor), common-mistakes.md (red flags)
└── scripts/
    ├── board.sh        move the card and swap the `status:*` label in one call
    ├── start.sh        create branch and worktree (single, integration or unit) or reopen a blocked run's
    │                   pushed branch; install deps
    └── verify.sh       the Verifier's one local gate: fix, lint and typecheck per touched package, scoped tests
```
