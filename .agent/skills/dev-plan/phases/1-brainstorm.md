# Phase 1: Brainstorm with parallel area analysts

Four **Analysts** explore the requirement at once, one per area: `business`, `architecture`, `ui-ux`, `testing` (deep-dive lists in [prompts/areas/](../prompts/areas/); each owns one spec section). You triage what they ask and relay it to the human. Ends when every active analyst has replied `STATUS: design`.

Each analyst decides what the project's constraints settle (`Follows:`), decides what it is confident about (`Agent call:`), and asks the human, through you, only what it is not confident about or where options are about equally good. It keeps its findings in `<workdir>/areas/<area>.md`.

## 1. Spawn

Create `<workdir>/areas/`. Spawn the four analysts **in one message**, each with its `AREA`.

## 2. A round

A round ends when every analyst you spawned or resumed for it has replied. An analyst that replies `STATUS: not-applicable` is inactive from then on and is never resumed. An analyst that replied `STATUS: design` stays active: a later answer may change its design.

When every active analyst's last reply is `STATUS: design` and no reply has a `CONFLICTS:` line other than `none`, go to [Ready](#4-ready). Otherwise triage.

## 3. Triage and relay

1. Read every `STATUS: questions` reply of the round. For each question, set one disposition in `<workdir>/triage.md` in the shape of [templates/asks.md › Triage file](../templates/asks.md#triage-file): `ask`, `merged into T<n>`, `hand-off` or `ask (conflict)`. Also turn every `CONFLICTS:` line (in any reply) into an `ask (conflict)` row, unless the two areas already agree in their findings files; one row per disagreement, even when both areas report it.
2. Order the `ask` rows: a question others `DEPENDS ON` first, business before the areas that depend on it, then by how much the answer changes what gets built.
3. Ask the human each `ask` row, one message each, in the shape of [templates/asks.md › Relaying a question](../templates/asks.md#relaying-a-question). Do not answer for them, drop a question, or merge two that are not the same decision.
4. Append each question and the human's answer, word for word, to `<workdir>/answers.md`.
5. When the round is answered, resume the analysts, all in one turn, with the whole round's answers, the hand-offs that concern each, and the other areas' findings files ([prompts/resumes.md › Analyst, each round](../prompts/resumes.md#analyst-each-round)). That starts the next round. Whom to resume:
   - every analyst that replied `STATUS: questions`;
   - an analyst already at `STATUS: design` only when an answer, a hand-off or a conflict of this round touches its area; `testing` whenever a business answer changed or added a rule; **all of them when unsure**.

   An analyst left out keeps its design; the Spec writer's `OPEN` lines catch a gap between areas.

**Cap: 3 rounds of questions.** When you send the answers to the third, say that no more questions are possible; whatever is still open, each analyst decides and marks `Agent call:`. A conflict still open after the cap is listed under `Unresolved conflicts` at gate AR for the human to settle there.

## 4. Ready

Every active analyst's last reply is `STATUS: design`. Check:

- each reply has every design field of its area file, and `<workdir>/areas/<area>.md` exists for each;
- no `CONFLICTS:` line is left, except one still open after the cap, which you list for gate AR.

Missing: resume that analyst once to fix it. Then go to [phase 2](2-design-and-spec.md).

**Update mode:** when every active analyst replied `CHANGES: none`, tell the human the spec already covers the requirement, and stop unless they want the plan redone (then [phase 4](4-spec-approval.md)).
