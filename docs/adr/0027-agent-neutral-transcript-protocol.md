# 0027. Agent-neutral transcript protocol with per-agent adapters

- Status: Accepted
- Date: 2026-11-19
- Source: [Saved transcript for stopped runs and a resumable Stop session](../superpowers/specs/2026-11-19-stopped-session-resume-design.md) §2, §2.2, §3, §4, §10

## Context

[0011](0011-interactive-claude-code-in-tmux.md) keeps history as the final scrollback only: plain terminal text saved
when the pod ends. A run page with no live pod therefore shows capped terminal text, and a pod killed hard loses
everything since the last save. A stopped or paused run needs the conversation itself, as separate messages, and it
must survive a hard kill. Agent Desk stays provider-agnostic ([0005](0005-provider-agnostic-naming-adapter-seams.md)),
and [0020](0020-agent-status-protocol.md) already splits the status channel into an agent-neutral protocol and one
adapter per agent CLI.

## Decision

Add a second protocol line with the same split as 0020.

- **Wire line (agent-neutral):** `agentdesk: transcript <base64 of one JSON object>`, printed on the pod's stdout
  (`/proc/1/fd/1`; `AGENTDESK_STATUS_OUT` overrides it in tests). The object is `TranscriptWireEntry` in
  `packages/contracts`: `id` (1 to 128 chars of `[A-Za-z0-9._:-]`, the adapter's stable id), optional `at`, `kind`
  (`user` | `agent` | `tool` | `notice`), `text` (at most 8,000 UTF-8 bytes), optional `tool` (only for `kind: tool`),
  optional `truncated`. The log parser accepts a base64 body of at most 12,000 chars and only a line that passes
  `TranscriptWireEntry`; anything else stays an ordinary text line.
- **Adapter contract (runner image, one per agent):** `images/runner/agents/<agent>/transcript.mjs` reads the agent
  CLI's own session log and prints new entries as wire lines, cutting text to the byte cap and skipping what the
  person never saw (hidden reasoning, meta entries). It keeps its read offsets in a state file under
  `$HOME/.agentdesk/` on the run volume, so a resumed pod continues where the last one stopped, behind an exclusive
  lock file with a stale timeout. It offers `transcript.mjs flush`, which sends everything new and exits within 5 s.
  Claude Code is the first adapter; tool output (`tool_result`) and `thinking` are not stored.
- **Getting entries out of the pod:** hooks plus a flush, not a tail process. The Claude hook that 0020 already runs
  on every prompt, tool call and turn end calls the adapter each time. The entrypoint runs `flush` (with `timeout 5`,
  errors ignored) right after `agentdesk: session started` and at the start of `end_session`, before the scrollback.
  Both calls are skipped when the agent's directory has no `transcript.mjs`, which is how an agent without an adapter
  behaves.
- **Storage:** the worker's log follower redacts each entry's text with the run's secrets and inserts it into Postgres
  (`run_transcript_entries`, through `withOrg`), idempotent on `(run_id, source_id)` so a reconnect or a resume's start
  flush never duplicates an entry. Per-run cap: 20,000 entries, then one notice and later entries are dropped.
  Transcript lines are not written to `run_events`, the run SSE stream or workflow history.
- **View:** read-only plain text. The agent shares the container and can print a forged transcript line into its own
  run; that is accepted as for status lines (0020), since the impact stays in that run.

This amends 0011's "history is final scrollback only": the scrollback is still saved, and the transcript is saved
next to it. It extends 0020's adapter model to transcripts.

## Alternatives considered

| Alternative                                                                  | Why rejected                                                                                                    |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| B. Save more terminal text (raise tmux's line limit, save at every turn end) | Still capped terminal text rather than messages, and lost on a hard kill between saves                          |
| C. Read the run volume on demand with a reader pod                           | Starts a pod just to look, which the requirement forbids, and the volume is gone after expiry, cancel or Finish |
| A tail process started by the entrypoint                                     | One more process to supervise and to keep from blocking the pod's end                                           |

## Consequences

### Positive

- A run with no live pod shows the real conversation, and it survives a hard pod kill except for the step in progress.
- Adding Codex, Gemini CLI or Cursor is one `transcript.mjs` with fixtures; contracts, db, worker and UI do not change.
- No new long-running process in the pod.

### Negative

- Depends on each CLI's local session log format, which is not documented as stable; each adapter needs fixtures and a
  pinned CLI version.
- Entries written after the last hook and before a hard kill reach Postgres only on the next Resume's start flush;
  a run never resumed loses them.
- Up to 20,000 entries of 8 KB per run are stored in Postgres.

## Links

- [Spec](../superpowers/specs/2026-11-19-stopped-session-resume-design.md) §2, §3, §4
- Related ADRs: [0011](0011-interactive-claude-code-in-tmux.md), [0020](0020-agent-status-protocol.md), [0022](0022-pause-and-resume-runs-on-a-per-run-volume.md)
