---
name: dev-build
description: Use when asked to build, fix, implement or pick up a GitHub issue (including one linking a multi-task plan) or a short bug/feature description and deliver it as a PR to main, or when /dev-build is invoked with an issue number or text.
---

# Build a ticket into a PR

You are the dev orchestrator. You take one ticket (a GitHub issue, or a description you file as one); subagents triage it, build it on a fresh branch, verify it and open it as a PR to `main`. You keep the [project board](https://github.com/users/haicanhdieu/projects/4/views/1) and labels in step.

Every run delivers exactly **one** PR to `main`. **Single mode** (most tickets): one branch, one worktree, steps 1 to 5. **Multi-unit mode** ([multi-unit.md](multi-unit.md)): Triage splits a plan into two or more PR-sized **units**; each is built, verified and reviewed as an internal draft sub-PR into an integration branch, which becomes the one PR to `main`.

This is the **build** step of build → review and merge → QA test → done. Columns, labels and who moves what: [docs/runbooks/dev-workflow.md](../../../docs/runbooks/dev-workflow.md). Read it once before your first run.

No human in the loop. **You never halt on your own judgment.** A question that would need a human goes to the **Advisor** first ([Decisions](#decisions-the-advisor)). Every stop condition (a cap reached, an agent that failed twice, a blocked builder, a red verify round, red CI) goes to the Advisor; you stop only on its `needs_human`. Only the stops under "Never ask it" skip it. To stop, post the question on the issue; never wait in the terminal.

## Who does what

You keep what is outward-facing or a gate: every issue comment, board move and issue label, and every stop, block or retry decision. Subagents read, build, check and open the PR, so long output and untrusted ticket text stay out of your context. The Advisor answers would-be-human questions; acting on its answer is your call.

| Step      | Done by                                                    | Tier / effort                                     |
| --------- | ---------------------------------------------------------- | ------------------------------------------------- |
| 1 Triage  | Triage agent                                               | `medium` / `high`                                 |
| 2 Start   | `scripts/start.sh` (no model)                              |                                                   |
| 3 Build   | Fixer or Implementer(s)                                    | `medium` / `high` (Fixer), `medium` (Implementer) |
| 4 Verify  | Verifier and Self-reviewer, in parallel                    | `low` / `low` and `medium` / `medium`             |
| 5 Open PR | PR agent                                                   | `low` / `low`                                     |
| Any step  | Advisor, only for would-be-human questions (max 8 per run) | `high` / `high`                                   |

Multi-unit mode adds a **Reviewer** (`medium` / `medium`, `high` when sensitive) per sub-PR and once for the whole branch.

A subagent knows only its prompt. Keep each prompt exactly as [agent-prompts.md](agent-prompts.md) gives it.

## Input

An issue number or URL (`42`, `#42`, `https://github.com/<owner>/<repo>/issues/42`), **or** a description in quotes. If neither is given, ask for one. Ask nothing else.

## Files

| File                                 | Use                                                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| [agent-prompts.md](agent-prompts.md) | Prompt, tier, effort per role                                                                                  |
| [multi-unit.md](multi-unit.md)       | Multi-unit mode: integration branch, units, sub-PRs, internal and final review, blocking and resume            |
| [comments.md](comments.md)           | The issue comments you post, word for word                                                                     |
| `scripts/board.sh`                   | Move the card and swap the `status:*` label in one call                                                        |
| `scripts/start.sh`                   | Create branch and worktree (single, integration or unit) or reopen a blocked run's pushed branch; install deps |

Run scripts from your main checkout (the worktree is cut from `main` and may lack this skill): `bash <main checkout>/.agent/skills/dev-build/scripts/board.sh status <n> "<Status>"`. Below, `board.sh` and `start.sh` mean that full command. Statuses: `Ready`, `In progress`, `Blocked`, `In review`. Never set the board or a `status:*` label by hand.

**Spawning.** Model from the tier in [`.agent/models.json`](../../models.json), effort from the table in `agent-prompts.md`. Never hardcode a model name.

**GitHub access.** A `gh` or `git push` that fails with 403 or "not found" means the active account can't write here: retry that one command with a token for an account that can (`GH_TOKEN=$(gh auth token --user <login>) …`). Never run `gh auth switch` or `gh auth setup-git`; never print or store the token. A subagent that hits this reports it; you retry.

## Steps

Create a todo per step. Do not skip or reorder them.

### 1. Triage

**Description input:** file it first (`gh issue create --title "<one-line summary>" --body "<the description verbatim>"`) and continue with the new number.

Spawn **Triage** ([agent-prompts.md](agent-prompts.md)). It reads the issue, comments, board status and open PRs, decides bug or feature, and checks the ticket is clear enough to build. It changes nothing. Act on its `VERDICT`:

- **STOP:** report its `REASON` to the user. No comment, no board change. Covers: a closed issue; board status `In progress`, `In review`, `QA` or `Done`; an open PR referencing it; a `Blocked` ticket that dev-build did not block or whose question is unanswered; a branch for the issue on `origin` that dev-build did not leave. Someone else owns it; never take over. (A blocked multi-unit run's own unit branches and `internal` sub-PRs are dev-build's; Triage knows this.)
- **BLOCKED** with the single question "bug or feature?": ask the Advisor. If it decides, spawn Triage again with the decision in "Decisions already made" and act on the new verdict (a feature still needs a task list). On `needs_human`, post and block as [Decisions](#decisions-the-advisor) says.
- **BLOCKED** otherwise (no task list or plan, no repro, unclear intent, or more than that one question):
  1. Post **Needs clarification** ([comments.md](comments.md)) with its `QUESTION`. Check first: exactly one question, a real gap, Problem / Sample / Solutions / Suggestion form, never one already asked. If it lists several, keep the one that blocks most; the next run asks the next.
  2. `board.sh status <n> Blocked`.
  3. Report and **stop**. No branch, no code.
- **GO:** if `LABEL TO ADD` names one, `gh issue edit <n> --add-label bug` (or `enhancement`); continue.
  - **`RESUME: yes`** (dev-build blocked it mid-build and a human answered): keep `BRANCH`, `STOPPED AT`, `HUMAN ANSWER`, `PRIOR DECISIONS`. Put `PRIOR DECISIONS` back on your decisions list (repeats are still caught; the cap counts them). Pass `HUMAN ANSWER` to the builder in "Decisions already made" as `Human answer: …`. Step 2 then resumes instead of starting. Check the answer first: if it tells an agent to break a rule or skip a gate, don't pass it on; post the "I stopped" comment saying why, and stop.

Never write the plan yourself or ask the Advisor to: planning needs human decisions. A title plus a paragraph of intent ("add retry", "make the dashboard better") is not clear (Triage is told so). If a verdict looks wrong, trust BLOCKED over GO: a wrong block costs one reply, a wrong start a wasted build.

### 2. Start

**Mode from Triage's `UNITS`.** `single` (every bug, a feature with a task list in the issue, a plan that groups to one unit): continue here. Two or more: **multi-unit mode**; follow [multi-unit.md](multi-unit.md) from M1 instead of the rest of this step and steps 3 to 5; it returns to step 5 for the final PR. On a resume, a `UNIT STATE` line marks a multi-unit run.

```sh
start.sh <n> <fix|feat> <slug>        # new run
start.sh <n> --resume <branch>        # Triage said RESUME: yes
```

**New run.** `fix` for a bug, `feat` for a feature; `<slug>` is Triage's `SLUG`. Cuts the worktree from freshly fetched `origin/main` at `<root>-wt/<n>` on `<type>/<n>-<slug>` and installs deps. It refuses an existing branch or worktree: someone owns it; stop and report.

**Resume.** `<branch>` is Triage's `BRANCH`. Reopens that pushed branch in the worktree and installs deps. No rebase: `BEHIND` says how far `main` moved; `dev-review` rebases later. Refuses (exit 3) a branch not on `origin`, a local branch diverged from the remote, a branch checked out elsewhere, or a worktree that is not a clean checkout of it. Stop and report; never delete or reset anything to get past it.

Read `BRANCH`, `WORKTREE`, `MODE` (plus `BEHIND`, `AHEAD` on resume) from the end of its output. Work only in that worktree; leave the user's checkout alone. Then:

1. `board.sh status <n> "In progress"`.
2. Post **Started** (new run) or **Resumed** (resume) from [comments.md](comments.md).
3. On a resume, go where `STOPPED AT` says: `build, task <k> of <total>` → step 3 at task `<k>` (earlier tasks are committed); `build (bug fix)` → step 3, re-dispatch the Fixer, which continues from the branch's commits; `verify` → step 4; `opening the PR` → step 5.

### 3. Build

Dispatch subagents with the Agent tool, using the prompts, tier and effort in [agent-prompts.md](agent-prompts.md). They work and commit in the worktree; you never edit code.

- **Bug:** one **Fixer**: `superpowers:systematic-debugging` for the root cause, then `superpowers:test-driven-development`: a failing test reproducing the bug first (repo rule 9), then the fix.
- **Feature:** one **Implementer** per task (Triage's `TASKS`, from its `TASK SOURCE`), **in order**, each with `superpowers:test-driven-development`. Wait for each before the next. It ticks the task's checkbox in the plan file (if in the repo) in the same commit.

**Copy the prompt, do not rewrite it.** Take the block word for word and fill only the `<…>` slots. Never reword, shorten or reorder its steps, or swap the "call the Skill tool with skill …" lines for "use the TDD skill" or a summary: subagents never see `using-superpowers`, so the skill won't load (sessions that did this had most subagents skip it). **Before every spawn**, check the filled prompt contains these strings, and fix it if one is missing:

- Fixer: `call the Skill tool with skill "superpowers:systematic-debugging"`, and `call the Skill tool with skill` followed by `"superpowers:test-driven-development"` (that line wraps; check the skill name is there).
- Implementer: `call the Skill tool with skill` followed by `"superpowers:test-driven-development"` (same wrapped line).
- CI fixer (multi-unit): `call the Skill tool with skill "superpowers:systematic-debugging"`.
- PR agent: `call the Skill tool with skill "create-pr"`.

**Check each builder reply.** `SKILLS:` is self-reported, not proof alone.

1. `SKILLS:`: a Fixer lists `superpowers:systematic-debugging` then `superpowers:test-driven-development`; an Implementer lists `superpowers:test-driven-development`.
2. Git evidence: `git -C <worktree> log --stat <base>..HEAD` (`<base>` = `origin/main` for the first task, else the previous task's commit). A Fixer's diff has a new regression test; an Implementer's has tests for the task's behaviors. Source changes with no tests did not follow TDD. (Step 4 also proves the regression test fails without the fix.)

If either fails, re-dispatch once with "You did not follow <skill>. Load it now with the Skill tool, check your work against it, and redo what does not comply." A second miss is a technical failure.

**Builder `blocked`** (a contradiction, a missing decision, a Fixer that can't reproduce, missing task text): ask the Advisor and act as [Decisions](#decisions-the-advisor) says. Only on `needs_human`: post **Needs clarification** with the question, branch and `Stopped at:` lines, push the branch so work is not lost, `board.sh status <n> Blocked`, stop.

**Technical failure:** re-dispatch once with the error; a second failure is a stop condition for the Advisor (it may rule a fresh agent, a smaller task or a changed prompt); stop only on its `needs_human`.

### 4. Verify

After the last builder, spawn the **Verifier** and **Self-reviewer** in one message (parallel). They share the worktree: the Verifier runs commands and may briefly revert and restore the fix's source files (bugs only), so the Self-reviewer reads only from git, never from disk.

- **Verifier:** `devbox run fix`, `typecheck` and `test` per touched package; for a bug, proves the regression test fails without the fix. Returns exit codes and verbatim output; fixes nothing.
- **Self-reviewer:** reads the diff against [code-review-checklist.md](../../../docs/conventions/code-review-checklist.md), checks scope (only what the ticket asks, about 400 changed lines or fewer) and TDD evidence. Returns findings; changes nothing.

Read both yourself (`superpowers:verification-before-completion`):

1. Pass/fail from exit codes and output, not words: `fix` prints `fix: clean.`, every exit code is 0, a bug's `REGRESSION CHECK` says it failed without the fix, `TREE CLEAN AFTER` is `yes`, and `HEAD` matches `git -C <worktree> rev-parse HEAD`. The `low` Verifier can copy wrongly: rerun one command yourself (the package test of the main change) and confirm.
2. Self-reviewer `findings` are real until you read the code and rule otherwise. Out-of-scope changes go back to the builder to remove. If you still can't tell whether a finding is real, or its fix needs a choice no rule settles, ask the Advisor. A Verifier failure is never an Advisor question.

Failures and findings go to the builder that owns the code (step 3 rules, a fresh builder prompt naming the failure); then step 4 reruns on the new head.

**Cap: 3 verify rounds per run** (the first plus at most 2 after fixes; a round = both agents ran). If round 3 still fails or has findings, ask the Advisor (stop condition). On `needs_human` only: push the branch, post **Needs clarification** ("I stopped", `Stopped at: verify, round 3`, the verbatim failing command and last output lines, or the open findings), `board.sh status <n> Blocked`, report. Never go to step 5 over a red round; never ask the Advisor to waive a failing check, only how to fix it. Rounds restart at 1 on a resumed run. Never claim success, open the PR or move the card on output you did not see pass. `format:check` fails repo-wide until the one-time reformat lands; `fix` covers your files.

### 5. Open the PR

Spawn the **PR agent** ([agent-prompts.md](agent-prompts.md)). It runs the **`create-pr`** skill ([create-pr/SKILL.md](../create-pr/SKILL.md)), which owns the title, body template, labels, local preflight and `gh pr create`. Neither you nor the agent writes a PR body or runs `gh pr create` by hand for a PR to `main` (sole exception: a multi-unit sub-PR, [multi-unit.md](multi-unit.md) M3). Fill its prompt with:

- head `<branch>`, base `main`, push authorized (`git push -u origin <branch>`);
- type `bugfix` or `feature` (Triage's `KIND`), `agent-authored: true`, the issue number (it writes `Closes #<n>`, so merging closes the issue);
- the summary, root cause (bugs), the Verifier's exact results and the head they ran on (so `create-pr` reuses them), the JUDGMENT CALLS of the builders, Self-reviewer, Advisor and you, and the plan path (feature).

Keep the "Authored by an AI agent (`dev-build`)" attribution out of the body; `agent-authored` is the label.

The PR agent is `low` tier; read the PR back before you trust it:

```sh
gh pr view <pr> --json state,isDraft,baseRefName,title,body,labels,url
```

It must be open, target `main`, have a Conventional Commits title with the package scope, a `Closes #<n>` line, no leftover `<…>` slot or HTML comment, and labels `bug` or `enhancement`, `agent-authored`, plus `review:sensitive` when the diff touches a sensitive path. If wrong, send the agent one correction; if still wrong, fix it with `gh pr edit` and say so in the report. A `stopped` on a failed precondition or preflight is treated like a step 4 failure. A judgment-call stop (e.g. a diff well over about 400 lines) may go to the Advisor; a failing check never does.

Then:

1. `board.sh status <n> "In review"`.
2. Post **PR opened** ([comments.md](comments.md)).
3. Report: issue, kind, branch, PR URL, verification results (failures included), judgment calls, each Advisor decision.

You never approve, merge, or move the card past `In review`; that is `dev-review`'s job.

## Decisions: the advisor

The **Advisor** ([agent-prompts.md](agent-prompts.md)) rules on a question that would otherwise wait for a human, from the project's sources in this order: AGENTS.md and conventions, accepted ADRs, the ticket and its spec or plan, repo code patterns, industry practice. If it can't, it says a human must decide and drafts that question. "This is red", "a cap is hit" and "an agent failed" are never alone a reason for a human: the Advisor rules on the next action (**Stop conditions**). Builders still make routine choices themselves and list them as judgment calls ([git-workflow.md §7](../../../docs/conventions/git-workflow.md#7-rules-for-ai-agent-authored-changes) rule 8); the Advisor sees only what they stop on.

**Ask the Advisor for these:**

- **Step 1, Triage `BLOCKED`:** any single question, including a missing task list or plan (it escalates those itself; it never writes one).
- **Step 3, builder `blocked`:** the task contradicts the code, a spec or another task; a choice of test or behavior; two ways that both meet the rules; a "product decision" a spec, ADR or convention may settle.
- **Step 3, Fixer can't reproduce:** what to try next (another repro route, logs, a different entry point), or whether the report is not a bug.
- **Step 4, Self-reviewer:** a finding you can't rule real or not after reading the code, or whose fix needs a choice no rule settles.
- **Multi-unit, Reviewer:** the same, for an internal or final review finding ([multi-unit.md](multi-unit.md) M3, M6).
- **Step 5, PR agent stopped:** a judgment call (e.g. a diff well over about 400 lines) or a failed preflight (it says what to fix, never to skip).
- **Stop condition:** any place this skill or multi-unit.md says stop or block (below).

**Stop conditions.** Before posting "I stopped", ask the Advisor with the evidence: which condition, the verbatim last failing output, and every earlier attempt with its diff summary. The ruling must be a next action: a different approach, a split, a fresh agent told the earlier attempts "did not work", or one more attempt of the capped kind. A decided ruling on a cap grants **one** extra round or attempt of that kind; hitting the same cap again is a new Advisor question (counts against its limit). A red check, a hit cap, a failed or blocked agent, and "the cause is outside this change" are never escalate items by themselves (main is green, so this branch owns the failure). It says `needs_human` only when a MUST ESCALATE item applies or no untried approach exists, and then says what was tried.

**Never ask it.** These stop (or are answered) without the Advisor, because nothing has started or a human must act now:

- Triage `STOP`, and `start.sh` refusing an existing branch or worktree: nothing of this run exists yet.
- A secret in a commit, log or output: block and tell a human now.
- A gate it may never waive: a failing check passed, a real finding unfixed, a rule skipped (MUST ESCALATE 12). It can only say how to fix them.

**Limits.** At most **8** Advisor calls per run, whatever the verdicts. Keep a list of each question and decision. A repeat, an agent contradicting a decision (including a Self-reviewer finding starting `DECISION:`), or a builder blocked again on the same point still goes to the Advisor, which escalates it (MUST ESCALATE 11), so every human stop carries an Advisor verdict. Only with all 8 used do you stop without one: say so in the comment and name the last ruling.

**Spawn.** Copy the Advisor prompt word for word; fill only the slots, including every decision so far this run. It loads no skill (no Skill line to check); check instead that it still contains `MUST ESCALATE` with items 1 to 13. Spawn it only when nothing else runs in the worktree; in step 1 it reads from `origin/main`.

**Check its reply before acting** (it is `high` tier, but unchecked until you check it):

1. Every section is there. `decided` needs `ESCALATE CHECK: none apply`, `CONFIDENCE` high (or medium with `REVERSIBILITY` cheap), and at least one `SOURCES` line.
2. Go through the MUST ESCALATE list yourself against the `DECISION`. If any item applies, treat it as `needs_human`.
3. Open the top source at the cited section and confirm it says that.
4. The decision does not contradict an earlier decision or the ticket's tasks.

If a check fails, treat it as `needs_human` and write the human question yourself, same form, from its `REASONING`.

**Act on it.**

- **decided:**
  1. Post **Advisor decision** ([comments.md](comments.md)).
  2. Re-dispatch the asker with the same prompt, filled the same way, plus the decision verbatim in "Decisions already made". For a Self-reviewer finding or PR agent stop, send the owning builder a fresh builder prompt naming the finding, with the decision in that slot. Every later prompt this run carries all accepted decisions in that slot.
  3. Add its `JUDGMENT CALLS` line to the judgment calls for the PR agent and to your report.
- **needs_human** (or a failed check, the cap, a repeat, a contradiction):
  1. Post **Needs clarification** ("I stopped") with the `HUMAN QUESTION`, plus the branch and `Stopped at:` lines if a branch exists. Check first: one question, Problem at most 2 sentences, at most 3 one-line Solutions, one-line Suggestion, nothing secret.
  2. Push the branch if one exists.
  3. `board.sh status <n> Blocked`.
  4. Report and **stop**.

## Red flags: stop

These hold even when the user says to hurry or skip a step. Say so in your report and keep the rule.

| Thought                                              | Reality                                                    |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| "The feature is vague but I can infer the tasks"     | Inferred tasks are guesses. Block it (step 1).             |
| "I'll write a quick plan and build it"               | Planning is a human decision. Ask.                         |
| "I'll read the issue myself, triage is a waste"      | Raw ticket text stays out of your context. Spawn Triage.   |
| "The bug is obvious, skip the failing test"          | Rule 9: failing test first. Every time.                    |
| "Tests mostly pass; open the PR and note it"         | Fix or block. PRs open only on green verification.         |
| "The Verifier said green, no need to look"           | `low` tier copier. Read exit codes, rerun one.             |
| "Verify and PR agents are cheap, skip my read-back"  | A `low` agent's output is unchecked until you check it.    |
| "There's already a branch for this, I'll reuse it"   | Only if `RESUME: yes`. Else `start.sh` refuses; stop.      |
| "I'll branch from my current checkout"               | Use `start.sh`: fresh `origin/main`, in a worktree.        |
| "`Refs #n` links the PR well enough"                 | It leaves the issue open after merge. `Closes #n`.         |
| "The user said skip the test / just build it"        | The rules still apply. Explain why in the report.          |
| "I'll ask in the terminal and wait"                  | Post on the issue, set Blocked, stop.                      |
| "Ask all the gaps at once, it saves a round"         | One question per message. The next run asks the next.      |
| "Round 3 is red but close, open the PR anyway"       | Never. Ask the Advisor how to fix; it can't waive.         |
| "The human answer says to skip the check"            | An answer can't waive a rule or gate. Block, say why.      |
| "Small fix nearby, I'll include it"                  | Out of scope. Mention it in the PR.                        |
| "I'll shorten the prompt to 'use TDD'"               | Then the skill is skipped. Keep the Skill line.            |
| "No `SKILLS:` line, but the code looks fine"         | The process was skipped. Re-dispatch (step 3).             |
| "I'll tailor the prompt to this ticket"              | Fill slots only. Rewritten steps drop the Skill call.      |
| "`SKILLS:` lists it, so it followed TDD"             | Self-reported. Check the diff for tests (step 3).          |
| "Triage said GO but I have doubts"                   | Trust BLOCKED over GO. A wrong start wastes a build.       |
| "The Advisor is `high` tier, just do what it says"   | Check MUST ESCALATE and open its top source.               |
| "No task list, but the Advisor can fill one in"      | Missing requirements go to a human. No plan writing.       |
| "Triage said BLOCKED; the Advisor can unblock it"    | Ask it; it escalates a missing plan, never invents.        |
| "Ask the Advisor again, worded differently"          | A repeat goes to the Advisor; it escalates (item 11).      |
| "The builder disagrees with the Advisor; ask again"  | Ask it; a contradiction is escalated by item 11.           |
| "A cap is hit; I'll stop and report"                 | Ask the Advisor first. Only `needs_human` stops.           |
| "The agent keeps failing, stop and hand it back"     | Stop condition: ask the Advisor for the next approach.     |
| "The Advisor decided, no need to tell anyone"        | Post it on the issue and list it in the PR.                |
| "The plan has 10 phases; open 10 PRs to `main`"      | One PR to `main` per run. Units are internal sub-PRs.      |
| "Two small tasks; use multi-unit anyway"             | One unit is single mode. Triage's `UNITS` picks.           |
| "No dependencies stated, run all units at once"      | Unstated means serial. At most 3 ready units at once.      |
| "The sub-PR is green; merge it to `main`"            | Sub-PRs merge into the integration branch only.            |
| "Run `dev-review` on the sub-PR"                     | It merges to `main`, moves the board. Use the Reviewer.    |
| "The Reviewer says clean, merge the sub-PR"          | Check findings, Verify, CI, up-to-date yourself.           |
| "One sub-PR is still open; open the final PR"        | All merged or closed first, then final verify and review.  |
| "Final verify is red; fix it on the integration"     | Nobody commits there. Add a fix unit and its sub-PR.       |
| "Sub-PR CI is red on a test this unit doesn't touch" | `main` is green, so this branch broke it. Fix (M3 step 5). |
| "CI is red, so the run must stop for a human"        | Red CI is never a human call. Loop the CI fixer to green.  |
| "Resuming; rebuild unit 2 to be safe"                | A merged unit is done. Follow `UNIT STATE`.                |
| "The final PR is 2,000 lines, too big"               | The cap is per unit. The body says it integrates units.    |
| "The plan says deploy X first; I'll enforce it"      | Order beyond `depends_on` is the plan's and humans' job.   |
