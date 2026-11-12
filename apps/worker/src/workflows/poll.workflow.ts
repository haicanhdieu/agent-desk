import { proxyActivities, sleep } from '@temporalio/workflow';
import type { Activities } from '../activities/types';
import type { PollOutcome, PollInput } from '../activities/poll.activity';

const act = proxyActivities<Activities>({
  startToCloseTimeout: '2 minutes',
  retry: { initialInterval: '2s', maximumInterval: '30s', maximumAttempts: 3 },
});

/**
 * Started by the project's poll Schedule on every tick. Rate limit or revoked credentials pause the Schedule (an
 * activity does it: schedule handles need a Temporal client). A rate limit also starts `resumePollWorkflow`.
 */
export async function PollOnceWorkflow(input: PollInput): Promise<PollOutcome> {
  const outcome = await act.pollOnce(input);
  if (typeof outcome === 'object' && 'pause' in outcome) {
    await act.pausePollSchedule({
      ...input,
      note: outcome.pause === 'rate_limited' ? 'rate limited' : 'token revoked',
      ...(outcome.pause === 'rate_limited' ? { resumeAt: outcome.until } : {}),
    });
  }
  return outcome;
}

/**
 * One-shot timer: sleeps until the rate limit lifts (`until`, ISO), then unpauses the project's Schedule. If a later
 * rate limit moved the reset time while this timer slept, it sleeps again.
 */
export async function resumePollWorkflow(input: PollInput & { until: string }): Promise<void> {
  let until = input.until;
  for (;;) {
    await sleep(Math.max(0, Date.parse(until) - Date.now()));
    const res = await act.resumePollSchedule({ orgId: input.orgId, projectId: input.projectId });
    if (!('waitUntil' in res)) return;
    until = res.waitUntil;
  }
}
