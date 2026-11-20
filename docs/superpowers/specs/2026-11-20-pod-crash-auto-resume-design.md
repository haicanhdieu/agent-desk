<!-- dev-plan: kind=spec id=pod-crash-auto-resume rev=1 hash=0ae4cec009a7 source=text -->
# Automatic resume after an unexpected pod end — design

Date: 2026-11-20 · Status: draft for approval · Sensitive: yes (run Job and runner: a new env value on the resume Job
and a change to the runner's resume command; terminal: the relay tells the run when a person types; migration: a new
column with a check constraint on `agents`)

Builds on the [pause and resume design](2026-11-15-run-pause-resume-design.md) ([ADR 0022](../../adr/0022-pause-and-resume-runs-on-a-per-run-volume.md)),
the [run terminal lifecycle redesign](2026-11-16-run-terminal-lifecycle-redesign.md) ([ADR 0023](../../adr/0023-runner-entrypoint-owns-the-end-of-a-run-pod.md)),
[ADR 0024](../../adr/0024-transient-cluster-errors-never-end-a-run.md) and the
[stopped session design](2026-11-19-stopped-session-resume-design.md). Needs a new ADR (outline in §9).

## Intent

QA run 34 lost its pod three times to the 3Gi memory limit (exit 137, killed by the kernel while the agent ran the
local stack and a Playwright spec in the background). Each time the run went to **Paused** and sat there until a
person pressed Resume. The human wants such a run to **resume by itself**, but **not forever**: the maximum number of
automatic tries is configurable.

The answers added:

- The maximum is an **agent setting**, on the agent settings page, **default 5** (batch 1, Q1).
- What counts as an unexpected end is defined below (U1 to U5, batch 1, Q2).
- The count covers only automatic tries **while no person is around**. When a person interacts, the count starts
  again; interacting means **opening the terminal and typing to the agent** (batch 1, Q3; batch 2, Q1).
- A person sees a line in the run's event log for each automatic resume, and the paused notice says when the tries
  ran out (batch 1, Q4).
- It **reuses the pause and resume path** (batch 1, Q5).
- The resumed agent is **told exactly why its last session was killed**, in a short fixed note (batch 1, Q6; batch 2,
  Q3). The note is also given when a **person** presses Resume after an unexpected end (batch 2, Q2).

## Architecture at a glance

**Flow end to end.** The pod dies after the agent started → the worker's log follower (`followPodLogs`) reads the
exit code and the cluster's kill reason (`OOMKilled`, `Evicted`, …) → the run workflow classifies the end (U1 to U5
below) and parks the run as today (paused, slot freed, volume kept) → if the agent's limit allows another try, the
workflow starts the existing Resume attempt at once (queue through the project gate → new Job on the same volume with
`RUN_MODE=resume` and `RESUME_NOTE=<fixed note>`) → the runner starts `claude --continue "<note>"` → the run is back
to Needs you / Running. If the new pod cannot start, the workflow waits (1, 2, 4, 8, at most 10 minutes) and tries
again, each attempt using a try. At the limit the run stays paused and the paused notice says so. A person typing into
the terminal, or pressing Resume, sets the count back to 0.

**Components changed**

| Component | Change |
| --- | --- |
| `apps/worker` workflow (`run.workflow.ts`, `park.ts`, `signals.ts`) | try count, U1–U5 decision, automatic resume through the existing park/resume code, new `personInput` signal, behind `patched('auto-resume')` |
| `apps/worker` activities (`run.activities.impl.ts`, `session.activity.ts`) | `followPodLogs` returns the pod's kill reason; new `recordAutoResume` writes two new event kinds; `createRunSecretAndJob` puts the note on the resume Job; `loadRun` reads the new agent field |
| `apps/api` | agent service reads/writes the new field; terminal relay sends `personInput` when a person types |
| `apps/web` | agent settings field; one line in the paused notice |
| `packages/core` | note text builder; `buildRunJob` adds `RESUME_NOTE`; `SIGNAL.personInput`; fake pod prints the note |
| `packages/contracts` | new agent field and its bounds |
| `packages/db` | one new column and migration |
| `images/runner` | `AGENT_RESUME_CMD` passes `RESUME_NOTE` to Claude Code |

**DB schema (one new migration, the next number after `0019_run_transcript_entries.sql`)**

| Table | Column | Type | Default | Constraint |
| --- | --- | --- | --- | --- |
| `agents` | `auto_resume_max` | `integer not null` | `5` | `check (auto_resume_max between 0 and 10)` (`agents_auto_resume_max_check`) |

No other table changes. The try count lives in the workflow (Temporal history), not in Postgres. The two new run event
kinds (`auto_resume`, `auto_resume_gave_up`) are rows of the existing `run_events` table (type `lifecycle`, JSON
payload), so they need no schema change. `agents` keeps its existing RLS policy.

**API endpoints and contracts**

- No new endpoint.
- `GET /api/projects/:projectId/agent` (`AgentDto`): new field `autoResumeMax: number`.
- `PUT /api/projects/:projectId/agent` (`PutAgentRequest`): new optional field `autoResumeMax` (integer 0 to 10;
  absent keeps the stored value). New constants `AGENT_AUTO_RESUME_MAX_MIN/MAX/DEFAULT` (0, 10, 5).
- Run event payloads (not in contracts today; parsed with Zod in the web): `lifecycle`
  `{ kind: 'auto_resume', try, max, text }` and `{ kind: 'auto_resume_gave_up', tries, text }`.
- Temporal: new run signal `personInput` (no arguments). No new update; the existing `resumeRun` update now also resets
  the count. Activities: new `recordAutoResume`; `createRunSecretAndJob` gains optional `note`; the `followPodLogs`
  result gains optional `podReason`.

**Third-party libraries.** None new. Uses what the repo has: Temporal TypeScript SDK 1.25 (`patched`, signals,
activities), `@kubernetes/client-node` (pod status read), Drizzle (column, migration), Zod (contracts, payload
parsing), NestJS (agent service, terminal gateway), React and Storybook (web).

**Services and external systems**

- Kubernetes API: reads the run pod's `status.containerStatuses[].state.terminated.reason` / `.exitCode` and
  `status.reason` (already read by `getRunPod`; the reason is now kept); creates the resume Job with one more env value.
- Temporal: the run workflow (one new signal, one new patch); the project gate is unchanged (the resume queues through
  it).
- Postgres: one new `agents` column; two new `run_events` payload kinds.
- Terminal relay (WebSocket exec, ADR 0014): looks at the input bytes of an authorized run terminal to decide "a person
  typed", then signals the workflow.
- Claude Code CLI: the resume command becomes `claude --permission-mode bypassPermissions [--model …] --continue
  "<note>"` (a positional prompt with `--continue`; confirmed by a spike, §5).

**Config and env**

- No new deployment env var. Uses the existing `RUN_POD_MEMORY_LIMIT` (for "limit 3Gi" in the note).
- New per-agent setting `autoResumeMax` (default 5).
- New pod env value `RESUME_NOTE`, on resume Jobs only (set by the worker, read by the runner image).

## Unexpected ends (agreed definition)

Only ends **after the agent session started** count. Unexpected means the pod ended without anyone asking and the
agent did not finish cleanly:

| Id | What happened                                                                       | How it is recognised today (`endOutcome` in `apps/worker/src/workflows/park.ts`) |
| -- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| U1 | Pod killed by the system (out of memory 137, Job deleted, eviction with no grace)   | non-zero exit code, no `session ended` line → park `pod_lost`                    |
| U2 | Pod lost (node died or restarted, cluster unreachable longer than the window)       | pod vanished or no exit code (`podLost`) → park `pod_lost`                        |
| U3 | Pod shut down from outside (drain, eviction, preemption)                            | end line `signal` → park `pod_lost`                                               |
| U4 | The agent's terminal session died                                                   | end line `session_gone` → park `pod_lost`                                         |
| U5 | The agent CLI crashed by itself                                                     | end line `agent_exit` with a non-zero exit code → park `agent_crashed`            |

Expected, never resumed automatically: a person's Stop, Finish or Cancel; the idle timer; agent exit 0; any failure
before the session started (setup failed, image pull, unschedulable); a resume with no saved session (exit 79).

So U1 to U5 are exactly the parks with `pauseReason` `pod_lost` or `agent_crashed`.

## Goals

1. After U1 to U5, a run resumes automatically through the existing Resume path, as long as the agent's maximum
   allows another try.
2. **Automatic resumes** (`autoResumeMax`): a per-agent setting on the agent settings page, default 5. 0 turns
   automatic resume off.
3. Tries are counted in a row. The count starts again when a person types into the run's terminal, or presses Resume.
4. When the tries run out (or automatic resume is off), the run stays paused for a person, as today.
5. Each automatic resume adds a line to the run's event log; when the tries have run out, the paused notice says
   "Tried to resume automatically N times."
6. Every resume that follows an unexpected end (automatic or by a person) gives the agent a short note naming the
   exact reason the last session ended.

## Non-goals

None stated beyond the expected ends listed above.

## Constraints

- AGENTS.md rules 1 to 11; layering `apps → core → db → contracts`, `web → contracts` only.
- Rule 1: the new agent field starts in `packages/contracts` (`AgentDto`, `PutAgentRequest`).
- Rule 3: generic names only (`autoResumeMax`, `auto_resume`, `personInput`); no provider names.
- Rule 4: the agent column is read and written through the existing scoped agent queries and `withOrg`.
- Rule 5: the note and the event text hold no secret: fixed text plus an exit code, a cluster reason word and the
  configured memory limit.
- Rule 6: the note is built from fixed text and checked values only, never from pod output, ticket or repo text. The
  only cluster-provided word (the container's `terminated.reason`, e.g. `OOMKilled`) must match `^[A-Za-z]{1,40}$`,
  else it is left out. The note reaches the pod only as an env value, and the runner passes it as one quoted argv
  element.
- Rule 7: the "person typed" signal is sent only for a socket that passed the terminal's existing authorization and
  has a live exec session.
- Rule 8: a new migration; no applied migration is edited.
- Workflow changes sit behind a new `patched('auto-resume')`, read once right after `stopSession`'s patch; runs that
  started before the deploy keep today's behaviour (paused until a person resumes).
- The runner image must be live before the worker sends `RESUME_NOTE` (an older image ignores the env value, so the
  order only affects whether the agent sees the note).

## Approaches

Picked by the human: **A, reuse pause and resume** (batch 1, Q5).

| Approach | Trade-off | Verdict |
| --- | --- | --- |
| A. Park the run as today, then start the existing Resume attempt at once | Reuses the gate, the volume, the failure fallback and the cancel rules. Status shows Paused, then Queued/Starting; the slot is freed and requested again, so at the project's run limit the run may wait in the queue | **Chosen** |
| B. Restart in place: delete the dead Job and start a resume pod while keeping the slot; status stays running | No status flicker, slot kept. A second resume code path to keep in step with the first | Not chosen |
| C. Let Kubernetes retry the pod (Job `backoffLimit`) and have the runner switch to resume mode | Retry count is native. Fights ADR 0023 (the runner owns the pod's end), the workflow follows one pod, and the count would be a deployment setting | Rejected |

## Design

### 1. Agent setting (contracts, db, api)

- `packages/contracts/src/schemas/agents.ts`: `AgentDto.autoResumeMax: number` (int);
  `PutAgentRequest.autoResumeMax` optional (absent keeps the stored value), int, between the new constants
  `AGENT_AUTO_RESUME_MAX_MIN = 0` and `AGENT_AUTO_RESUME_MAX_MAX = 10`, default `AGENT_AUTO_RESUME_MAX_DEFAULT = 5`.
  Message: "Automatic resumes must be between 0 and 10".
  - Agent call: range 0 to 10. Reason: each try adds park and resume events to the workflow history and can add up to
    an hour past the time limit (the resume allowance floor), so a small bound is enough; 0 is the human's "off".
- `packages/db`: new migration adding `agents.auto_resume_max integer not null default 5` with
  `check (auto_resume_max between 0 and 10)`, and the Drizzle column `autoResumeMax`.
  - Agent call: existing agents get 5, so automatic resume is on for them after the deploy. Reason: the human set the
    default to 5 and gave no exception for existing agents.
- `apps/api/src/agents/agents.service.ts`: reads and writes the field like `idleEndSeconds`.
- `RunContext` (`apps/worker/src/activities/run.activities.ts`) gains `autoResumeMax?: number`, filled by `loadRun`
  from the agent row (`AGENT_AUTO_RESUME_MAX_DEFAULT` when the agent row is gone), like `idleEndSeconds`.
  - Agent call: the limit is read once when the run starts, so a change applies to runs started afterwards. Reason:
    the same as `idleEndSeconds` and the other agent limits today.

### 2. Run workflow (`apps/worker/src/workflows`)

New workflow state, used only with the `auto-resume` patch:

- `autoResumeStreak: number`: automatic resumes started since a person last interacted.
- `lastEnd: UnexpectedEnd | undefined`: the facts of the last unexpected end, for the note.

New pure decisions in `park.ts` (unit-tested, workflow-safe):

- `unexpectedEndOf(input: EndOutcomeInput & { podReason?: string }): UnexpectedEnd | undefined`: the U1 to U5 kind with
  its facts (`kind: 'killed' | 'lost' | 'signal' | 'session_gone' | 'agent_exit'`, `exitCode?`, `podReason?`), using the
  same order as `endOutcome`; `undefined` for any end that is not unexpected. A test asserts it returns a value exactly
  when `endOutcome` parks with `pod_lost` or `agent_crashed`.
- `autoResumeDecision(streak, max, parkKind): 'resume' | 'gave_up' | 'off'`: `off` when `max` is 0 or the park kind is
  `done`; `gave_up` when `streak >= max`; else `resume`.
  - Agent call: no automatic resume when the agent had declared `done` before the pod died (the park is `succeeded`
    with a kept session). Reason: the agent said its work was finished and the run already shows succeeded; a resume
    would start work nobody asked for. A person can still resume it, with the note.

Flow, where `run()` handles a `park` decision with reason `pod_lost` or `agent_crashed`:

1. Record `lastEnd` from `unexpectedEndOf`.
2. `resume` → `park(...)` frees the slot and writes the paused status exactly as today, **skips the `paused` ticket
   comment**, and then starts an automatic try: `autoResumeStreak += 1`, the new activity `recordAutoResume` appends
   the `auto_resume` event (§3), and the workflow accepts a resume itself (sets `resumeAccepted`, a fresh
   `resumeScope`, clears `resumeAbortReason`, marks the resume as automatic), so the parked loop runs `resumeAttempt`
   at once.
   - Agent call: no wait between the park and the first automatic try. Reason: the dead pod is already gone, and the
     note tells the agent what used up the pod.
3. `gave_up` → `park(...)` as today (the paused comment is posted), then `recordAutoResume` appends the
   `auto_resume_gave_up` event; the run waits.
4. `off` → `park(...)` exactly as today.

`resumeAttempt` passes the note facts to `createRunSecretAndJob(c, { resume: true, deadlineSeconds, note })` where
`note = { end: lastEnd, try?, max? }` (`try`/`max` only on an automatic resume). It is sent on every resume while
`lastEnd` is set, so a person's Resume after an unexpected end carries it too. `lastEnd` is cleared once a resumed
session comes up (`sessionStartedFlag`), so a later park by the idle timer or a Stop sends no note.

Count reset:

- The `resumeRun` update handler (a person's Resume) sets `autoResumeStreak = 0`. The automatic resume does not go
  through the handler.
  - Agent call: a person's Resume also resets the count. Reason: it is a person stepping in (batch 1: "when user
    interact, reset the count"); the batch 2 correction narrowed what counts in the terminal, not this.
- New signal `personInput` (no arguments; `SIGNAL.personInput` in `packages/core/src/temporal-names.ts`, mirrored in
  `signals.ts`) sets `autoResumeStreak = 0`. It changes nothing else (not the idle timer, not the epoch).

A failed automatic attempt falls back through today's `restoreParked`: the run is paused with "Resume failed: …".
What happens next depends on why it failed:

- **The pod could not start** (the old Job is still being deleted, `RunJobStillPresent` after the activity's retries;
  the new pod stayed Pending past the 2-minute limit; any other start failure): the attempt has used its try. While
  tries remain, the next automatic try (same steps as flow step 2, without a new park) runs after a wait of 1, 2, 4,
  8 minutes (doubling, at most 10 minutes) on a durable workflow timer inside the parked loop. During the wait the run
  is paused, and a person's Resume (which also resets the count), Finish, Cancel and the expiry work as today. When no
  tries remain, `recordAutoResume` appends `auto_resume_gave_up` and the paused comment is posted.
- **No saved session** (exit 79) or **agent or credential missing**: no further automatic try; the paused comment is
  posted and the run waits for a person.
- Agent call: retry a pod that could not start, with a growing wait, within the same limit. Reason: after a node dies
  the old pod can hang in Terminating and the run volume (ReadWriteOnce) takes minutes to be released, longer than the
  2-minute Pending limit, so a single immediate try would usually fail in exactly the "nobody is around" case the
  human wants covered; the limit still stops it.
- Agent call: no automatic retry after "no saved session" or "agent or credential missing". Reason: waiting cannot
  fix them.

Ticket comments: when automatic resuming ends with the run waiting for a person (tries ran out, or a failure that is
not retried), the `paused` comment is posted once, as on any other pause; none for each try.

- Agent call: one comment when automatic resuming stops. Reason: the human chose no comment for a pause that resumes
  itself (batch 1, Q4), and the ticket should still hear when a person is needed.
- Not changed: the `paused` comment text says the pod "was stopped after the idle time", which is already inaccurate
  for today's `pod_lost` and `agent_crashed` parks. Out of scope here; flagged for a follow-up.

A person's **Cancel during an automatic try** (the run shows Queued or Starting with no session up yet) **cancels the
run**, unlike Cancel during a person's own Resume, which only takes the resume back. `cancelEffect` gains an input
saying whether the current resume is automatic. (Cancel during the wait between tries already cancels: the run is
`parked` with kind `needs_input`.)

- Agent call: Cancel during an automatic try cancels the run. Reason: nobody asked for that resume, so "take back my
  resume" does not apply, and making the person press Cancel twice would be a trap.

Unchanged: the resume allowance (`sessionAllowanceSeconds`, at least 1 hour), the keep time and expiry, and the
45,000-event history guard.

- Agent call: an automatic resume gets the same time allowance as a person's Resume. Reason: reuse the pause and resume
  path as the human chose; the try cap bounds the extra time.

### 3. Worker activities

- `followPodLogs` (`run.activities.impl.ts`): the result gains `podReason?: string`, the `reason` of the run pod that
  `waitForExit` already reads through `getRunPod` (`terminated.reason`, e.g. `OOMKilled`, or the pod's `status.reason`,
  e.g. `Evicted`). It is checked against `^[A-Za-z]{1,40}$` before it leaves the activity.
- New activity `recordAutoResume(ctx, input)` (in `session.activity.ts`, `withOrg`, appends one `lifecycle` run event
  and notifies like the other event writers; `parkRun` is unchanged):
  - `{ event: 'resume', try, max, end, at }` →
    `{ kind: 'auto_resume', try, max, text: 'The last session was killed (<bracket>). Resuming automatically, try <try> of <max>.' }`.
  - `{ event: 'gave_up', tries, at }` →
    `{ kind: 'auto_resume_gave_up', tries, text: 'Gave up resuming automatically after <tries> tries.' }`.
  - Agent call: the event log line uses the same bracket as the agent note, with the "try 1 of 5" wording of the
    human's example. Reason: one wording for the same fact; the human's example only showed the exit code because the
    reason word was not yet kept.
- `createRunSecretAndJob`: with `note`, builds the text with the core function below and puts it on the resume Job as
  env `RESUME_NOTE`.

### 4. The note (`packages/core`)

A pure function in `packages/core` (next to the job spec), shared by the note and the event text, using the run pod
memory limit from config (`RUN_POD_MEMORY_LIMIT`):

```text
Agent Desk: your last session was killed (<bracket>). Resumed, try <try>/<max>. Background processes and /tmp are gone.
Agent Desk: your last session was killed (<bracket>). Resumed. Background processes and /tmp are gone.   (a person's Resume)
```

| Kind | Bracket |
| --- | --- |
| U1 `killed`, reason `OOMKilled` | `OOMKilled, exit 137, limit 3Gi` |
| U1 `killed`, other reason | `Error, exit 1` (the reason word, then the exit code) |
| U1 `killed`, no usable reason | `exit 1` |
| U2 `lost` | `pod lost, no exit code` |
| U3 `signal` | `SIGTERM from outside` |
| U4 `session_gone` | `terminal session died` |
| U5 `agent_exit` | `agent CLI exited with code 1` |

The exit code is the pod's real code as the cluster reported it (never the agent's end line). The wording is the
human's (batch 2, Q3).

- Agent call: "/tmp" is kept as the human approved it. It is true but not the whole story: everything outside the
  run volume (`/workspace`, which holds the repo and the home folder) is reset, for example tools installed outside
  the home folder. The wording is the human's to widen.

`packages/core/src/kube/job-spec.ts` `buildRunJob`: on a resume, adds `{ name: 'RESUME_NOTE', value }` when a note is
given.

### 5. Runner image (`images/runner`)

- `agents/claude/commands.sh`: `AGENT_RESUME_CMD` appends `${RESUME_NOTE:+"$RESUME_NOTE"}`, so Claude Code starts the
  continued session with the note as the first message (`claude --continue "<note>"`). Expanded as one quoted value,
  like `$PROMPT` today. The entrypoint comment lists `RESUME_NOTE`.
- `packages/core/src/kube/fake-pod.mjs`: the fake pod prints the note in its pane on a resume, so the local e2e can
  see it.
- Left to the builder: confirm on the pinned Claude Code version that an interactive `claude --continue "<text>"`
  continues the saved conversation and sends the text as the next message (a short spike, like ADR 0022's). If it
  does not, stop and bring it back for review.

### 6. Terminal relay (`apps/api/src/terminal`)

- In `onInput` of a run terminal (not the setup-test target), after the bytes are written to the exec session, the
  gateway checks whether the input is typing and, if so, sends `personInput` to the run's workflow, **at most once a
  minute per run** (best effort, through the existing `signal`, never breaking the relay).
  - Agent call: at most once a minute. Reason: one signal is enough to reset the count; more would only add workflow
    history events.
- "Typing" is decided by a pure function: strip escape sequences (CSI, OSC, DCS, SS3 and bracketed-paste markers);
  input counts when any byte remains. So keys, Enter, Backspace, Ctrl-C and pasted text count; terminal replies that
  xterm.js sends by itself (cursor and colour reports, focus events) and mouse reports do not.
  - Agent call: filter out escape-sequence-only input. Reason: an open browser tab answers terminal queries and
    reconnects to each new pod by itself; counting that as a person would reset the count with nobody there and let a
    crashing run loop forever, which the human ruled out.

### 7. Web (`apps/web`)

- Agent settings (`screens/DeskAgent.tsx`, `features/desk/agent.form.ts`): the Limits section gains a number field
  **"Automatic resumes after a crash"**, help text "How many times in a row a run resumes by itself after its pod is
  killed or the agent crashes. Typing in the terminal or pressing Resume starts the count again. 0 turns it off.",
  with the server's field error shown like the other limits. As drawn (boards `DeskAgentAutoResume`,
  `DeskAgentAutoResumeChanged`, `DeskAgentAutoResumeError`): the last field of the Limits grid, after "Runs per
  ticket", a narrow number input (same style and width as "Runs per ticket") showing the stored value (5 by default,
  2 after a change), with the help text under it; an out-of-range value (12) marks the input invalid and shows
  "Automatic resumes must be between 0 and 10" under the help text; saved with the existing **Save limits** button.
  The label and help text are the approved board's.
- Run detail paused notice (`features/runs/detail.map.ts` `sessionOf`, shown by `RunTerminalArea` above the paused
  read-only Transcript): for a run paused with `pod_lost` or `agent_crashed`, when the newest `auto_resume_gave_up`
  event has no status event after it other than `paused`, the notice adds the line **"Tried to resume automatically N
  times."** ("Tried to resume automatically 1 time." for one). As drawn, it is a third muted line under the existing
  headline and the "Paused 2 min ago, …. Can be resumed for 6 days." line, beside the existing Resume and Finish
  buttons; headline and detail text stay as today (`RunStoppedPodLostGaveUp`, `RunStoppedPodLostGaveUpOnce`,
  `RunStoppedCrashedGaveUp`). A paused run without the event (automatic resume off, or not tried) looks as today
  (`RunStoppedPodLost`). The payload is parsed with Zod like the other lifecycle payloads; a malformed one shows
  nothing.
- `resumeFailure` skips `auto_resume_gave_up` events when it looks for the newest event, so a last try that could not
  start still shows today's "Resume failed: the pod could not start" bar above the paused notice, together with the
  gave-up line (`RunStoppedAutoResumeFailedGaveUp`).
- While the run waits between tries after a try that could not start, the page shows today's "Resume failed: the pod
  could not start" bar above the paused notice and no gave-up line (`RunStoppedAutoResumeWaiting`).
  - Agent call: no countdown to the next try is shown. Reason: the approved board shows none, and the next try only
    takes minutes.
- The `auto_resume` lines need no web change: lifecycle events with a `text` already show in the run side panel's
  **Lifecycle** list while the run is running (`EventLog` in `RunSidePanel`). As drawn (`RunRunningAutoResume`): the
  list reads "Pod running", "Claude Code started", then "The last session was killed (OOMKilled, exit 137, limit 3Gi).
  Resuming automatically, try 1 of 5.", then "Pod running", "Session resumed"; the live terminal shows the note as the
  first message of the continued session ("Agent Desk: your last session was killed (OOMKilled, exit 137, limit 3Gi).
  Resumed, try 1/5. Background processes and /tmp are gone.").
  - Agent call: no new place shows the line. Reason: the human chose "a line in the run's event log", which exists
    today; the gave-up line on the paused notice covers the state where the event log is not shown.
- The run goes Paused → Queued/Starting → Needs you/Running as on any Resume; no other screen changes.

### 8. Security

- Sensitive paths: the runner's resume command and the resume Job env (§4, §5), the terminal relay (§6), and the
  migration (§1). They get the `review:sensitive` label and a high-effort security review.
- The note is fixed text with three checked values (an integer exit code, a reason word matching
  `^[A-Za-z]{1,40}$`, and the operator's memory limit setting); nothing from the pod's output, the ticket or the repo.
- `personInput` carries no data, comes only from an authorized socket with a live session, and can only reset a
  counter. A person who can type into the terminal can already steer the agent, so it grants nothing new.

### 9. ADR

New ADR "Unexpected pod ends resume automatically, up to a per-agent limit", amending 0023 (a lost or crashed pod no
longer always waits for a person). Records: U1 to U5, approach A and the two rejected ones, the count and its reset
(typing or Resume), the note and its fixed wording, the retry wait for a pod that could not start, and that Cancel
during an automatic try cancels the run. Also update
`docs/runbooks/runner-pod.md` ("the run shows as paused" after an OOM kill → it resumes automatically up to the agent's
limit).

### 10. Tests

- Unit: `unexpectedEndOf` (each of U1 to U5, each expected end gives none, parity with `endOutcome`);
  `autoResumeDecision`; the note and bracket builder (each row of §4, a bad reason word dropped); the typing filter
  (keys, Enter, paste count; CPR, DA, OSC colour reply, focus, mouse do not); `buildRunJob` adds `RESUME_NOTE` only on a
  resume with a note; contracts bounds for `autoResumeMax`.
- Workflow (Temporal test env, `apps/worker/test`): a `pod_lost` park resumes at once without a person and skips the
  paused comment; the try number goes up; at the limit the run stays paused with the gave-up event and the paused
  comment; `personInput` and a person's Resume reset the count; max 0 behaves as today; a `done` park is not resumed; a
  pod that could not start uses a try and is retried after the growing wait, then gives up at the limit; "no saved
  session" is not retried and posts the paused comment; Cancel during an automatic try cancels the run, Cancel during
  a person's Resume still only takes it back; a run started before the patch replays unchanged.
- Activities and API: `recordAutoResume` writes both event kinds; the agent service reads and writes the field; the gateway
  sends `personInput` for typing, at most once a minute, and never before authorization.
- Web: `detail.map` gave-up line; agent form field and its error.
- E2E (local, fake pod): kill the fake pod process (the fake gateway then reports exit 137) → the run comes back to
  Needs you by itself, the run's events hold the `auto_resume` line "… Resuming automatically, try 1 of …" (read
  through the run log API, as the existing `lifecycleKinds` helper does) and the terminal shows the note; with
  the agent's limit at 1, a second kill leaves the run paused with "Tried to resume automatically 1 time."; typing in
  the terminal between kills lets it resume again; a person's Resume after the limit shows the note without "try".
  E2E (mock): the agent settings field, a saved change and the out-of-range error; the paused notice with and without
  the gave-up line (5 times, 1 time, agent crashed); the "Resume failed" bar with and without the gave-up line; the
  running side panel's Lifecycle list with the `auto_resume` line.

### 11. Rollout (small PRs, one concern each)

1. Contracts, migration, API and `RunContext` field (no behaviour change).
2. Runner image: `RESUME_NOTE` in the resume command, fake pod echo (after the spike).
3. Core note builder, job spec env, `followPodLogs` `podReason`, `recordAutoResume`.
4. Workflow: `auto-resume` patch, decisions, `personInput` signal; API terminal relay signal.
5. Web: agent setting field and the paused notice line, Storybook first; ADR and runbook.

## UI and Storybook

Screens and components this changes:

- Agent settings (`DeskAgent`, Limits section): new "Automatic resumes after a crash" field, last in the Limits
  grid. States: default (value 5), changed (value 2), and the field error (value 12, input marked invalid,
  "Automatic resumes must be between 0 and 10"). The page's existing loading and error states are unchanged.
- Run detail paused notice (`RunTerminalArea` / `RunDetail`): paused `pod_lost` without the gave-up line (unchanged);
  paused `pod_lost` with "Tried to resume automatically 5 times."; paused `pod_lost` with "Tried to resume
  automatically 1 time."; paused `agent_crashed` ("Paused: agent crashed (exit code 1)") with "Tried to resume
  automatically 5 times."; waiting between tries ("Resume failed: the pod could not start" bar, no gave-up line); last
  try could not start ("Resume failed: the pod could not start" bar plus "Tried to resume automatically 5 times.").
- Run side panel (`RunSidePanel`, running run): the Lifecycle list with the `auto_resume` line, and the live terminal
  showing the note as the first message of the continued session.

Prototype:
- `design/prototype/project/DeskAgentAutoResume.dc.html`
- `design/prototype/project/DeskAgentAutoResumeChanged.dc.html`
- `design/prototype/project/DeskAgentAutoResumeError.dc.html`
- `design/prototype/project/RunStoppedPodLost.dc.html`
- `design/prototype/project/RunStoppedPodLostGaveUp.dc.html`
- `design/prototype/project/RunStoppedPodLostGaveUpOnce.dc.html`
- `design/prototype/project/RunStoppedCrashedGaveUp.dc.html`
- `design/prototype/project/RunStoppedAutoResumeWaiting.dc.html`
- `design/prototype/project/RunStoppedAutoResumeFailedGaveUp.dc.html`
- `design/prototype/project/RunRunningAutoResume.dc.html`

**Blocker: Storybook first.** Before any task that implements this UI in `apps/web/src/{app,features}` or wires it to data starts, the related Storybook stories are added or updated and reviewed: every changed or new `ds/`, `components/` and `screens/` piece has a story for each state above (default, loading, empty, error, and the others the spec names), fed from `@/mocks` fixtures, matching the approved prototype boards, with each new board registered in `canvas.json`, `screens/storyIds.ts` and `scripts/parity.mjs` together. No UI implementation work begins until that is done.

## Agent calls (summary)

- Agent call: `autoResumeMax` range 0 to 10. Reason: each try adds history events and up to an hour past the time limit; 0 is "off".
- Agent call: existing agents get 5 after the migration. Reason: the human set the default to 5 with no exception.
- Agent call: the limit is read once when the run starts. Reason: same as `idleEndSeconds` and the other agent limits.
- Agent call: no automatic resume when the agent had declared `done`. Reason: the work was declared finished and the run shows succeeded.
- Agent call: no wait between the park and the first automatic try. Reason: the dead pod is gone and the note tells the agent why.
- Agent call: a person's Resume also resets the count. Reason: it is a person stepping in (batch 1, Q3).
- Agent call: a pod that could not start on an automatic try uses a try and is retried after 1, 2, 4, 8 min (at most 10). Reason: after a node dies the old pod and the volume take minutes to free.
- Agent call: no automatic retry after "no saved session" or "agent or credential missing". Reason: waiting cannot fix them.
- Agent call: one `paused` ticket comment when automatic resuming stops, none per try. Reason: the human chose no comment for a pause that resumes itself.
- Agent call: Cancel during an automatic try cancels the run. Reason: nobody asked for that resume; a second Cancel would be a trap.
- Agent call: an automatic resume gets the same time allowance as a person's Resume. Reason: reuse the resume path; the cap bounds it.
- Agent call: the event log line uses the note's bracket. Reason: one wording for the same fact.
- Agent call: "/tmp" kept in the note as approved, though everything outside `/workspace` is reset. Reason: the wording is the human's.
- Agent call: `personInput` at most once a minute per run. Reason: one signal resets the count; more only adds history.
- Agent call: escape-sequence-only terminal input does not count as typing. Reason: an open tab would otherwise reset the count with nobody there.
- Agent call: no new place shows the `auto_resume` line. Reason: the existing event log is what the human chose.
- Agent call: no countdown to the next try while the run waits between tries. Reason: the approved board shows none.

## Left to the builder

- The spike in §5 (interactive `claude --continue "<text>"` on the pinned version).
- Names of internal types and helpers, and how `park` receives the automatic-resume inputs.

## Needs approval

None. Everything uses what the repo already has: Temporal, Drizzle, Zod, the Kubernetes client, the runner image and
the fake pod.
