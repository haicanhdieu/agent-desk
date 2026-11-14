# 0011. Claude Code interactive in tmux with bypass permissions

- Status: Accepted
- Partly superseded by [0020](0020-agent-status-protocol.md) (hooks and run status)
- Date: 2026-11-11
- Source: Architecture (PoC) §5 (Runner image, entrypoint), §6 (approach A, Run completion and idle), §7 threat model; control plane design §8

## Context

The PoC must show the real agent session live in the browser and let a user
disconnect and reconnect without killing it. Inside the sandbox
([0010](0010-one-kubernetes-job-per-run.md)) nobody is present to answer
permission prompts, and recent CLI versions start headless runs in manual
permission mode by default. An interactive session does not exit when a turn
ends, so the run needs an explicit end. Note: the PRD scope table still says
"Claude Code CLI, headless" and milestone M1 says "headless"; the Architecture
doc refines this to an interactive session.

## Decision

- The runner entrypoint clones, checks out `CHECKOUT_REF`, and starts Claude
  Code interactively (not `-p` headless) in a detached tmux session named
  `agent`, with `--permission-mode bypassPermissions` set explicitly on the
  command line, because the container is the sandbox.
- A `Stop` hook in the image's user-level settings (not the repo) prints
  `agentdesk: turn finished`; the control plane moves the run to `idle`. A
  `UserPromptSubmit` hook prints `agentdesk: turn started`; that line, not
  terminal input, moves an idle run back to `running`.
- The run ends on Finish, after 10 min idle with no terminal attached, on cancel
  or on the hard timeout. Ending execs `tmux kill-session -t agent`; the
  entrypoint prints the final scrollback between marker lines and exits with the
  agent's status.
- Skills are discovered natively from `.claude/skills/` in the cloned repo.

## Alternatives considered

| Alternative                                             | Why rejected                                                                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structured stream via the Claude Agent SDK (approach B) | Higher build effort (Node runner, event protocol, replay, renderer) and the runner needs a path back to the control plane; planned as the MVP default view |
| Manual permission mode                                  | Not stated as a weighed option; the docs require the mode to be set explicitly because the default would block a headless container                        |

## Consequences

### Positive

- Exact CLI fidelity; tmux keeps the session across browser reconnects.
- Lowest build effort: tmux, xterm.js and an exec relay.

### Negative

- Bypass permissions plus repo-controlled `.claude/settings.json` hooks and
  `.mcp.json` servers run code in the container; acceptable only because the
  container is the sandbox with a single-repo token.
- History is final scrollback only (plain text, redacted); cancelled or timed-out
  runs may have none. No turn limit: `MAX_TURNS` is unused in the PoC.
- Open checks: interactive skill invocation, first-run dialogs, Stop hook
  reliability, TUI rendering under tmux in xterm.js.

## Links

- [Architecture (PoC)](<../Agent Desk — Architecture (PoC).md>) §5, §6, §7, §9
- [Control plane design](../superpowers/specs/2026-11-12-control-plane-design.md) §6.2, §8, §11
- [PRD (PoC)](<../Agent Desk — PRD (PoC).md>) §6, §8 milestones
- Related: [0014](0014-terminal-over-websocket-exec-relay.md)
