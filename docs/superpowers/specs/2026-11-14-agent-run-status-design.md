# Agent Run Status — Design

- Date: 2026-11-14
- Status: Draft
- Related: [ADR 0011](../../adr/0011-interactive-claude-code-in-tmux.md) (updated by [ADR 0020](../../adr/0020-agent-status-protocol.md)), [control plane design](2026-11-12-control-plane-design.md) §6.2, §8

## 1. Intent

A run shows **Needs you** (`idle`) whenever the agent stops talking. The agent stops talking for three different
reasons, and only one of them needs a person:

1. it is waiting on its own background work (a background shell, a background subagent, a scheduled wake-up);
2. it finished the task;
3. it asked the human a question and is waiting for the answer.

There is also the reverse error: when the agent asks through its built-in question menu (`AskUserQuestion`), the
`Stop` hook does not fire, so the run keeps showing **Running** while it is really waiting for a person.

The wrong status also does damage: after 10 minutes of `idle` with no terminal attached the workflow ends the
session as `succeeded`, so a run waiting on a long background build is killed mid-work and reported as a success.

The root cause is the channel between the agent shell and Agent Desk: it carries one fixed line ("turn finished")
and throws away everything the agent and its CLI know. This design defines a clear status model, a clear channel,
and clear rules for who sets each status.

**Why now:** "Needs you" is the product's main call to action. If it is wrong, people stop trusting it, and runs get
killed while working.

## 2. Goals, non-goals, anti-goals

Goals

- "Needs you" means a person is needed: the agent asked a question, or is waiting for an approval.
- A run waiting on its own background work shows **Running** and is never ended by the idle timer.
- A finished run shows a new **Done** status, stays open for review and follow-up for a while, then closes as
  `succeeded`.
- The channel is agent-neutral: Agent Desk (contracts, db, worker, UI) does not know which agent CLI produced a
  status. Supporting Codex, Gemini or Cursor later means adding one adapter in the runner image.

Non-goals

- Switching to a structured SDK stream (ADR 0011 "approach B"). This design keeps the tmux TUI.
- Adapters for Codex, Gemini or Cursor. They are researched (§9) but not built.
- Changing the timeout for an unanswered question (today's 10-minute auto-finish stays as is; see §8).
- Screen scraping the terminal.

Anti-goals (a failure even if it "works")

- Agent Desk logic that branches on the agent CLI (`if claude …`).
- Trusting text the agent or the repo wrote as a control signal without strict parsing.
- A repo being able to switch off or spoof our status hooks through its own settings.
- A run that can never leave a waiting state (every wait has an exit: answer, timer, Finish, cancel or hard timeout).

## 3. Findings (spike and research)

Spike on the pinned Claude Code 2.1.323, interactive in tmux, with a hook logging every event:

| What the agent is doing          | Events we get                                                                 | Today shows          |
| -------------------------------- | ----------------------------------------------------------------------------- | -------------------- |
| Waits on a background shell      | `Stop` with `background_tasks: [{type: shell, status: running}]`              | Needs you (wrong)    |
| Waits on a background subagent   | `Stop` with `background_tasks: [{type: subagent, status: running}]`           | Needs you (wrong)    |
| Background work finishes, wakes  | `UserPromptSubmit` with prompt `<task-notification>…`                         | Running (right)      |
| Asks via `AskUserQuestion`       | `PreToolUse` + `PermissionRequest` (tool `AskUserQuestion`), then `Notification: permission_prompt`; **no `Stop`** | Running (wrong) |
| Asks in plain text               | `Stop`, empty `background_tasks`, `last_assistant_message` = the question     | Needs you (right)    |
| Finished                         | `Stop`, empty `background_tasks` — **same as the line above**                 | Needs you (wrong)    |

Also seen: `Notification: idle_prompt` about 60 s after a truly idle stop; spurious `SubagentStop` events from
Claude Code's own internal agents (ignore them); the CLI auto-updated itself mid-session (the runner does not set
`DISABLE_AUTOUPDATER`).

Declaration spike: a tiny `agentdesk-status done|needs_input "<summary>"` command plus a `Stop` hook that blocks once
(`decision: "block"`) when the agent stops without declaring. The agent declared `needs_input` for its question, and
on the next turn declared `done` without being blocked.

Research (sources in §9): mature systems let the agent declare its own outcome through an explicit action (OpenHands
finish / wait-for-response, Codex `requestUserInput`, A2A agent-set `input-required` / `completed`), and keep
liveness (pod alive), activity (working / waiting on what) and outcome (done / failed) apart. No agent CLI we checked
(Claude Code, Codex, Gemini, Cursor) can tell "done" from "asked a question" by itself; all four can block a turn end
and can run a shell command we provide.

## 4. Approaches

| Approach                                                                                 | Trade-off                                                                                         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **A. Hooks + a declare command, in two layers (chosen)**                                  | Small change, keeps the live terminal, fits all four agents researched. Relies on hooks working.   |
| B. Same, but the declaration is an MCP tool served in the pod                             | Typed input, but one more process to ship and secure; no gain over a strictly parsed command.     |
| C. Structured SDK stream (ADR 0011 approach B)                                            | Most reliable signal, but a large rebuild and loses the live TUI for now.                         |
| D. Screen scraping (claude-squad style)                                                   | Fragile, breaks on every TUI change, can't tell done from asked. Rejected.                        |

The human picked **A, in two layers**: an agent-neutral protocol in Agent Desk, and one adapter per agent in the
runner image. Claude Code's adapter is built now.

## 5. Status model

### 5.1 Run status (what people see)

`queued` → `starting` → `running` ⇄ `idle` ⇄ `done` → `succeeded` | `failed` | `cancelled` | `timed_out`

| Status    | Label (UI)  | Meaning                                                                   | Who sets it                      |
| --------- | ----------- | ------------------------------------------------------------------------- | -------------------------------- |
| `running` | Running     | The agent is working, or waiting on its own background work               | runner signal                    |
| `idle`    | Needs you   | The agent asked a question or waits for an approval                       | runner signal                    |
| `done`    | Done (new)  | The agent declared the task complete; open for review and follow-up       | runner signal                    |
| others    | unchanged   |                                                                           | workflow, as today               |

`idle` keeps its name in the database and contract to avoid churn across migrations, API, UI and tests; only its
meaning narrows. (Builder may rename to `needs_input` in a separate PR; not part of this work.)

`done` is a new **active** (non-final) status: terminal attach is allowed, Finish is allowed, typing a message moves
it back to `running`.

### 5.2 Activity detail (what the note says)

While `running`, the run carries an optional `waitingOn: 'background' | null`. The UI shows "Waiting on background
work" as the status note. This is display only; it does not change the status or the timers.

### 5.3 Agent note

`idle` and `done` carry an optional short `agentNote`: the agent's own one-line summary or question (from the
declare command, or the `AskUserQuestion` question text, or `last_assistant_message` as a fallback). It is untrusted
text: single line, capped at 500 characters, passed through run-output redaction, rendered as plain text only.

### 5.4 Timers

| Status    | No terminal attached for 10 min                   | Finish   |
| --------- | ------------------------------------------------- | -------- |
| `running` | nothing (hard timeout still applies)              | 409      |
| `idle`    | end session → `succeeded` (unchanged from today)  | allowed  |
| `done`    | end session → `succeeded`                         | allowed  |

The idle-end duration stays `IDLE_END_SECONDS` (10 min) for both `idle` and `done`.

### 5.5 Finish must reliably close the run

How it works today: the UI enables **Finish run** only when the status is `idle` (`RunDetail.tsx`, the Needs-you
banner in `RunTerminalArea.tsx`). The API (`runs.service.ts` `finish`) checks the **database** status is `idle`, then
sends the `finish` signal and returns 204. The workflow honours the signal only if **its own** phase is `idle`;
otherwise it drops it silently. On accept it kills the tmux session (`endSession`) and the run ends `succeeded`.

Gaps found:

1. **Silent drop.** The database status and the workflow phase are written by different code paths
   (`followPodLogs` writes `idle` before the workflow's `turnFinished` handler runs; the workflow writes `running`
   after `resumed`). In the gap, the API says yes (204), the workflow drops the signal, and the UI shows
   "Finishing…" until the run happens to end. With the page attached the idle timer is paused, so that can be
   forever. The worker e2e test works around this by waiting for the workflow's phase before finishing
   (`apps/worker/test/run.e2e.int.test.ts`).
2. **Can't finish a run that really needs you.** While `AskUserQuestion` is open, the status is `running`
   (§1), so Finish is disabled and only Cancel works, which ends the run `cancelled`, not `succeeded`. Fixed by
   this design's status mapping.
3. **No Finish from Done** (new status): must be enabled.

Rules after this change:

- Finish is allowed in `idle` and `done` (UI button, API check and workflow check all use the same set).
- Finish becomes a Temporal **workflow update** with a validator instead of a fire-and-forget signal. The workflow
  decides, and the API returns its answer: accepted → 204 and the run ends `succeeded`; rejected (the workflow is not
  in `idle`/`done`) → 409 with the current status, and the UI clears "Finishing…" and shows the error. No silent drop.
- The update resolves once `endSession` has been issued (not when the pod exits), so the API answers fast; the run
  reaching `succeeded` arrives over SSE as today.
- If `endSession` fails (pod gone, exec error), the run still ends: the existing log follower sees the pod exit and
  the workflow finalizes; the hard timeout is the backstop.

Tests required: workflow tests for finish in `idle`, in `done`, and in `running` (rejected); a test for finish sent
in the gap between the database status and the workflow phase (must not hang, must answer 409 or succeed); the
local e2e (`apps/web/e2e/local/run.spec.ts`) clicks Finish from Needs you and from Done and sees `succeeded`.

## 6. The channel (two layers)

### 6.1 Layer 1: Agent Desk protocol (agent-neutral)

The runner prints one marker line per state change on the pod's stdout (PID 1's stdout, as today):

```
agentdesk: state working
agentdesk: state waiting background
agentdesk: state needs_input <source> <note-b64>
agentdesk: state done <source> <note-b64>
```

- `<source>`: `declared` (the agent ran the declare command), `question` (built-in question menu), `approval`
  (permission or elicitation prompt), `undeclared` (the agent stopped without declaring after one block), `error`
  (the CLI reported a stop failure).
- `<note-b64>`: the agent note, base64 (so untrusted text can never add fields, spaces or lines). Optional; `-` when
  empty.
- The log parser (`packages/core/src/kube/log-parser.ts`) matches the whole line with an anchored regex, decodes the
  note, and validates it with a Zod schema in `packages/contracts`. Anything that does not match is plain output.
- The old lines `agentdesk: turn started` / `agentdesk: turn finished` stay parsed for one release and map to
  `working` / `needs_input undeclared`, so an older runner image keeps working with a newer worker.

Mapping to run status in the worker (`followPodLogs` + `RunWorkflow`):

| Line                         | Run status                    | Notes                                          |
| ---------------------------- | ----------------------------- | ---------------------------------------------- |
| `working`                    | `running`, `waitingOn: null`  | replaces `turn_started` / `resumed`            |
| `waiting background`         | `running`, `waitingOn: background` | idle timer does not run                   |
| `needs_input …`              | `idle`, `agentNote`           | replaces `turn_finished` / `turnFinished`      |
| `done …`                     | `done`, `agentNote`           | new signal; same timer as `idle`               |

Replay and ordering keep today's rules: each line is stored once as a lifecycle event (`storeLineEvent`), status
writes use `onlyFrom` guards, and a replayed line re-signals only while the status still matches.

### 6.2 Layer 2: the Claude Code adapter (runner image)

Files under `images/runner/agents/claude/`:

- `agentdesk-status` (on `PATH`): `agentdesk-status done|needs_input "<one line>"`. Validates the state, writes the
  declaration to a file in a runner-owned directory outside the repo, prints a confirmation. It does not write to
  stdout markers itself; the `Stop` hook does.
- Hook script(s) that read Claude Code's hook input (JSON on stdin, parsed strictly), apply the rules below, and
  print protocol lines to `/proc/1/fd/1`.
- Settings that register the hooks, installed as **managed settings** (`/etc/claude-code/managed-settings.json`) so
  a repo's `.claude/settings.json` cannot disable or override them. The current user-level
  `/home/runner/.claude/settings.json` keeps only non-hook options (`skipDangerousModePermissionPrompt`).
- `DISABLE_AUTOUPDATER=1` in the image, so the pinned version cannot change mid-run.

Adapter rules:

| Claude Code event                                          | Emits                                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `UserPromptSubmit` (any prompt, incl. `<task-notification>`) | clear any stored declaration; `state working`                       |
| `PreToolUse` on `AskUserQuestion`                          | `state needs_input question <first question text>`                    |
| `PostToolUse` on `AskUserQuestion`                         | `state working`                                                       |
| `Notification` `permission_prompt` / `elicitation_dialog` (when not already in a question) | `state needs_input approval <message>` |
| `Stop`, declaration `done` stored this turn                | `state done declared <summary>` (even if background work is running)  |
| `Stop`, declaration `needs_input` stored this turn         | `state needs_input declared <summary>` (same)                         |
| `Stop`, no declaration, `background_tasks` or `session_crons` not empty | `state waiting background` (no block)                    |
| `Stop`, no declaration, `stop_hook_active` false           | block once: reason tells the agent to run `agentdesk-status`          |
| `Stop`, no declaration, `stop_hook_active` true            | `state needs_input undeclared <last_assistant_message>` (safe fallback) |
| `StopFailure`                                              | `state needs_input error -`                                           |
| `PreToolUse` on any other tool, when the last emitted state was not `working` | `state working` (recovery, see below)              |
| `SubagentStop`, `SessionEnd`, others                       | nothing                                                               |

Recovery rule: a repo or plugin `Stop` hook can block the turn end after our hook already emitted `done` or
`needs_input`, so the agent keeps working with no `UserPromptSubmit`. The first tool call after that emits `working`
again, so the status self-corrects and the idle timer stops. The adapter keeps its last emitted state in its
runner-owned directory so this costs a file read per tool call and prints nothing in the normal case.
`allowManagedHooksOnly` is not used: repos and approved plugins keep their own hooks.

The prompt (`packages/core/src/router/prompt.ts`) gains one fixed line telling the agent to run
`agentdesk-status done "<summary>"` when the task is complete, or `agentdesk-status needs_input "<question>"` when it
needs an answer, before ending its turn. The `Stop` block is the enforcement; the prompt line saves a round trip.

## 7. Constraints

- Contracts first: `RunStatus` gains `done`; `ACTIVE_RUN_STATUSES` includes it; the run DTO gains
  `waitingOn` and `agentNote`; the status line schema lives in `packages/contracts`.
- New migration for the `runs.status` check constraint and the new columns; never edit an applied migration.
- Provider-agnostic: no `claude` in contracts, db, worker or UI names. Claude-specific code lives only in
  `images/runner/agents/claude/`.
- Secrets: `agentNote` goes through run-output redaction before it is stored or sent over SSE.
- Untrusted text: hook input, `last_assistant_message`, question text and declaration summaries are never put into a
  shell command, k8s spec or SQL string; hook scripts pass them only as data (`jq --arg`, base64).
- Spoofing: the agent runs with bypass permissions and could write a marker to `/proc/1/fd/1` itself. Impact is
  limited to its own run's status (no secret, no other tenant). Accepted for the PoC; noted in the ADR.
- Tests: hook rules get fixture-driven tests using the payloads captured in the spike (in `images/runner/test`); the
  log parser, worker activity and workflow get unit tests; the fake pod (`packages/core/src/kube/fake-pod.mjs`) and
  e2e-local switch to the new lines. No network in tests.
- UI: `done` gets a label, tone and icon from design tokens, a story, and the Done note; the "Needs you" count
  excludes `done`.

## 8. Decided by the human / left to the builder

Decided:

- Approach A in two layers; Claude Code adapter now, others later.
- On "done": a new **Done** status, terminal stays open, closes as `succeeded` after 10 minutes unattended; typing
  a message makes it Running again.
- Our hooks never go into the repo's settings.
- Finish must be checked and must reliably close the run (§5.5).
- The agent's declaration wins over background work: rules are checked top to bottom in §6.2, so a declared `done`
  shows Done even with a dev server left running. Background work only keeps a run Running when the agent declared
  nothing, and then the agent is not pushed to declare. A declaration lasts one turn; a `<task-notification>` wake-up
  starts a new turn, and the agent declares again at its end.

My calls (correct me):

- Keep the `idle` value name; only its meaning narrows.
- Keep today's 10-minute auto-finish for an unanswered question (`idle`).
- Undeclared stop after one block falls back to Needs you.
- Old marker lines stay supported for one release.
- `waitingOn` is display only.
- Finish stays unavailable while `running` (including waiting on background work); Cancel covers that case.
- Finish moves from a signal to a workflow update so the API can answer truthfully.
- A repo/plugin `Stop` hook that blocks after ours is handled by the `PreToolUse` recovery rule (§6.2), not by
  `allowManagedHooksOnly`.
- Hard timeout while `done` ends the run `succeeded` (the agent said it finished; someone just kept the page open).
  Hard timeout in `idle` or `running` still ends `timed_out`, as today.

Left to the builder: hook script language (bash + jq or a small Node script, both already in the image), exact
declaration file location, UI copy and icon for Done, PR split (expected: contracts + db; core parser + fake pod;
runner adapter; worker; web).

Checked on 2.1.323 (runner image built from `images/runner`): with a managed `SessionStart` hook in
`/etc/claude-code/managed-settings.json` and a repo `.claude/settings.json` containing `disableAllHooks: true`, the managed
hook still fired (`managed-fired` in the output). The repo's own hook did not fire, and the image's user-level hook
(`agentdesk: turn started`) also did not fire in that run, though it did in a control run without the repo setting. So a repo
can switch off user-level hooks but not managed ones. The managed-settings choice holds.

## 9. Sources

- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Claude Code agent view states: https://code.claude.com/docs/en/agent-view
- A2A task states: https://a2a-protocol.org/latest/specification/
- ACP prompt turn: https://agentclientprotocol.com/protocol/prompt-turn
- Codex hooks: https://developers.openai.com/codex/hooks.md
- Gemini CLI hooks: https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md
- Cursor hooks: https://cursor.com/docs/agent/hooks

Other agents (for later adapters):

| | Codex | Gemini | Cursor |
|---|---|---|---|
| Block turn end to force a declaration | `Stop` → `decision: block` | `AfterAgent` → `decision: deny` | `stop` → `followup_message` (limit 5) |
| Waiting on own work | subagents only | not reported | subagents only |
| Asking the human | `PermissionRequest`; app-server flags | `Notification ToolPermission`; `ask_user` tool | not in interactive mode |
| Managed settings a repo can't override | `requirements.toml` | `/etc/gemini-cli/settings.json` | `/etc/cursor/hooks.json` (but last `followup_message` wins) |
| Risks | — | — | CLI hooks reported failing silently on Linux |
