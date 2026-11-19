import { describe, expect, it } from 'vitest';
import type { GateState } from '../src/workflows/signals';
import { requestSlot, type GateSignaller } from '../src/activities/slot.activity';

const unsettled = (queue: string[]): GateState => ({ limit: 1, queue, active: ['other'], settled: false });
const settled = (state: Partial<GateState>): GateState => ({
  limit: 1,
  queue: [],
  active: [],
  ...state,
  settled: true,
});

/** A gate client whose `gateState` query answers with `states` in order (the last one repeats). */
function fakeGate(states: (GateState | Error)[]) {
  const rec = { signals: 0, queries: 0 };
  let i = 0;
  const client: GateSignaller = {
    signalWithStart: async () => {
      rec.signals += 1;
      return undefined as never;
    },
    getHandle: () =>
      ({
        query: async () => {
          rec.queries += 1;
          const next = states[Math.min(i, states.length - 1)];
          i += 1;
          if (next instanceof Error) throw next;
          return next;
        },
      }) as never,
  };
  return { client, rec };
}

const input = { projectId: 'p1', runId: 'r1', limit: 1 };

describe('requestSlot', () => {
  it('reports queued when the gate has settled with the run still waiting in its queue', async () => {
    const { client, rec } = fakeGate([settled({ active: ['other'], queue: ['r1'] })]);
    await expect(requestSlot(client, input)).resolves.toEqual({ queued: true });
    expect(rec.signals).toBe(1);
  });

  it('reports not queued when the gate granted the run a slot', async () => {
    const { client } = fakeGate([settled({ active: ['r1'] })]);
    await expect(requestSlot(client, input)).resolves.toEqual({ queued: false });
  });

  it('waits for the gate to process the signal before reading the queue', async () => {
    const { client, rec } = fakeGate([unsettled([]), unsettled([]), settled({ active: ['r1'] })]);
    await expect(requestSlot(client, input)).resolves.toEqual({ queued: false });
    expect(rec.queries).toBe(3);
  });

  it('reports not queued, and does not fail, when the gate cannot be queried', async () => {
    const { client } = fakeGate([new Error('query failed')]);
    await expect(requestSlot(client, input)).resolves.toEqual({ queued: false });
  });

  it('logs a warning with the run and the error kind, never the error text, when the gate cannot be queried', async () => {
    const { client } = fakeGate([new TypeError('secret-looking detail')]);
    const warnings: { msg: string; meta?: Record<string, unknown> }[] = [];
    const log = { warn: (msg: string, meta?: Record<string, unknown>) => void warnings.push({ msg, meta }) };
    await expect(requestSlot(client, input, log)).resolves.toEqual({ queued: false });
    expect(warnings).toEqual([
      { msg: 'requestSlot could not read the project gate', meta: { runId: 'r1', err: 'TypeError' } },
    ]);
  });

  it('logs nothing when the gate answers', async () => {
    const { client } = fakeGate([settled({ active: ['r1'] })]);
    const warnings: string[] = [];
    await requestSlot(client, input, { warn: (msg) => void warnings.push(msg) });
    expect(warnings).toEqual([]);
  });
});
