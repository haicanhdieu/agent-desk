# 0020. Agent-neutral status protocol with per-agent adapters and declared outcomes

- Status: Proposed
- Date: 2026-11-14
- Source: [Agent run status design](../superpowers/specs/2026-11-14-agent-run-status-design.md) §4, §5, §6

## Context

[0011](0011-interactive-claude-code-in-tmux.md) maps one `Stop` hook line to `idle` ("Needs you") and one
`UserPromptSubmit` line to `running`. A spike on Claude Code 2.1.323 showed `Stop` fires when the agent waits on its
own background work, when it is done, and when it asked a question in plain text, and does not fire while the
`AskUserQuestion` menu waits for an answer. Runs waiting on background work were shown as Needs you and could be
ended by the 10-minute idle timer as `succeeded`. No agent CLI researched (Claude Code, Codex, Gemini, Cursor) can tell
"done" from "asked a question" by itself; all four can block a turn end and run a command we provide. Agent Desk must
stay provider-agnostic ([0005](0005-provider-agnostic-naming-adapter-seams.md)).

## Decision

Split the channel into two layers.

- **Protocol (Agent Desk, agent-neutral):** the runner prints `agentdesk: state working | waiting background |
needs_input <source> <note-b64> | done <source> <note-b64>` on the pod's stdout. The log parser matches whole lines
  with anchored patterns and validates the note with a contracts schema. Run status: `working`/`waiting` →
  `running`; `needs_input` → `idle` (Needs you); `done` → new active status `done`.
- **Adapter (runner image, one per agent CLI):** turns the CLI's own signals into protocol lines. The agent declares
  its outcome with `agentdesk-status done|needs_input "<summary>"`, and a declaration wins over running background
  work. With no declaration, running background work means `waiting background`; otherwise the adapter blocks the
  turn end once, then falls back to `needs_input undeclared`. Claude Code's adapter reads `background_tasks` /
  `session_crons` from `Stop`, `AskUserQuestion` from `PreToolUse`/`PostToolUse`, and permission/elicitation
  notifications. Its hooks are installed as managed settings, so a repo's `.claude/settings.json` cannot disable them.
- `done` and `idle` both end as `succeeded` after 10 minutes unattended; Finish is allowed in both and becomes a
  workflow update so the API returns the workflow's real answer.

This replaces the hook and status bullets of 0011; the rest of 0011 stands.

## Alternatives considered

| Alternative                                           | Why rejected                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Declaration as an MCP tool served in the pod          | One more process to ship and secure; no gain over a strictly parsed command              |
| Structured SDK stream (0011 approach B)               | Large rebuild and loses the live TUI for now; the protocol carries over if we move later |
| Screen scraping the terminal                          | Fragile across TUI versions and cannot tell done from asked                              |
| Infer done vs asked from the last message (heuristic) | Guesswork on untrusted text; kept only as the note in the undeclared fallback            |

## Consequences

### Positive

- Needs you means a person is needed; background work no longer gets killed by the idle timer.
- Adding Codex, Gemini or Cursor is one runner adapter; contracts, db, worker and UI do not change.
- Finish no longer silently drops when the database status and workflow phase disagree.

### Negative

- Depends on each CLI's hooks; Cursor's CLI hooks are reported to fail silently on Linux.
- An extra model round trip when the agent forgets to declare.
- The agent runs with bypass permissions and could print a fake status line for its own run; accepted for the PoC
  (impact limited to that run's status).

## Links

- [Agent run status design](../superpowers/specs/2026-11-14-agent-run-status-design.md)
- Related ADRs: [0005](0005-provider-agnostic-naming-adapter-seams.md), [0009](0009-temporal-for-durable-work.md),
  [0011](0011-interactive-claude-code-in-tmux.md)
