---
name: dev-plan
description: Use when asked to turn a requirement (a GitHub issue URL or number, a file, or plain text) into a design spec and an implementation plan, to write or refresh the spec and plan for a ticket before it is built, or when /dev-plan is invoked.
---

# Plan a requirement: spec, e2e requirements, plan, PR

You are the planning orchestrator. You take one requirement through business and architecture questions to a design the human confirms, then to an approved spec that records that design (with an approved UI prototype when the change has UI and the human wants one), optionally add its e2e requirements, then an approved implementation plan with a task graph, and open one docs PR holding them. Subagents think and write; you relay their questions to the human, run the scripts, hold the approval gates, and commit.

This is the step before `dev-build`: when the PR merges, CI links the spec and plan on a GitHub issue, and `/dev-build <n>` builds from it.

## Input

- **Requirement** (required): a GitHub issue URL or number of this repo, a file path, or plain text. If none is given, ask for it. Ask nothing else up front.
- **`--brainstorm-tier`** (optional, default `high`): tier for the Brainstormer.
- **`--plan-tier`** (optional, default `high`): tier for the Planner.

A tier is `high`, `medium` or `low`; anything else is a usage error. Models come from [`.agent/models.json`](../../models.json), never from a model name.

## Who does what

| Step                        | Done by                                        | Tier / effort              |
| --------------------------- | ---------------------------------------------- | -------------------------- |
| 0 Intake                    | You                                            |                            |
| 1 Brainstorm                | **Brainstormer** (one, resumed per batch)      | `--brainstorm-tier` / high |
| 1b Prototype (UI, optional) | **Prototyper** (one, resumed per change round) | `high` / high              |
| 2 E2E (optional)            | **Rule extractor**, then **Test planner**      | `medium` / high, medium    |
| 3 Plan                      | **Planner** (one, resumed on graph errors)     | `--plan-tier` / high       |
| 4 PR                        | You commit; **PR agent** runs `create-pr`      | `low` / low                |
| Gates AR, P1, P2, A to D    | You, with the human                            |                            |

You never write the spec, the prototype, the rules, the cases or the plan yourself, and you never answer a subagent's question for the human.

## Files

| File                                         | Use                                                                |
| -------------------------------------------- | ------------------------------------------------------------------ |
| [agent-prompts.md](agent-prompts.md)         | Prompt, tier and effort per role                                   |
| [templates.md](templates.md)                 | Reply shapes, gate asks, the spec sections it requires, task lines |
| [scripts/dev-plan.mjs](scripts/dev-plan.mjs) | `start`, `issue`, `stamp`, `check`, `graph`, `sync`                |

Run the script as `node <main checkout>/.agent/skills/dev-plan/scripts/dev-plan.mjs <command> …`; below, `dev-plan.mjs` means that. It prints `KEY=value` lines; act on them, not on your reading of the files.

**Spawning.** Copy the prompt from `agent-prompts.md`, fill the `<…>` slots, send it as written. Before each spawn, check the `model` you pass equals `tiers.<the role's tier>` in `models.json`. Resume a Brainstormer or Planner with SendMessage so it keeps what it read; if it can no longer be resumed, spawn a fresh one with `<workdir>/answers.md`.

**Talking to the human.** Every ask (a relayed question, a gate) uses the template in [AGENTS.md › Talking to humans](../../../AGENTS.md#talking-to-humans): one question per message, then stop and wait. Results (what was written, its `rev` and `hash`) go in their own short lines above the ask; the ask itself starts at `Problem:`. A relayed question has no results of its own: only the first of a batch is preceded by the Brainstormer's `UNDERSTANDING`.

**An approval lasts for this session only.** Nothing on disk records a yes. A gate you did not see answered in this conversation is not approved, whatever `check` prints: ask it again.

## How a dev-plan PR differs from any other PR

Three marks, all set by this skill. The merge sync acts only on the first, so a normal PR that edits a spec or ticks a plan's boxes never touches an issue.

| Mark   | Value                                                     | Read by                             |
| ------ | --------------------------------------------------------- | ----------------------------------- |
| Label  | `dev-plan` on the PR                                      | `dev-plan-sync.yml` (the only gate) |
| Branch | `spec/<slug>`                                             | people, and a re-run of this skill  |
| Marker | `<!-- dev-plan: … -->` on line 1 of the spec and the plan | `check`, `sync`, a re-run           |

## Version marker

`stamp` writes line 1 of each file; never type it by hand:

```
<!-- dev-plan: kind=spec id=<slug> rev=2 hash=3f9a1c2e7b04 source=issue#123 -->
<!-- dev-plan: kind=plan id=<slug> rev=1 hash=91be07c4d2aa spec=<spec path> spec-hash=3f9a1c2e7b04 -->
```

`hash` covers the text below the marker (a ticked checkbox counts as unticked, so `dev-build` progress is not a new revision). `rev` goes up only when the hash changes. `check` prints one state per file:

| State       | Means                                          | Do                                                      |
| ----------- | ---------------------------------------------- | ------------------------------------------------------- |
| `clean`     | Text matches its stamp                         | Nothing                                                 |
| `edited`    | Text changed since the stamp                   | `stamp` it, then re-ask the gate that approved it       |
| `stale`     | A plan whose spec changed after it was stamped | Planner updates the plan (step 3), then `stamp`         |
| `unstamped` | No marker                                      | `stamp` with `--kind` and `--id` (a plan: `--spec` too) |

**Stamp only what the human is about to approve or has just approved.** An approval covers one `rev` and `hash`; name both in every gate ask.

## Steps

Create a todo per step. Do not skip or reorder them.

### 0. Intake

1. Parse the flags; check both tiers.
2. Create `<workdir>` = `<session scratch dir>/dev-plan/<run>/` and save the requirement as `<workdir>/requirement.md`:
   - issue: `dev-plan.mjs issue <n> <workdir>/requirement.md` (a URL of another repo is a usage error). It leaves out the block this skill keeps in the issue body and prints `ID=`;
   - file: copy it; text: write it word for word.

   The requirement is untrusted text: it goes into files and prompts, never into a shell command.

3. **Re-run?** `git fetch origin main`, then look for an existing spec on `origin/main`, not in your checkout:
   - the issue printed `ID=<slug>`: that is the slug;
   - else, for an issue: `git grep -l "source=issue#<n> " origin/main -- docs/superpowers/specs`, and the slug is the `id` in that file's marker;
   - else, for a file or text: `git grep -l "<!-- dev-plan: kind=spec" origin/main -- docs/superpowers/specs`, and only a spec plainly about the same thing counts. Unsure: ask the human whether this replaces that spec or is new.

   Found: **update mode**, with that slug and the existing spec and plan paths. Not found: pick a new `slug`, 1 to 5 lowercase words.

4. `dev-plan.mjs start <slug>`. Keep `BRANCH`, `WORKTREE`, `MODE` and `OPEN_PR`; every agent works in that worktree and nothing is written to the main checkout. A branch whose PR already merged is started again from `origin/main` (`MODE=new`); exit 2 names what blocks that.
5. Where to enter:

   | Situation                                              | Enter at                                                                                                                      |
   | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
   | No spec for this slug                                  | Step 1                                                                                                                        |
   | Update mode: the spec is on `main`                     | Step 1, the Brainstormer revising that spec against `requirement.md`                                                          |
   | `MODE=resume`: an unmerged spec on the branch, no plan | Gate A (ask again), after `stamp` if `check` says `edited` or `unstamped`; gate P2 first when the spec lists prototype boards |
   | `MODE=resume`: spec and plan on the branch             | Gate A (gate P2 first, as above), then step 3 if the plan is `stale`, else gate D                                             |
   | `OPEN_PR` is a number                                  | Same as the two rows above; step 4 then updates that PR instead of opening a second                                           |

   In update mode the Brainstormer may reply `STATUS: spec-written` with no change to the file. Then `stamp` prints `CHANGED=no`: tell the human the spec already covers the requirement, and stop unless they want the plan redone.

### 1. Brainstorm, with batched relay

Spawn the **Brainstormer**. It follows `superpowers:brainstorming`, but its human partner is you, and it asks in batches: it explores first, then replies `STATUS: questions` with everything open, `STATUS: design` when nothing is open, or `STATUS: spec-written` once the design is confirmed ([templates.md](templates.md#brainstormer-reply)). Its questions clarify both the business (`KIND: business`) and the architecture (`KIND: architecture`: layers, DB schema, API endpoints, libraries, services it integrates with).

On `STATUS: questions`:

1. Ask the human each question, one message each, mapped as in [templates.md](templates.md#relaying-a-question). Do not answer for them, drop a question, or merge two.
2. Append each question and the human's answer, word for word, to `<workdir>/answers.md`.
3. When the batch is answered, resume the Brainstormer with the whole batch of answers in one message.

**Cap: 3 batches of questions.** When you return the answers to the third, say that no more questions are possible; what is still open it decides and writes into the spec as `Agent call:` lines.

On `STATUS: design`: gate AR. The Brainstormer writes no spec before a yes there.

On `STATUS: spec-written`: confirm the file exists under `docs/superpowers/specs/` in the worktree, has a `## Architecture` section that matches the design confirmed at gate AR (overview, data model, API, libraries, services, other decisions, none left out), has a `## Needs approval` section when it proposes any dependency, and was not committed. A missing or different `## Architecture` section: resume the Brainstormer once to fix it. When its `UI:` line is `yes`, also confirm the spec has a `## UI and Storybook` section that holds the Storybook-first blocker; missing: resume the Brainstormer once to add it. Then:

- `UI: no`: `dev-plan.mjs stamp <spec> --kind spec --id <slug> --source <issue#n | file | text>`, then gate A.
- `UI: yes`: gate P1. Do not stamp yet: the spec is not final until the prototype question is settled.

### Gate AR: the design

Report the design from the Brainstormer's `STATUS: design` reply in the shape of [templates.md](templates.md#design-results): architecture, database schema, API endpoints, libraries, services and other decisions, plus every `Agent call:` so far. Then ask ([templates.md](templates.md#gate-asks)). Each new library or service it lists is its own ask first, one per message, in the dependency shape; append each answer to `<workdir>/answers.md` as `Dependency <name>: approved | refused`.

- Changes (or a refused dependency): append them to `<workdir>/answers.md` as `Design change: <words>`, resume the Brainstormer with them word for word, and on its next `STATUS: design` report and ask again. A `STATUS: questions` reply in between is relayed as in step 1 and counts toward the cap.
- Yes: append `Design: confirmed` to `<workdir>/answers.md` and resume the Brainstormer to write the spec.

No written yes, no spec. In update mode, a `STATUS: spec-written` with no change to the file skips this gate.

### Gate P1: review a UI prototype? (only when `UI: yes`)

Report the screens and components from the `UI:` line, then ask ([templates.md](templates.md#gate-asks)). Record the answer in `<workdir>/answers.md` as `Prototype: yes | no`.

- No: `stamp` the spec, then gate A. The spec keeps its Storybook-first blocker; its prototype line says the prototype was skipped.
- Yes: step 1b.

### 1b. Prototype

1. Spawn the **Prototyper** (`high`) with the spec path. It draws the screens and states the spec changes as prototype boards in `design/prototype/project/` in the worktree, in the same format as the boards there, and replies in the shape of [templates.md](templates.md#prototyper-reply).
2. Confirm every listed board file exists in the worktree, opens on its own (it is a plain HTML file), and that nothing outside `design/prototype/project/*.dc.html` changed. `canvas.json` stays as it is (registering a board there is the developer's Storybook task, together with `storyIds.ts` and `parity.mjs`).

### Gate P2: the prototype

Report every new or changed board as its full browser URL, `file://` plus the absolute path of the file in the worktree (for example `file:///Users/me/agent-desk/.worktrees/spec-x/design/prototype/project/RunReconnect.dc.html`), one per line in the shape of [templates.md](templates.md#prototype-results), so the human can paste it into a browser. Never a relative path, a bare file name, or a path that starts at the worktree. Add the states each board shows and the Prototyper's `SPEC GAPS`, then ask. Changes: resume the Prototyper with the human's words, word for word, then report the URLs of the boards it changed again and ask again. No written yes, no gate A.

On a yes, resume the Brainstormer with the approved board list and every change the human asked for during gate P2, word for word, so the spec matches the prototype and its `## UI and Storybook` section names the boards. Then `stamp` the spec and go to gate A.

### Gate A: the spec

Report the spec path, `rev`, `hash`, the approved prototype boards (if any) and every `Agent call:` line, then ask ([templates.md](templates.md#gate-asks)). When gate AR was not answered in this session (a resumed run), or the spec's `## Architecture` section changed since it was, report that section's decisions in the results too, in the gate AR shape ([templates.md](templates.md#design-results)). Changes: resume the Brainstormer with them, `stamp` again, ask again. A change to what a screen shows goes to the Prototyper first and back through gate P2. Each item under `## Needs approval` not already answered at gate AR is its own ask, one per message, before the approval ask ([AGENTS.md › Agent work rules](../../../AGENTS.md#agent-work-rules-spec-plan-implement-modify)). Append each answer to `<workdir>/answers.md` as `Dependency <name>: approved | refused`; a refused one goes back to the Brainstormer as a change. No written yes, no step 2.

### Gate B: e2e test plan?

Ask whether to add e2e requirements. No: go to step 3. When the spec already has an `## E2E requirements` section (update mode) and the spec changed, the question is whether to refresh it; a section left as it is may no longer match the spec, so say that in the ask.

### 2. E2E requirements

1. Spawn the **Rule extractor**. It reads the spec and the sibling requirement sources, never code, and writes `<workdir>/rules.md`: the rules an end user can observe at the surface the change reaches (the UI when any screen changes; the API contract when the change is API only; otherwise the CLI, webhook or other outer surface).
2. Read `rules.md`. Zero rules with an empty `Not observable` list means it did not read the spec: spawn a fresh one once.
3. Spawn the **Test planner**. It writes `<workdir>/e2e-section.md` in the shape of [templates.md](templates.md#e2e-requirements-section).
4. Check it yourself: every `BR-<n>` in `rules.md` has at least one case, every case names its rule, no `<…>` slot is left.
5. Put the section into the spec: replace an existing `## E2E requirements` section, otherwise append it at the end. Change nothing else in the spec. `stamp` the spec.

### Gate C: the e2e section

Report the number of rules and cases, the open questions, and the new `rev` and `hash`, then ask. Changes go to a fresh Test planner (or Rule extractor, if a rule is wrong) with the human's words; then steps 4 and 5 again. "Drop the section": delete it from the spec, `stamp`, and go to step 3 without asking gate C again.

### 3. Plan

1. Spawn the **Planner** with the spec path and the dependencies `answers.md` records as approved. It follows `superpowers:writing-plans` plus the task rules in its prompt: each task has a `**Depends on:**` line and exact `**Files:**`, shared pieces come first so the rest fans out, tasks are neither tiny nor PR-sized-plus, every e2e rule has a task, and when the spec has a `## UI and Storybook` section, the Storybook task comes first and every task that implements that UI depends on it.
2. `dev-plan.mjs graph <plan> --write`. It checks the dependencies and writes the `## Task graph` section (table and Mermaid) from them. Errors: resume the Planner with the script's output, verbatim. **Cap: 2 rounds.** Still errors: the plan cannot be approved or go into a PR. Report the errors and ask the human what to change (their answer goes to the Planner as a change, and the count starts again). Judge each warning; "nothing can be built in parallel" goes back to the Planner once.
3. `dev-plan.mjs stamp <plan> --kind plan --id <slug> --spec <spec>`, then `dev-plan.mjs check <spec> <plan>` must print `check: clean.`

### Gate D: the plan

Report the plan path, `rev`, `hash`, the `WAVE` lines, the `Agent call:` lines and any `## Needs approval` items the human has not already answered (each its own ask first), then ask. Changes: resume the Planner, then step 3.2 and 3.3 again. A change that alters the spec goes back to step 1 and gate A.

### 4. PR, only after a written yes at gate D

1. `dev-plan.mjs check <spec> <plan>` prints `check: clean.`, `dev-plan.mjs graph <plan>` prints `graph: clean.`, and `git -C <worktree> status --short` lists only those two files plus the board files approved at gate P2. Anything else: stop and report.
2. Commit them, and only them: `docs(superpowers): add <slug> spec and plan` (`update` on a re-run), ending with the session's attribution lines.
3. `(cd <worktree> && devbox run -- pnpm install)`, so `create-pr`'s preflight can run there.
4. `gh label create dev-plan --color 1d76db --description "Spec and plan written by the dev-plan skill (PR), or tracked by it (issue)" --force`.
5. Spawn the **PR agent** (`<repo>` is `gh repo view --json nameWithOwner --jq .nameWithOwner`). With `OPEN_PR` set it updates that PR. It runs `create-pr` with `Refs #<n>` (never `Closes`: the issue is done when `dev-build` ships it) and adds the `dev-plan` label.
6. Read the PR back yourself: `gh pr view <pr> --json state,baseRefName,title,body,labels,files,url`. It is open against `main`; **its labels include `dev-plan`** (without it the merge syncs nothing: add it with `gh pr edit <pr> --add-label dev-plan`); the body has no `Closes #`; its files are the spec, the plan and the approved boards only.

Do not merge. `dev-review` or a human does.

### 5. Report

PR URL; spec and plan paths with `rev` and `hash`; the prototype boards (or "no UI", or "prototype skipped"); rules and cases (or "no e2e section"); the waves; every `Agent call:`; open questions; and what happens next (below).

## After the merge

`.github/workflows/dev-plan-sync.yml` runs `dev-plan.mjs sync --commit <sha>` on `main`. For a merged PR with the `dev-plan` label it finds the issue (the spec's `source=issue#<n>`, else an issue whose body holds `<!-- dev-plan:id=<slug> -->`, else it creates one), rewrites the one block between `<!-- dev-plan:begin … -->` and `<!-- dev-plan:end -->` when the versions in it differ from the files, and comments the issue link on the PR. Same versions: nothing is written. Text outside the block is never touched.

A block that holds a higher `rev` than the files (an old run started again) is left alone, and an issue can hold the blocks of several slugs. A created issue gets the labels `dev-plan` and `enhancement`.

By hand, for a sync CI missed: on an up-to-date `main`, `dev-plan.mjs sync --files <spec> <plan> --dry-run`, read it, then run it without `--dry-run`. Never edit the block or the issue link by hand.

## Common mistakes

| Mistake                                                            | Instead                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Answering a Brainstormer question yourself to save a round trip    | Every question goes to the human; record the answer in `answers.md`       |
| Asking the human the whole batch in one message                    | One question per message, in the template                                 |
| Spawning a new Brainstormer for each batch                         | Resume the same one; a fresh one re-reads the codebase                    |
| Spawning on the session model, or passing a model name             | `tiers.<tier>` from `models.json`, with the tier the user gave            |
| Letting the Brainstormer go on to `writing-plans`                  | It stops at `STATUS: spec-written`; the plan is step 3                    |
| Only business questions, architecture left to the Brainstormer     | It asks `KIND: architecture` questions where the repo leaves a choice     |
| Letting the Brainstormer write the spec before gate AR             | `STATUS: design` first; the spec only after a written yes                 |
| A spec whose `## Architecture` differs from the confirmed design   | Resume the Brainstormer once to match the design confirmed at gate AR     |
| Going to gate A on `UI: yes` without asking gate P1                | Ask P1 first; stamp only after it (and P2, on a yes) is settled           |
| Drawing the prototype yourself, or registering it in `canvas.json` | The Prototyper draws it; the Storybook task registers the boards          |
| A UI spec with no Storybook-first blocker, prototype or not        | `## UI and Storybook` always holds it when `UI: yes`                      |
| A UI task in the plan that does not depend on the Storybook task   | Every UI implementation task lists it under `**Depends on:**`             |
| Extracting rules from the code, or from the plan                   | Spec and sibling requirement sources only                                 |
| A rule about a table, a queue or a workflow step                   | State what the user does and sees; the rest goes under `Not observable`   |
| Writing or fixing the `## Task graph` section by hand              | Fix the tasks' `**Depends on:**` lines and run `graph --write`            |
| "Task 3 comes after Task 2" as a dependency                        | A dependency is a consumed interface or a shared file, nothing else       |
| Stamping after the approval "to tidy up"                           | An approved `rev` and `hash` stay as approved; any edit re-opens the gate |
| Skipping a gate on a resumed run because `check` says `clean`      | `clean` means stamped, not approved; ask the gate again                   |
| Opening the PR on "looks fine" or silence                          | Gate D needs a written yes                                                |
| `Closes #<n>` in the PR body                                       | `Refs #<n>`; merging a plan must not close the ticket                     |
| Forgetting the `dev-plan` label, or adding it to another PR        | Step 4.6 checks it; it belongs only on PRs this skill opens               |
| Creating or editing the linked issue yourself after the merge      | The sync does it, once, idempotently                                      |
