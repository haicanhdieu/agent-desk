# 0014. Terminal: xterm.js over a WebSocket relayed to `pods/exec`

- Status: Accepted
- Amended by [0023](0023-runner-entrypoint-owns-the-end-of-a-run-pod.md) (the entrypoint owns the end of the pod)
- Amended by [0031](0031-scoped-rbac-roles-assignments.md) (terminal authorization: `terminal:attach` on the run's project, with ownership for members)
- Amended by [0035](0035-per-request-org-check-and-auth-allow-list.md) (close 4412 on an org mismatch; reauth pinned to the connect org)
- Date: 2026-11-11
- Source: Architecture (PoC) §6 (approach A, Transport, comparison table), §7 threat model, §9 (Streaming); control plane design §7.5; frontend design §2 (Terminal), §5.3; infra design §6.4, §9.3

## Context

The PoC shows the real Claude Code session, running in tmux inside the run pod
([0011](0011-interactive-claude-code-in-tmux.md)), in the browser. The browser
must never hold Kubernetes credentials, terminal access is shell-equivalent, and
the runner should need no network path back to the control plane. QA traffic
crosses Cloudflare, whose idle timeout is about 100 s.

## Decision

- Browser: `@xterm/xterm` with `@xterm/addon-fit` and `@xterm/addon-webgl` (it draws the block and box
  glyphs Claude Code prints; the DOM renderer stays as the fallback), lazy-loaded on run detail,
  opening `WebSocket /api/runs/{id}/terminal` on the same origin.
- Control plane: `@kubernetes/client-node` `Exec` of `tmux attach -t agent`
  with `tty` and `stdin` (subprotocol `v5.channel.k8s.io`), relaying bytes
  both ways; resize is written to channel 4.
- Frames: binary both ways for terminal bytes; resize is the text frame
  `{"type":"resize","cols","rows"}`. Close codes 4401 (not signed in), 4403 (not
  allowed), 4409 (run not `running`/`idle`). Control actions (finish, cancel) are
  REST, never on the socket.
- Authorization: session, then `terminal:attach` on the run's project (members only on their own runs); a missing permission or an out-of-scope project closes 4403 (amended by [0031](0031-scoped-rbac-roles-assignments.md)).
- Keepalive: WebSocket ping every 30 s; Traefik `readTimeout: 0`.
- Attach/detach are signalled to the run workflow. Input is not: attaching makes xterm.js reply to tmux's queries, so a turn start comes from the runner's `UserPromptSubmit` hook instead.

## Alternatives considered

| Alternative                             | Why rejected                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Structured stream only (approach B)     | Set aside for the PoC; becomes the MVP default with the terminal kept as an "open terminal" view |
| ttyd/gotty embed; hterm (frontend spec) | Weighed; xterm.js "chosen in the Architecture doc"                                               |

## Consequences

### Positive

- Exact CLI fidelity; tmux redraws the screen on reconnect.
- Kubernetes credentials stay in the control plane; runner needs no inbound path.
- Works on EKS and AKS since the api runs inside the cluster network.

### Negative

- The api service account holds `pods/exec` in `agentdesk-runs` (shell-equivalent).
- No live byte history; only final scrollback is stored.
- Small screens get a terminal; mobile-friendly view waits for approach B.
- Open checks: resize on channel 4; TUI rendering and flicker under tmux in
  xterm.js; `screenReaderMode` usefulness.

## Links

- [Architecture (PoC)](<../Agent Desk — Architecture (PoC).md>) §6, §7, §9
- [Control plane design](../superpowers/specs/2026-11-12-control-plane-design.md) §7.5, §11
- [Frontend design](../superpowers/specs/2026-11-12-frontend-design.md) §2, §5.3, §13
- [Infra design](../superpowers/specs/2026-11-12-infra-design.md) §5.1, §11, §13
- Related: [0011](0011-interactive-claude-code-in-tmux.md), [0015](0015-live-updates-over-sse.md)
