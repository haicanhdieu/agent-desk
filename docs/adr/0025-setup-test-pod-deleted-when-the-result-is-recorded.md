# 0025. A setup test's pod is deleted as soon as its result is recorded

- Status: Accepted. Supersedes the part of [0019](0019-repo-setup-and-approved-store-plugins.md) decision 8 that gives the test's editor an interactive shell for `SETUP_TEST_TTL_SECONDS`.
- Date: 2026-11-18
- Source: bug #99 (terminate the test pod after workspace setup testing); [workspace setup and plugins design](../superpowers/specs/2026-11-13-workspace-setup-and-plugins-design.md) §5.3

## Context

ADR 0019 and the design spec §5.3 kept a setup test's pod alive for 15 minutes after setup finished (or until "End
test"), with an idle shell and a Terminal tab so the editor could debug a failed setup. The pod counts against the run
namespace's `ResourceQuota` (`pods` 2), so an open test could block a run pod; that run then failed after the 2 min
Pending limit with "no pod was created". The pod also held the write-scoped workspace token and the adapter's `runEnv`
for the whole wait.

## Decision

The test pod is deleted as soon as the result (passed or failed) is recorded.

- `SetupTestWorkflow` creates the Job, follows its logs until the setup result is stored, then runs `finalizeSetupTest`
  at once (non-cancellable). It deletes the Job and Secret, clears the script text and sets `ended_at`. A failed or
  cancelled test, and one that reaches no result, is finalized the same way. The daily reconcile still sweeps any
  leak.
- There is no keep-alive. `SETUP_TEST_TTL_SECONDS`, the TTL timer, the `endsAt` field of `SetupTestDto` and the
  Terminal tab, the "Open terminal" button and the "Ends in" countdown in the web app are removed. The Job's
  `activeDeadlineSeconds` and the reconcile age limit no longer include the TTL.
- The result stays stored and shown, independent of the pod: `setup_tests.status` (`passed`/`failed`), `exit_code`,
  `finished_at`, the plugin lists and the stored log events. The UI shows the last-test banner and "View log" from them.
- The `endSetupTest` signal and `POST /api/setup-tests/:id/end` stay, but only to stop a test that is still in flight
  (the user ends it, or a newer test of the same project supersedes it). They no longer release a wait.
- Decision 8 of ADR 0019 otherwise stands: setup runs with the pod's credentials. The editor no longer gets an
  interactive shell holding them.

## Alternatives considered

| Alternative                                         | Why rejected                                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Keep the 15 min shell, delete earlier on "End test" | The pod still holds a quota slot and credentials for minutes after the result is known |
| Keep the pod only after a failed setup, to debug in | Same cost for the case users hit most; the stored log already shows why setup failed   |
| Shorten the TTL                                     | Still a wait with a held slot; the result does not need the pod                        |

## Consequences

### Positive

- A test releases its quota slot and its credentials when it finishes, so it no longer competes with run pods.
- Less state: no TTL config, timer or countdown, and one fewer way to reach a pod holding the workspace token.

### Negative

- A failed setup can no longer be debugged in the test pod. The user reads the stored log, edits the script and tests again.
- The runner still starts its idle shell in `setup_test` mode after setup (it is the same entrypoint path as before); the
  worker deletes the pod right after. Dropping it from the entrypoint, and the now unused `GET /api/setup-tests/:id/terminal`
  route (it only attaches while a test is live and has a pod), are follow-ups.

## Links

- [Workspace setup and plugins design](../superpowers/specs/2026-11-13-workspace-setup-and-plugins-design.md) §5.3
- Related ADRs: [0019](0019-repo-setup-and-approved-store-plugins.md), [0010](0010-one-kubernetes-job-per-run.md)
