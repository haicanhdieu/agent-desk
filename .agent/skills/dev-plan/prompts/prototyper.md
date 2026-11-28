# Prototyper (dev-plan phase 3)

You are drawing a UI prototype for a spec in the Agent Desk repo, for a human to review and approve before the spec is final. Work only in the git worktree {WORKTREE}. Read {WORKTREE}/AGENTS.md and {WORKTREE}/docs/conventions/frontend.md first.

Code tools: Check for `mcp__serena__*`; if present, you MUST use it for TypeScript code. Before any code work, read {MAIN}/.agent/code-tools.md and follow it: its check is mandatory and says when Serena is usable. You edit no TypeScript code: Serena's reading tools only. The files you may change stay as listed below.

Spec: {WORKTREE}/{SPEC}. Draw what its "## UI and Storybook" section and the rest of the spec say a person sees, and nothing more. The ui-ux analyst's findings behind that section, for the flows, states and copy in detail: {WORKDIR}/areas/ui-ux.md.

How:

1. Look at the existing boards in {WORKTREE}/design/prototype/project/ (`*.dc.html`) and canvas.json, and pick the ones closest to the screens this changes. Copy their structure: the same head, the same :root tokens, fonts and classes. Use only those tokens; add no new color, font or spacing scale.
2. A screen that already has a board: write a new board next to it named <ExistingBoard><State>.dc.html (as RunIdle → RunReconnect), and leave the existing board untouched. A new screen: a new board named in PascalCase after it. Draw one board per state the spec names, including loading, empty and error where the screen loads data.
3. Use the spec's own copy for labels and messages. Where the spec says nothing, keep the existing boards' wording style and list the choice under SPEC GAPS.
4. Each board must render when opened directly as a file in a browser, at the artboard size of the board you copied.
5. Change nothing else: not canvas.json, not apps/, not the spec. The only files you may change are the boards and the files step 6 names under design/prototype/interactive/. Do not commit.
6. The clickable prototype in design/prototype/interactive/ is how the human sees how the new screens work, so every new or changed board must show up there; a board file alone is not done. Read that folder's README first ("Keep the boards and this prototype in sync", the screen map, the coverage table). Then:
   a. Run `node design/prototype/interactive/_tools/build-boards.mjs` and `node design/prototype/interactive/_checks/nav-check.mjs`; leave the regenerated `data/boards.js` and `board-styles.css` in the worktree. Fix a failing check or report it; do not skip it.
   b. For each new or changed screen, add or update its live screen under `screens/` so it can be clicked through (the flow, and each state the spec names), add a row to the screen map and the README coverage table, and make the Scenario / state control list the new boards. Use only the prototype's own tokens and helpers; no new dependency.
   c. Open `index.html` in a headless browser if one is available and walk the new flow once. If you cannot, say so under SPEC GAPS.
   d. If design/prototype/interactive/ does not exist, say so under INTERACTIVE and skip a to c.

Reply in the "Prototyper reply" shape of {MAIN}/.agent/skills/dev-plan/templates/replies.md and nothing else.
