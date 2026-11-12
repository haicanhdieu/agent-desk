import { continueAsNew, getExternalWorkflowHandle, setHandler, condition } from '@temporalio/workflow';
import { granted, releaseSlot, requestSlot, setLimit } from './signals';

export interface GateInput {
  projectId: string;
  limit: number;
  queue?: string[];
  active?: string[];
}

/** Mirrors GATE_CONTINUE_AS_NEW_AFTER in @agentdesk/core (workflow code cannot import core). */
export const CONTINUE_AS_NEW_AFTER = 1000;

/**
 * Per-project concurrency gate: FIFO queue, at most `limit` active runs. Grants by signalling `granted` to
 * `run-{runId}`. Handlers are synchronous and only mutate state; the main loop does the granting, so ordering is
 * deterministic.
 */
export async function ProjectGateWorkflow(input: GateInput): Promise<void> {
  let limit = Math.max(0, Math.floor(input.limit));
  const queue: string[] = [...(input.queue ?? [])];
  const active: string[] = [...(input.active ?? [])];
  // runIds that need a (re)sent `granted`: newly granted, or an active run that asked again.
  const toGrant: string[] = [];
  let handled = 0;
  let dirty = queue.length > 0;

  setHandler(requestSlot, (runId) => {
    handled += 1;
    dirty = true;
    if (active.includes(runId)) {
      if (!toGrant.includes(runId)) toGrant.push(runId);
      return;
    }
    if (!queue.includes(runId)) queue.push(runId);
  });
  setHandler(releaseSlot, (runId) => {
    handled += 1;
    dirty = true;
    const a = active.indexOf(runId);
    if (a >= 0) active.splice(a, 1);
    const q = queue.indexOf(runId);
    if (q >= 0) queue.splice(q, 1);
    const g = toGrant.indexOf(runId);
    if (g >= 0) toGrant.splice(g, 1);
  });
  setHandler(setLimit, (n) => {
    handled += 1;
    dirty = true;
    if (Number.isFinite(n)) limit = Math.max(0, Math.floor(n));
  });

  for (;;) {
    await condition(() => dirty || handled >= CONTINUE_AS_NEW_AFTER);
    dirty = false;
    while (active.length < limit && queue.length > 0) {
      const next = queue.shift();
      if (next === undefined) break;
      active.push(next);
      toGrant.push(next);
    }
    while (toGrant.length > 0) {
      const runId = toGrant.shift();
      if (runId === undefined) break;
      try {
        await getExternalWorkflowHandle(`run-${runId}`).signal(granted);
      } catch {
        // The run workflow is gone (finished or never started): its slot is of no use to anyone.
        const a = active.indexOf(runId);
        if (a >= 0) {
          active.splice(a, 1);
          dirty = true;
        }
      }
    }
    if (handled >= CONTINUE_AS_NEW_AFTER && !dirty) {
      await continueAsNew<typeof ProjectGateWorkflow>({
        projectId: input.projectId,
        limit,
        queue: [...queue],
        active: [...active],
      });
    }
  }
}
