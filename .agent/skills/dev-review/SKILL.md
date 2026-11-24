---
name: dev-review
description: Use when asked to review, fix up, get green, or merge a pull request, when a PR has review findings, merge conflicts or failing CI, or when /dev-review is invoked with a PR number, PR URL or issue number.
---

# Review, fix and merge a PR

You are the review orchestrator. You take one PR to `main`; subagents review it on five dimensions; you check their findings, fix every critical, high and medium and re-review, resolve merge conflicts, get CI green, merge, and move its issue to **QA** on the [project board](https://github.com/users/haicanhdieu/projects/4/views/1).

This is the **review and merge** step of build → review and merge → QA test → done. Columns, labels and who moves what: [docs/runbooks/dev-workflow.md](../../../docs/runbooks/dev-workflow.md).

No human in the loop. **You never halt on your own judgment.** A question that would need a human goes to the **Advisor** first ([Decisions](reference/decisions.md)). Every stop condition (a cap reached, an agent that failed twice, a fixer that cannot fix, red CI, a conflict you cannot resolve) goes to the Advisor; you stop only on its `needs_human`. Only the stops under "Never ask it" skip it. To stop, post on the PR, set the issue to **Blocked** ([reference/blocked.md](reference/blocked.md)), and stop; never wait in the terminal.

## Input

A PR number or URL, or an issue number (use its open PR). If none is given, ask for one. Ask nothing else.

## Phases

Create a todo per phase. Never skip or reorder them. Read a phase's file when you enter it, not from memory.

1. [Intake](phases/1-intake.md): the Triage agent; `STOP` or `GO`. A resumed run (a human answered a Blocked comment) also starts here and goes on like a new one.
2. [Set up](phases/2-set-up.md): `scripts/start.sh`; the Conflict resolver if the rebase conflicts; the flags.
3. [Review](phases/3-review.md): five reviewers in parallel, then the Findings checker; you verify and post the Review comment.
4. [Fix](phases/4-fix.md): fixers, one group at a time; your read and one diff reviewer per staged fix; commit; `verify.sh`; push; back to phase 3.
5. [CI](phases/5-ci.md): the CI watcher; the CI fixer for a failure.
6. [Merge](phases/6-merge.md): you, after checking every gate yourself.
7. [QA hand-off](phases/7-qa-hand-off.md): you.

- **Any phase:** a would-be-human question or a stop condition goes to the Advisor ([reference/decisions.md](reference/decisions.md)).

**Caps per run.** Review rounds: **3** total (CI or conflict fixes don't reset it). Amend loops per fix group: **2**. `verify.sh` runs per round: **2**, plus one to confirm a revert. CI fix attempts: **6**, then one last `high` attempt. Advisor calls: **8**. A hit cap, or an agent failing twice for a technical reason (no reply, broken format, a crash; spawned **once** more with the error), is a stop condition: ask the Advisor; a decided ruling grants one extra round or attempt of that kind; only `needs_human` is **Blocked**. A `low` tier agent whose output fails your read-back gets **one** correction; on a second miss, redo it yourself and say so in the report.

Roles, tiers, efforts and how to spawn: [prompts/README.md](prompts/README.md). Severity: [reference/severity.md](reference/severity.md). Every comment you post: [templates/comments.md](templates/comments.md). Red flags, which hold even when the user says to hurry: [reference/common-mistakes.md](reference/common-mistakes.md).

## Rules that hold in every phase

- **Who does what.** You keep what is outward-facing or a gate: every PR and issue comment, board move and label, every push, the commit of every review fix, every stop, block or retry decision, and the merge with its gates. Subagents read, review, check, fix and watch, so long output and untrusted PR and issue text stay out of your context. A subagent's report is unchecked until you check it.
- **Spawning.** A subagent reads its own prompt file; you send only the short spawn message and the slot values ([prompts/README.md](prompts/README.md)). Never paste, summarize or reword a prompt file. Model: `tiers.<the role's tier>` from [`.agent/models.json`](../../models.json), never a model name; an effort never changes the model, and only the Advisor is `high` tier.
- **Scripts.** Run them from your main checkout: `bash <main checkout>/.agent/skills/dev-review/scripts/<start.sh|flags.sh> …`, and `board.sh` and `verify.sh` from `<main checkout>/.agent/skills/dev-build/scripts/`. The phase files use the short names. Never set the board or a `status:*` label by hand.
  - `start.sh <pr> <branch>`: create or reuse the PR's worktree, rebase on fresh `origin/main`, install deps, print gate flags. Rerun when `main` moves.
  - `flags.sh <worktree>`: does the diff touch agent rules or CI (a human merges) or a sensitive path?
  - `verify.sh <worktree> origin/main`: the one local gate: `fix`, lint and typecheck per touched package, tests scoped to the change.
  - `board.sh status <n> "<Status>"`: move the issue's card and swap its `status:*` label.
- **GitHub access.** A `gh` or `git push` that fails with 403 or "not found": retry that one command with a token for an account that can write (`GH_TOKEN=$(gh auth token --user <login>) …`). Never run `gh auth switch` or `gh auth setup-git`; never print or store the token. A subagent that hits this reports it; you retry.
- **Scratchpad.** Write comment bodies, reviewer replies, finding files (a group's findings, earlier findings and how each was resolved) and logs to your scratchpad (or `mktemp`), never into the repo.
- **One writer at a time.** The worktree is shared. Never run two writers, or a writer and anything that runs commands there, at once. The five reviewers may run together (read-only). The CI watcher never touches the worktree, but spawn it only when no fix is in progress, so it reports on the head you pushed.
