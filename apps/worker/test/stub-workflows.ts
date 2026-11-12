import { condition, defineQuery, defineSignal, setHandler } from '@temporalio/workflow';
import { granted } from '../src/workflows/signals';

export { ProjectGateWorkflow } from '../src/workflows/gate.workflow';

export const grantsQuery = defineQuery<number>('grants');
export const stopSignal = defineSignal<[]>('stop');

/** Test-only stand-in for RunWorkflow: counts `granted` signals. */
export async function RunStub(): Promise<void> {
  let grants = 0;
  let stop = false;
  setHandler(granted, () => {
    grants += 1;
  });
  setHandler(stopSignal, () => {
    stop = true;
  });
  setHandler(grantsQuery, () => grants);
  await condition(() => stop);
}
