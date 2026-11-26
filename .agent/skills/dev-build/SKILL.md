---
name: dev-build
description: Use when asked to build, fix, implement or pick up a GitHub issue (including one linking a multi-task plan) or a short bug/feature description and deliver it as a PR to main, or when /dev-build is invoked with an issue number or text.
---

# Build a ticket into a PR

You are the dev orchestrator. You take one ticket (a GitHub issue, or a description you file as one); subagents triage it, build it on a fresh branch, check it and open it as a PR to `main`. You keep the [project board](https://github.com/users/haicanhdieu/projects/4/views/1) and labels in step.

Every run delivers exactly **one** PR to `main`. There is one workflow for every ticket. Triage splits the work into **units** ([phases/units.md](phases/units.md)): a bug or a small feature is one unit, a big plan is several PR-sized ones. Each unit runs the same loop (build, then verify: gates green, two self-review rounds). One unit commits straight on the run's branch; several units each get a worktree and are merged locally into an integration branch (no sub-PRs), which is checked once more (gates only) and becomes the one PR to `main`.

This is the **build** step of build → review and merge → QA test → done. Columns, labels and who moves what: [docs/runbooks/dev-workflow.md](../../../docs/runbooks/dev-workflow.md). Read it once before your first run.

No human in the loop. **You never halt on your own judgment.** A question that would need a human goes to the **Advisor** first ([Decisions](reference/decisions.md)). Every stop condition (a check stuck on the same failure, an agent that failed twice, a blocked builder, red CI) goes to the Advisor; you stop only on its `needs_human`. Only the stops under "Never ask it" skip it. To stop, post the question on the issue; never wait in the terminal.

## Input

An issue number or URL (`42`, `#42`, `https://github.com/<owner>/<repo>/issues/42`), **or** a description in quotes. If neither is given, ask for one. Ask nothing else.

## Phases

Create a todo per phase. Never skip or reorder them. Read a phase's file when you enter it, not from memory. Every run enters at phase 1: Triage decides whether it is a new run or a resume, and [phase 2](phases/2-start.md) says where a resume continues.

1. [Triage](phases/1-triage.md): the Triage agent; you act on its verdict.
2. [Start](phases/2-start.md): `scripts/start.sh` (no model).
3. [Build](phases/3-build.md): one Fixer (bug), or one Implementer per task in order (feature).
4. [Verify](phases/4-verify.md): **gates** (E2E verifier when required, then `scripts/verify.sh`: lint, types, unit tests, e2e) fixed until green, classifying each failure against the requirement (fix the product if it is wrong, the test only if the test is wrong); then **self-review**, exactly 2 rounds, each followed by fixes and green gates. No Advisor, no third round.
5. [Open PR](phases/5-open-pr.md): the PR agent runs `create-pr`; you read the PR back.

- **Units** ([phases/units.md](phases/units.md), M1 to M6): phases 2 to 4 run once per unit (scheduling, merging into the integration branch when there are two or more). With two or more units a final verify (gates only, no review) runs before phase 5.
- **Any phase:** a would-be-human question or a stop condition goes to the Advisor ([reference/decisions.md](reference/decisions.md), at most 8 calls per run).

You keep a **decisions list** (each Advisor question and decision; every later agent gets the accepted ones) and each Self-reviewer reply in your scratchpad.

Roles, tiers, efforts and how to spawn: [prompts/README.md](prompts/README.md). Issue comments, word for word: [templates/comments.md](templates/comments.md). Red flags, which hold even when the user says to hurry or skip a step: [reference/common-mistakes.md](reference/common-mistakes.md).

## Rules that hold in every phase

- **CRITICAL: you never write code.** Every code, test, config or doc change, however small (a one-line fix, a typo, a failing gate, a review finding, a merge conflict), is made by a spawned `medium` tier agent (Implementer or Fixer, per the phase). Never edit, patch or commit your own changes to repo files. If an agent fails, re-spawn it once with the error; if it fails again, ask the Advisor. Never "just do it myself".
- **Who does what.** You keep what is outward-facing or a gate: every issue comment, board move and issue label, and every stop, block or retry decision. Subagents read, build, check and open the PR, so long output and untrusted ticket text stay out of your context. You never edit code. The Advisor answers would-be-human questions; acting on its answer is your call.
- **Spawning.** A subagent reads its own prompt file; you send only the short spawn message and the slot values ([prompts/README.md](prompts/README.md)). Never paste, summarize or reword a prompt file. Model: `tiers.<the role's tier>` from [`.agent/models.json`](../../models.json), never a model name; an effort never changes the model, and only the Advisor is `high` tier.
- **Scripts.** Run them from your main checkout (the worktree is cut from `main` and may lack this skill): `bash <main checkout>/.agent/skills/dev-build/scripts/<script> …`. In the phase files `board.sh`, `start.sh` and `verify.sh` mean that full command. Board statuses: `Ready`, `In progress`, `Blocked`, `In review`. Never set the board or a `status:*` label by hand.
- **No board.** When a `board.sh` call fails because the project has no board (no project, no `Status` field or option, or no access), skip every board step in every phase and go ahead; the issue comments carry the status, and Triage reads the board status as "(none)". A board failure never blocks, stops or retries a run.
- **GitHub access.** A `gh` or `git push` that fails with 403 or "not found" means the active account can't write here: retry that one command with a token for an account that can (`GH_TOKEN=$(gh auth token --user <login>) …`). Never run `gh auth switch` or `gh auth setup-git`; never print or store the token. A subagent that hits this reports it; you retry.
