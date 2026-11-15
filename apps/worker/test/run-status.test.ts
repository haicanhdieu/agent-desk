import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Tx } from '@agentdesk/db';
import { setRunStatusTx, type SetRunStatusInput } from '../src/activities/run-status.activity';

// Activity input crosses the Temporal boundary as JSON, so a status the enum does not know can arrive at runtime.
const Raw = z.object({ status: z.string() });
const withStatus = (status: string): SetRunStatusInput => ({
  orgId: '44444444-4444-4444-8444-444444444444',
  runId: '55555555-5555-4555-8555-555555555555',
  ...Raw.transform((r) => ({ status: r.status as SetRunStatusInput['status'] })).parse({ status }),
  at: '2026-01-01T00:00:00.000Z',
});

describe('setRunStatusTx input validation', () => {
  // Both checks run before the transaction is touched, so an empty object stands in for it.
  const tx: Tx = Object.create(null);

  it('rejects an unknown status non-retryably, naming it', async () => {
    await expect(setRunStatusTx(tx, withStatus('bogus'))).rejects.toMatchObject({
      nonRetryable: true,
      message: 'unknown run status: bogus',
    });
  });

  it('rejects an invalid timestamp non-retryably', async () => {
    await expect(setRunStatusTx(tx, { ...withStatus('running'), at: 'not a date' })).rejects.toMatchObject({
      nonRetryable: true,
      message: 'setRunStatus: invalid timestamp',
    });
  });
});
