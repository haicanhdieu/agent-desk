# Phase 3: UI prototype (only when the spec's `UI:` is `yes`)

Gate P1 asks whether to draw a prototype; on a yes the **Prototyper** (prompt: [prompts/prototyper.md](../prompts/prototyper.md)) draws it and gate P2 approves it.

## Gate P1: review a UI prototype?

Report the screens and components from the `UI:` line, then ask ([templates/asks.md › Gate asks](../templates/asks.md#gate-asks)). Record the answer in `<workdir>/answers.md` as `Prototype: yes | no`.

- **No:** `stamp` the spec, then [phase 4](4-spec-approval.md). The spec keeps its Storybook-first blocker; its prototype line says the prototype was skipped.
- **Yes:** draw it, below.

## Draw

1. Spawn the **Prototyper** (`high`, effort `high`) with the spec path. It draws the screens and states the spec changes as prototype boards in `design/prototype/project/` in the worktree, in the same format as the boards there, and replies in the shape of [templates/replies.md › Prototyper reply](../templates/replies.md#prototyper-reply).
2. Confirm every listed board file exists in the worktree, opens on its own (it is a plain HTML file), and that nothing outside `design/prototype/project/*.dc.html` changed. `canvas.json` stays as it is (registering a board there is the developer's Storybook task, together with `storyIds.ts` and `parity.mjs`).

## Gate P2: the prototype

Report every new or changed board as its full browser URL, `file://` plus the absolute path of the file in the worktree (for example `file:///Users/me/agent-desk/.worktrees/spec-x/design/prototype/project/RunReconnect.dc.html`), one per line in the shape of [templates/asks.md › prototype results](../templates/asks.md#prototype-results), so the human can paste it into a browser. Never a relative path, a bare file name, or a path that starts at the worktree. Add the states each board shows and the Prototyper's `SPEC GAPS`, then ask.

- **Changes:** resume the Prototyper with the human's words, word for word, then report the URLs of the boards it changed again and ask again.
- **Drop the prototype:** delete the boards from the worktree, record `Prototype: no` in `answers.md`, and continue as for a no at P1.
- **Yes:** resume the Spec writer with the approved board list and every change the human asked for during gate P2, word for word ([prompts/spec-writer.md › Resume, gate P2 yes](../prompts/spec-writer.md#resume-gate-p2-yes)), so the spec matches the prototype and its `## UI and Storybook` section names the boards. Then `stamp` the spec and go to [phase 4](4-spec-approval.md).

No written yes, no gate A.
