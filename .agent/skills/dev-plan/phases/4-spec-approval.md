# Phase 4: Gate A, the spec

1. Report the spec as a full link, its `rev`, `hash`, the approved prototype boards (if any) and every `Agent call:` line.
2. When gate AR was not answered in this session (a resumed run), or the spec's `## Business rules`, `## Architecture`, `## UI and Storybook` or `## Testing` section changed since it was, report those sections' decisions in the results too, in the gate AR shape ([templates/asks.md › design results](../templates/asks.md#design-results)).
3. Each item under `## Needs approval` not already answered at gate AR is its own ask, one per message, before the approval ask ([AGENTS.md › Agent work rules](../../../../AGENTS.md#agent-work-rules-spec-plan-implement-modify)). Append each answer to `<workdir>/answers.md` as `Dependency <name>: approved | refused`; a refused one goes to the Spec writer as a change.
4. Ask gate A ([templates/asks.md › Gate asks](../templates/asks.md#gate-asks)).

- **Changes:** resume the Spec writer with them ([prompts/resumes.md › Spec writer, gate A changes](../prompts/resumes.md#spec-writer)), `stamp` again, ask again. A change to what a screen shows goes to the Prototyper first and back through gate P2 ([phase 3](3-prototype.md#gate-p2-the-prototype)). A change that reverses a design decision confirmed at gate AR goes back to that area's analyst and gate AR ([phase 2](2-design-and-spec.md)); a fresh analyst gets `FRESH: lost`, or, when its area file and `answers.md` do not exist (a resumed run), `FRESH: resumed-run`.
- **Yes:** [phase 5](5-e2e.md).
