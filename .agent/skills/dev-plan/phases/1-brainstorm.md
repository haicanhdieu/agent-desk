# Phase 1: Brainstorm with parallel area analysts

Four **Analysts** (prompt: [prompts/analyst.md](../prompts/analyst.md)) explore the requirement at once, one per area. You triage what they ask and relay it to the human. Ends when every active analyst has replied `STATUS: design`.

| Area           | Deep-dive list                                                    | Owns the spec section |
| -------------- | ----------------------------------------------------------------- | --------------------- |
| `business`     | [prompts/areas/business.md](../prompts/areas/business.md)         | `## Business rules`   |
| `architecture` | [prompts/areas/architecture.md](../prompts/areas/architecture.md) | `## Architecture`     |
| `ui-ux`        | [prompts/areas/ui-ux.md](../prompts/areas/ui-ux.md)               | `## UI and Storybook` |
| `testing`      | [prompts/areas/testing.md](../prompts/areas/testing.md)           | `## Testing`          |

Each analyst applies `superpowers:brainstorming` to its own area, with its questions routed through you instead of to the human. It decides what the project's constraints settle (`Follows:`), decides what it is confident about (`Agent call:`), and asks the human only what it is not confident about or where options are about equally good. It keeps its findings in `<workdir>/areas/<area>.md`.

## 1. Spawn

Create `<workdir>/areas/`. Spawn the four analysts **in one message**, each with tier `--brainstorm-tier` and effort `high`, the prompt filled with its `<area>`.

## 2. A round

A round ends when every active analyst has replied. An analyst that replies `STATUS: not-applicable` is inactive from then on and is never resumed. An analyst that replied `STATUS: design` stays active: the next round's answers may change its design.

When every active analyst replied `STATUS: design` and no reply has a `CONFLICTS:` line other than `none`, go to [Ready](#4-ready). Otherwise triage.

## 3. Triage and relay

1. Read every `STATUS: questions` reply of the round. For each question, set one disposition in `<workdir>/triage.md` in the shape of [templates/asks.md › Triage file](../templates/asks.md#triage-file): `ask`, `merged into T<n>`, `hand-off` or `ask (conflict)`. Also turn every `CONFLICTS:` line (in any reply) into an `ask (conflict)` row, unless the two areas already agree in their findings files; one row per disagreement, even when both areas report it.
2. Order the `ask` rows: a question others `DEPENDS ON` first, business before the areas that depend on it, then by how much the answer changes what gets built.
3. Ask the human each `ask` row, one message each, in the shape of [templates/asks.md › Relaying a question](../templates/asks.md#relaying-a-question). Do not answer for them, drop a question, or merge two that are not the same decision.
4. Append each question and the human's answer, word for word, to `<workdir>/answers.md`.
5. When the round is answered, resume **every active analyst** in one message per analyst, sent together, with the whole round's answers, the hand-offs that concern it, and the other areas' findings files ([prompts/analyst.md › Resume, each round](../prompts/analyst.md#resume-each-round)). That starts the next round.

**Cap: 3 rounds of questions.** When you send the answers to the third, say that no more questions are possible; whatever is still open, each analyst decides and marks `Agent call:`. A conflict still open after the cap is listed under `Unresolved conflicts` at gate AR for the human to settle there.

## 4. Ready

Every active analyst has replied `STATUS: design`. Check:

- each reply has every design field of its area file, and `<workdir>/areas/<area>.md` exists for each;
- no `CONFLICTS:` line is left, except one still open after the cap, which you list for gate AR.

Missing: resume that analyst once to fix it. Then go to [phase 2](2-design-and-spec.md).

**Update mode:** when every active analyst replied `CHANGES: none`, tell the human the spec already covers the requirement, and stop unless they want the plan redone (then [phase 4](4-spec-approval.md)).
