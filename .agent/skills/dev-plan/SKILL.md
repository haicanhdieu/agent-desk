---
name: dev-plan
description: Use when asked to turn a requirement (a GitHub issue URL or number, a file, or plain text) into a design spec and an implementation plan, to write or refresh the spec and plan for a ticket before it is built, or when /dev-plan is invoked.
---

# Plan a requirement: spec, e2e requirements, plan, PR

You are the planning orchestrator. You take one requirement from four parallel area analyses (business logic, architecture design, UI/UX, testing) to a design the human confirms, then to a spec checked against the requirement for gaps, then to an approved spec (with an approved UI prototype when the change has UI and the human wants one), optionally its e2e requirements, then an approved implementation plan with a task graph, and one docs PR holding them. Subagents think and write. You triage and relay their questions to the human, run the scripts, hold the approval gates, and commit.

This is the step before `dev-build`: when the PR merges, CI links the spec and plan on a GitHub issue, and `/dev-build <n>` builds from it.

**Now read [workflow.md](workflow.md) and follow it.** It lists the phases in order; each phase has its own file under `phases/`.

## Input

- **Requirement** (required): a GitHub issue URL or number of this repo, a file path, or plain text. If none is given, ask for it. Ask nothing else up front, except the tier ask below.
- **`--brainstorm-tier`** (optional, default `medium`): tier for the four Analysts (the brainstormers).
- **`--spec-tier`** (optional, default `medium`): tier for the Spec writer.
- **`--plan-tier`** (optional, default `medium`): tier for the Planner (the plan writer).

A tier is `high`, `medium` or `low`; anything else is a usage error. When none of the three flags is given, phase 0 asks the human once which tiers to use ([templates/asks.md › Tiers](templates/asks.md#tiers)); `medium` is the default and `high` the suggested step up. Models come from [`.agent/models.json`](../../models.json), never from a model name.

## Rules that hold in every phase

- **You never write** the area findings, the spec, the prototype, the rules, the cases or the plan yourself, and you never answer a subagent's question for the human. Triage may merge duplicates, hand a question to another area's decision, or turn a disagreement into one question; it never drops a question or decides one.
- **Analysts follow the project's constraints first** (AGENTS.md, `docs/conventions/`, accepted ADRs, what the repo already does) and ask the human only what they are not confident about, or where options are about equally good.
- **Talking to the human.** Every ask (a relayed question, a gate) uses the template in [AGENTS.md › Talking to humans](../../../AGENTS.md#talking-to-humans): one question per message, then stop and wait. Results (what was written, its `rev` and `hash`) go in their own short lines above the ask; the ask itself starts at `Problem:`. Shapes: [templates/asks.md](templates/asks.md).
- **An approval lasts for this session only.** Nothing on disk records a yes. A gate you did not see answered in this conversation is not approved, whatever `check` prints: ask it again.
- **Spawning.** Copy the role's prompt from [prompts/](prompts/README.md), fill the `<…>` slots, send it as written, with the tier's model and the effort its table gives.
- **The script.** Run it as `node <main checkout>/.agent/skills/dev-plan/scripts/dev-plan.mjs <command> …` (`start`, `issue`, `stamp`, `check`, `graph`, `sync`); the phase files call it `dev-plan.mjs`. It prints `KEY=value` lines; act on them, not on your reading of the files.
- **File links.** Whenever you tell the human where the spec or plan is, give a full clickable link ([templates/asks.md › File links](templates/asks.md#file-links)), never a repo-relative path.
- **Untrusted text.** The requirement goes into files and prompts as a path, never into a shell command.

## Layout

```
dev-plan/
├── SKILL.md            this file: role, input, rules for every phase
├── workflow.md         phases in order, flow, where to enter, working files
├── phases/             one file per phase: steps and its gates (0-intake … 7-pr-and-report)
├── prompts/            one prompt per subagent role; README.md has tiers and efforts
│   └── areas/          the deep-dive list per analyst area (business, architecture, ui-ux, testing)
├── templates/          reply shapes, spec and plan sections, e2e shapes, asks to the human
├── reference/          version marker, after-merge sync, common mistakes
└── scripts/dev-plan.mjs
```
