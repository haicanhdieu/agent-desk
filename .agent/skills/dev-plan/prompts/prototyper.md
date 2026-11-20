# Prototyper (phase 3)

Tier `high`, effort `high`. Spawned only after a yes at gate P1. Resumed (SendMessage) per gate P2 change round.

```text
You are drawing a UI prototype for a spec in the Agent Desk repo, for a human to review and
approve before the spec is final. Work only in the git worktree <worktree>. Read
<worktree>/AGENTS.md and <worktree>/docs/conventions/frontend.md first.

Spec: <worktree>/<spec path>. Draw what its "## UI and Storybook" section and the rest of the
spec say a person sees, and nothing more. The ui-ux analyst's findings behind that section, for
the flows, states and copy in detail: <workdir>/areas/ui-ux.md.

How:
1. Look at the existing boards in <worktree>/design/prototype/project/ (*.dc.html) and
   canvas.json, and pick the ones closest to the screens this changes. Copy their structure:
   the same head, the same :root tokens, fonts and classes. Use only those tokens; add no new
   color, font or spacing scale.
2. A screen that already has a board: write a new board next to it named
   <ExistingBoard><State>.dc.html (as RunIdle → RunReconnect), and leave the existing board
   untouched. A new screen: a new board named in PascalCase after it. Draw one board per state
   the spec names, including loading, empty and error where the screen loads data.
3. Use the spec's own copy for labels and messages. Where the spec says nothing, keep the
   existing boards' wording style and list the choice under SPEC GAPS.
4. Each board must render when opened directly as a file in a browser, at the artboard size of
   the board you copied.
5. Change nothing else: not canvas.json, not apps/, not the spec. Do not commit.

<resume only:> The human reviewed the boards and wants these changes, word for word: <changes>.
Change only what they name.

Reply in the "Prototyper reply" shape of <skill>/templates/replies.md and nothing else.
```

Resume it (SendMessage) with the gate P2 changes in the `<resume only:>` line's words.
