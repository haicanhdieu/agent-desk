import { afterEach, describe, expect, it, vi } from 'vitest';
import { ids } from '../dto/ids';
import { mockDb } from './db';
import { subscribeProject, subscribeRun, type RunStreamMessage } from './live';
import { scenarios } from './scenarios';
import { DEFAULT_RUN_SCRIPT } from './stream-handlers';

const run63 = () => {
  const r = mockDb.state.runs.find((x) => x.id === ids.run(1, 63));
  if (!r) throw new Error('run 63 missing');
  return r;
};

afterEach(() => {
  vi.useRealTimers();
});

describe('scripted runs', () => {
  it('the default script waits for a stream, then goes starting → running → idle with lifecycle lines', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    scenarios.runScript(DEFAULT_RUN_SCRIPT.runId, DEFAULT_RUN_SCRIPT.steps, { start: 'onStream' });
    vi.advanceTimersByTime(60_000);
    expect(run63().status).toBe('queued');

    const run: RunStreamMessage[] = [];
    const project: string[] = [];
    subscribeRun(run63().id, (m) => run.push(m));
    subscribeProject(run63().projectId, (m) => project.push(m.status));
    vi.advanceTimersByTime(60_000);

    expect(run63().status).toBe('idle');
    expect(run63().startedAt).not.toBeNull();
    expect(run63().idleSince).not.toBeNull();
    expect(project).toEqual(['starting', 'running', 'idle']);
    const statuses = run.flatMap((m) => (m.event === 'status' ? [m.data.status] : []));
    expect(statuses).toEqual(['starting', 'running', 'idle']);
    // Every message carries its seq as id; seqs follow the stored log.
    const stored = mockDb.state.runEvents[run63().id]?.map((e) => e.seq) ?? [];
    const sent = run.flatMap((m) => (m.event === 'event' ? [m.data.seq] : []));
    expect(sent).toEqual(stored.slice(-sent.length));
    for (const m of run) expect(m.id).toBe(String(m.data.seq));
  });

  it('a run cancelled meanwhile stops the script; a reset drops it', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    scenarios.runScript(ids.run(1, 63), [{ afterMs: 1_000, status: 'starting' }]);
    run63().status = 'cancelled';
    vi.advanceTimersByTime(2_000);
    expect(run63().status).toBe('cancelled');

    scenarios.runScript(ids.run(1, 61), [{ afterMs: 1_000, status: 'idle' }]);
    mockDb.reset();
    vi.advanceTimersByTime(2_000);
    expect(mockDb.state.runs.find((r) => r.number === 61 && r.projectId === ids.project.invoicerApi)?.status).toBe(
      'running',
    );
  });
});
