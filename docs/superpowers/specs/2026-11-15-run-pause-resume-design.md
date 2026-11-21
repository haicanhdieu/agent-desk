# Pause idle runs and resume them later (design)

Status: approved, not yet implemented. Date: 2026-11-15. Needs a new ADR (0022) that amends [ADR 0010](../../adr/0010-one-kubernetes-job-per-run.md) (one Job per run) and [ADR 0020](../../adr/0020-agent-status-protocol.md) (the "`done` and `idle` both end as `succeeded` after 10 minutes" bullet).

## Problem

A run that waits for a person (`idle`, "Needs you") or that the agent declared finished (`done`) is ended after 10 minutes with nobody attached. Freeing the slot is right: queued runs need it. What is wrong is the result:

- The run is written as `succeeded` in both cases, so a run with an unanswered question looks finished. Nothing records that the idle timer ended it.
- The pod's workspace is an `emptyDir` and the Job is deleted. The conversation and every unpushed file are gone, so the person cannot come back to the session.

## Goals

- After the idle time, the pod is stopped and the slot is freed, as today.
- The run's status says what really happened. A run that was waiting for a person is **Paused**, not Succeeded.
- The whole working state is kept: the repo folder with uncommitted changes and the agent's home folder with the conversation. A person can resume and continue from where the run stopped.
- A run the agent declared done is shown as **Succeeded** (it is done), and a person can re-open its session for a limited time to see what happened or follow up.
- Kept sessions expire so the disk does not fill: 7 days for a paused run, 1 day for a done run by default. Both times are settings in the desk config.

## Non-goals

- No freeze of running processes or memory. A resumed pod has the files and the conversation; processes that were running are not restored. (A run whose agent waits on its own background work is `running`, so the idle timer never stops it.)
- No session kept for runs that end as `failed`, `cancelled` or `timed_out`, or that a person ends with Finish.
- No change to the idle time itself (10 minutes, platform config), the slot limit, or the token refresh.
- No archive or object store. No multi-node storage (see Limits).
- Setup-test Jobs do not change.

## Anti-goals

- A run must never be shown as Succeeded when the agent was waiting for an answer.
- A kept session must never outlive its expiry, and a volume must never be shared between two runs.
- Resume must not let a run skip the queue.

## Approaches

Where to keep a stopped run's files:

| Approach | Trade-off | Verdict |
| --- | --- | --- |
| **1. Keep the disk, drop the pod.** Each run has its own volume; pausing deletes only the pod; resume starts a new pod on the same volume. | Pause and resume in seconds, exact files, only one new part. Uses full uncompressed size per kept run; a volume is tied to one node. | **Chosen** (by the user). Fewest new parts, fits the single-node PoC. |
| 2. Pack and store. Compress the folders into an archive in a file store, delete everything, unpack on resume. | Much less disk, works across nodes. Needs a file store plus upload and download steps; minutes to resume a large repo. | Not now. Can be added later behind the same statuses if disk gets tight. |
| 3. Freeze the live pod (container checkpoint). | The only way to keep running processes. Kubernetes has no built-in restore, and it is unlikely to work on k3s-in-Podman. | Rejected. |

## Decided with the user

- The whole pod file state is kept (repo folder and agent home), not only the conversation.
- Both `idle` and `done` runs keep their session when the idle timer stops them.
- A stopped `done` run is shown as Succeeded, never as Paused. Its session can be re-opened for 1 day by default.
- A stopped "Needs you" run is Paused. Its session is kept for 7 days by default.
- The keep times are settings a person changes in the desk config.

Everything below this line is the designer's call unless it repeats a point above.

## Design

### 1. Statuses (contracts)

Two new values in `RunStatus`:

| Status | Label | Meaning | Pod | Slot | Group |
| --- | --- | --- | --- | --- | --- |
| `paused` | Paused | Was waiting for a person; stopped after the idle time; can be resumed | no | no | not active, not final |
| `expired` | Expired | Was paused and nobody resumed it before the keep time ran out; session deleted | no | no | final |

- `ACTIVE_RUN_STATUSES` stays as it is (statuses with a pod). `FINAL_RUN_STATUSES` gains `expired`.
- `succeeded` keeps its meaning. A stopped `done` run becomes `succeeded` with a kept session (see fields below). When that session expires the run simply stays `succeeded`.
- Because of re-open, `succeeded` with a kept session is the one final status that can go back to `queued`. Every place that treats final as "never changes" must check for a kept session first (API guards, workflow `isFinal`, reconcile).
- New fields on `RunDto`: `pausedAt` (when the pod was last stopped by the idle timer, else null) and `sessionExpiresAt` (set while a session is kept, for both `paused` and `succeeded`; null otherwise). "Has a kept session" means `sessionExpiresAt` is set and in the future.
- `agentNote` is kept while a session is kept, so the paused run still shows the agent's question and the succeeded run still shows its summary.
- Run list filters: `needs_you` includes `paused`; `ended` includes `expired`; `active` does not include `paused`.

Transitions:

```
idle  --idle time, nobody attached-->  paused     --Resume-->   queued -> starting -> idle
                                       paused     --Finish-->   succeeded (session deleted)
                                       paused     --Cancel-->   cancelled (session deleted)
                                       paused     --keep time--> expired  (session deleted)
done  --idle time, nobody attached-->  succeeded + kept session
                                       succeeded  --Re-open-->  queued -> starting -> done
                                       succeeded  --keep time--> succeeded (session deleted)
```

A resumed run comes back in the state it was stopped in (`idle` or `done`), because the agent is at the same turn boundary. The normal rules then apply again, including the idle timer: a person who resumes and never attaches gets the run stopped again after the idle time, with a fresh keep time.

### 2. Settings (contracts, db, web)

Two new fields on the agent config (same place as the run time limit, Desk → Agent):

| Field | Default | Range | Meaning |
| --- | --- | --- | --- |
| `pausedKeepSeconds` | 604800 (7 d) | 3600 to 2592000 (1 h to 30 d) | How long a paused run can be resumed |
| `doneKeepSeconds` | 86400 (1 d) | 0 to 604800 (0 = do not keep) | How long a succeeded run's session can be re-opened |

- Constants live in `packages/contracts` next to the timeout ones; a new migration adds the columns with defaults and check constraints. Existing agents get the defaults.
- The value is read when the run is stopped and fixes that session's expiry. Changing the setting later affects later stops only.
- The UI uses the existing `DurationInput`.
- The idle time (10 minutes) stays a platform value; it is minutes, not days, and was not asked for.

### 3. Storage: one volume per run (core, infra)

- Each run gets a `PersistentVolumeClaim` named like its Job and Secret (`run-{runId}`), with the run labels, created together with the Secret and Job on first start. It replaces the `emptyDir` workspace.
- The volume is mounted once, at `/workspace`. The repo stays in `/workspace/repo` and the runner's home folder moves onto the same volume (`HOME=/workspace/home`, set by the Job). One mount and no sub-paths on purpose: a `local-path` volume's root is writable by the runner user, but sub-path folders are created by the kubelet as root and `fsGroup` is not applied to this volume type. Keeping the whole home folder is agent-neutral: any agent's session files, plugins and caches are kept without the worker knowing their paths.
- The image's baked home content (our settings) moves to a skeleton folder in the image and is copied into the home folder at start without overwriting existing files. Managed settings stay in `/etc` in the image and are never on the volume.
- Size request is the existing `RUN_POD_WORKSPACE_SIZE_LIMIT` (4Gi).
- Storage class: the QA cluster's default class is `local-path-retain` (infra design §5.4), which keeps the data after a claim is deleted. Run volumes must not use it, or expired sessions would stay on disk. The platform layer adds a class `agentdesk-run-volumes` (provisioner `rancher.io/local-path`, `reclaimPolicy: Delete`, `volumeBindingMode: WaitForFirstConsumer`), and new platform config `RUN_VOLUME_STORAGE_CLASS` names it. Blank means the cluster default, for local dev only. Deleting the claim is then the whole cleanup: one call, nothing cluster-wide.
- RBAC: the worker's Role in `agentdesk-runs` gains `persistentvolumeclaims` (create, get, list, delete). Still nothing cluster-wide.
- Infra work item: the infra design (§5.4, §6.1, §6.6) is updated in the same PR as this change, and the storage class and Role must be live before the worker that creates volumes. The `deploy/` tree is not in the repo yet; whoever lands it applies these two points.
- `KubeGateway` gains the matching volume methods (ensure, delete, list), with fake-gateway support for tests.
- No credential is stored on the volume by Agent Desk: the workspace token is a mounted Secret file and the agent credential is an env var, both created fresh for every pod.

### 4. Stopping a run (worker)

When the idle timer fires (same condition as today: at a turn boundary, nobody attached, no session end under way):

1. End the session as today; the runner prints the final scrollback and the pod exits.
2. Delete the Job and the Secret. Keep the volume.
3. Release the slot.
4. Write the status: `paused` for a run that was `idle`; `succeeded` for a run that was `done`. Set `pausedAt` and `sessionExpiresAt` (now + the keep setting). With `doneKeepSeconds = 0` the volume is deleted and no session is kept.
5. Post one ticket comment: for `paused`, that the run is paused waiting for an answer, with the link (first pause of a run only); for `succeeded`, the normal finish comment (first time only; a re-opened run does not post it again).

The run workflow stays open while a session is kept. It is the single owner of the session: it waits for resume, finish, cancel, or a durable expiry timer. On expiry it deletes the volume and writes `expired` (paused) or just clears `sessionExpiresAt` (succeeded), then closes. New workflow code is guarded with `patched()` so runs started before the deploy replay unchanged; those older runs keep today's behaviour.

_Amended 2026-11-20 ([ADR 0030](../../adr/0030-finish-after-reopen-keeps-the-session.md)): a Finish on a session re-opened from a kept succeeded session re-parks the run and keeps the volume until the original deadline._ _Amended 2026-11-21 ([ADR 0032](../../adr/0032-reopened-session-keeps-the-result.md)): Close session on a reopened session re-parks it with a fresh keep time; a cancel is ignored; a Finish on a fresh live Done run keeps the volume for the normal keep time._ A person pressing Finish, a cancel, a failure, a hard timeout, or the agent exiting on its own all end the run as today and delete the volume in `finalize`.

### 5. Resuming (contracts, api, worker, runner)

- New route `POST /api/runs/:runId/resume`, with the same authorization as Finish. Allowed when the run is `paused`, or `succeeded` with a kept session. It is a workflow update, so the API returns the workflow's real answer (same pattern as `finishRun`). Anything else answers with a conflict.
- The workflow then: writes `queued`, requests a slot through the project gate like a new run, waits for the grant, writes `starting`, creates a fresh Secret (new workspace token, agent credential) and a new Job on the same volume, and follows its logs. The token refresh loop runs again.
- The Job carries `RUN_MODE=resume`. In that mode the runner skips clone, plugins and the setup script, checks that the volume holds a started session (a marker file written on first start; missing means fail with a plain reason), and starts the agent adapter's resume command instead of its start command. For Claude Code that is `claude --continue` in the repo folder. The prompt is not passed again.
- Agent adapters in the runner image get two commands, start and resume. The worker, db, contracts and UI stay agent-neutral.
- When the session is up, the workflow writes the state the run was stopped in (`idle` or `done`).
- The resumed pod uses the current runner image.
- Time limit: the run's limit counts only time with a pod. The workflow carries the used time across pauses and gives the new pod's hard timer and Job deadline the remainder. A paused run cannot time out.
- Time limit value: the limit is the one the run started with, not the agent's current setting. A resumed pod always gets at least 1 hour (`RESUME_MIN_SECONDS`), even when less of the limit is left, so a resume never starts a pod that is killed minutes later.
- Terminal attach to a run without a pod is refused as today; the UI offers Resume instead.

**When a resume goes wrong.** The rule is: a kept session is only given up once the resumed session is really up.

- If the resume fails before the runner reports the session started (no slot because of a cancel of the resume, pod never schedules, marker missing, Secret or Job cannot be created), the workflow deletes the Job and Secret, releases the slot and puts the run back exactly as it was: `paused`, or `succeeded` with its session, with the same `sessionExpiresAt`. The failure reason is stored as a run event and shown on the run page ("Resume failed: …"). The person can try again.
- _Amended 2026-11-21 ([ADR 0032](../../adr/0032-reopened-session-keeps-the-result.md)): once a run succeeds its result is fixed._ A re-opened succeeded run stays `succeeded` with `runs.reopened_at` set (the page shows "Succeeded · Session open"). Cancel, Stop and Finish are refused (409); the one action is Close session. Close session, the idle timeout, a pod crash and the time limit return the run to `succeeded` with the disk kept for a fresh keep time and no ticket comment, never `paused`, `expired`, `cancelled` or `timed_out`. The earlier rule below (a re-opened run ends by the normal rules) now applies only to runs resumed from `paused`.
- Once the session is up, it is a live run again and ends by the normal rules. A run resumed from `paused` can therefore end as `failed`, `cancelled` or `timed_out` if that is what then happens; the run page history shows the earlier pause and the resume. No second finish comment is posted for a run that ends `succeeded` again; a different end status posts its normal comment.
- Cancel pressed while a resume is queued or starting cancels the resume only (back to the kept state). Cancel on a `paused` run ends it as `cancelled`.

**Deleting things while a session is kept.**

- Project delete is blocked while a run is `paused`, like the other statuses that wait on a person or a pod. Kept sessions of `succeeded` runs do not block it: deleting the project tells those workflows to drop their session and close, and reconcile removes any volume left behind.
- The agent or its credential may be deleted or changed. Resume uses the project's current agent and credential; if there is none, resume answers with a conflict and a plain message, and the session stays kept until it expires.

### 6. Cleanup (worker)

`reconcile` learns about volumes, with the same per-org lookup as Jobs and Secrets. It deletes a volume when its run is missing, is final with no kept session, or is past `sessionExpiresAt` plus a grace period. A `paused` run whose workflow is closed (terminated) is written as `expired` and its volume deleted. A run with a kept session legitimately has a volume and no Job or Secret.

Disk bound: every kept session expires, and the keep settings have hard upper limits. In addition a platform cap `RUN_KEPT_DONE_SESSIONS_PER_PROJECT` (default 10) drops the oldest kept sessions of succeeded runs first when a new one is kept. Paused runs are never dropped early.

### 7. UI (web)

Paused run (run page header and "Needs you" list):

```
⏸ Paused                          can be resumed for 6 days
  "Which database should the migration target?"
  Paused 14:32 after 10 min with nobody attached
  [ Resume ]  [ Finish ]
```

Succeeded run with a kept session:

```
✓ Succeeded
  "Opened PR #51 with the fix and tests."
  Session kept until tomorrow 14:32      [ Re-open session ]
```

- After Resume or Re-open the same run page shows Queued, Starting, then the terminal with the conversation.
- The final scrollback captured when the pod stopped stays visible on the run page while there is no pod.
- Expired run: an "Expired" badge with "Nobody resumed this run within 7 days. The saved session was deleted."
- New status tokens, icons and stories for `paused` and `expired`; loading, empty and error states for the new actions.

## Limits and risks

- **`--continue` is confirmed.** Spike on Claude Code 2.1.323 (2026-11-15): in a new container on the same volume and `HOME`, `claude --continue` brought the conversation back, a typed answer started a new turn, and the `agentdesk: state` hook lines fired for it.
- **Open question menus are not restored.** The person sees the agent's last question as text and types the answer.
- **Volume size is not enforced on `local-path`.** The `emptyDir` size limit evicted a pod that wrote too much; a `local-path` volume does not. One run can use more than 4Gi. Accepted for the PoC and written down in the ADR; a storage class with quotas fixes it later.
- **One node.** A `local-path` volume lives on one node. More nodes need shared storage or approach 2.
- **Image changes between pause and resume.** A resumed pod uses the current image; a newer agent CLI may not read an older session. Not guarded.
- **Workflow history.** Each pause and resume adds events to the same workflow. The existing 45,000-event guard still applies.

## Security

- Sensitive paths touched: run Job and runner, secrets and tokens, migrations. The PRs get `review:sensitive` and a high-effort security review.
- The volume holds repo content and the conversation, which are untrusted text and may hold whatever the agent or setup script wrote. It is per run, labelled with org and project, mounted only by that run's pod, and deleted on expiry or when the run ends.
- Resume is authorized like Finish and goes through the queue.
- The setup script does not run again on resume, and no untrusted text reaches a command line: resume mode is one fixed env value.

## Testing

- Contracts: new statuses, groups, fields and setting bounds.
- Worker: workflow tests for stop (both kinds), resume, re-open, finish and cancel while paused, expiry of both kinds, time-limit carry-over, slot release and re-request; a new replay fixture, and the old fixtures still replay.
- Core: Job spec with the volume and sub-paths; fake gateway volume methods; reconcile volume rules.
- Runner: `RUN_MODE=resume` skips clone, plugins and setup; missing marker fails; home skeleton copied once.
- API: resume authorization and conflict cases.
- Web: status badge, run page states and stories; e2e for pause then resume on the local stack.
- Each fix or behaviour starts with a failing test; no network in tests.

## Left to the builder

- How the workflow is structured internally (one loop with a parked phase, or helper functions), and the exact `patched()` ids.
- Names of the new activities and gateway methods, the marker file path, the skeleton folder path.
- How the work is split into PRs of about 400 lines (suggested order: contracts and db, runner and Job spec, workflow and reconcile, API route, web).
- Wording of the ticket comments and UI copy beyond the sketches above.
