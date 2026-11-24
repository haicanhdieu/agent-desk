# Phase 3: UI prototype (only when the spec's `UI:` is `yes`)

## Gate P1: review a UI prototype?

Report the screens and components from the `UI:` line, then ask ([templates/asks.md › Gate asks](../templates/asks.md#gate-asks)). Record the answer in `<workdir>/answers.md` as `Prototype: yes | no`.

- **No:** `stamp` the spec, then [phase 4](4-spec-approval.md). The spec keeps its Storybook-first blocker; its prototype line says the prototype was skipped.
- **Yes:** draw it, below.

## Draw

1. Spawn the **Prototyper** with the spec path. It draws the screens and states the spec changes as boards in `design/prototype/project/` in the worktree and wires them into the interactive prototype.
2. Confirm every listed board file exists in the worktree, and that nothing changed outside `design/prototype/project/*.dc.html` and `design/prototype/interactive/`. Every new or changed board must be reachable in the interactive prototype: if its `INTERACTIVE` lines are missing or `nav-check` failed, resume the Prototyper before the gate. `canvas.json` stays as it is (registering a board there is the developer's Storybook task).

## Gate P2: the prototype

Report every new or changed board as a full `file://` URL, the interactive prototype entry URL and the Prototyper's `INTERACTIVE` lines, the states each board shows and its `SPEC GAPS`, in the shape of [templates/asks.md › prototype results](../templates/asks.md#prototype-results), so the human can try the flow, not just look at the boards. Then ask.

- **Changes:** resume the Prototyper with the human's words, word for word, then check again that the interactive prototype was rebuilt for the change, report the changed boards' URLs and the `INTERACTIVE` lines again, and ask again.
- **Drop the prototype:** delete the boards from the worktree and revert what the Prototyper changed under `design/prototype/interactive/` (`git checkout -- design/prototype/interactive` plus removing its new files), record `Prototype: no` in `answers.md`, and continue as for a no at P1.
- **Yes:** resume the Spec writer with the approved board list and every change the human asked for during gate P2, word for word ([prompts/resumes.md › Spec writer, gate P2 yes](../prompts/resumes.md#spec-writer)), so the spec matches the prototype and its `## UI and Storybook` section names the boards. Then `stamp` the spec and go to [phase 4](4-spec-approval.md).
