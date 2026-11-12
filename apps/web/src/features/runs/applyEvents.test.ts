import type { ProjectDto, RunDto, RunEventDto } from '@agentdesk/contracts';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { projectFixtures } from '@/mocks/dto/projects';
import { runFixtures } from '@/mocks/dto/runs';
import { projectsQueries } from '../projects/queries';
import { applyRunEvent, applyRunStatus } from './applyEvents';
import { hasPendingAction, setPendingAction } from './pending';
import { runsQueries, type CachedRun, type RunList } from './queries';

const org = 'alice';
const projectId = ids.project.invoicerApi;
const ev = (seq: number): RunEventDto => ({
  seq,
  ts: '2026-11-12T14:00:00.000Z',
  type: 'lifecycle',
  payload: {},
});
const run = (n: number): RunDto => {
  const r = runFixtures.find((x) => x.projectId === projectId && x.number === n);
  if (!r) throw new Error(`run ${n} missing`);
  return structuredClone(r);
};
const project = (): ProjectDto => {
  const p = projectFixtures.find((x) => x.id === projectId);
  if (!p) throw new Error('project missing');
  return {
    ...structuredClone(p),
    counts: { needsYou: 1, running: 1, queued: 1 },
  };
};
const listOf = (...runs: CachedRun[]): RunList => ({
  items: runs,
  truncated: false,
});

function seeded() {
  const qc = new QueryClient();
  qc.setQueryData(runsQueries.detail(org, projectId, 61).queryKey, run(61));
  qc.setQueryData(runsQueries.list(org, projectId, 'all').queryKey, listOf(run(61), run(62), run(63)));
  qc.setQueryData(runsQueries.list(org, projectId, 'active').queryKey, listOf(run(61), run(62)));
  qc.setQueryData(runsQueries.list(org, projectId, 'needs_you').queryKey, listOf(run(62)));
  qc.setQueryData(projectsQueries.detail(org, projectId).queryKey, project());
  return qc;
}
const status = (n: number, s: RunDto['status'], seq = 20) => ({
  runId: ids.run(1, n),
  number: n,
  status: s,
  seq,
  exitCode: s === 'succeeded' ? 0 : null,
  failureReason: null,
});

describe('applyRunEvent', () => {
  it('appends in seq order and inserts a late one in place', () => {
    expect(applyRunEvent([ev(1), ev(2)], ev(3)).map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(applyRunEvent([ev(1), ev(3)], ev(2)).map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(applyRunEvent([], ev(5)).map((e) => e.seq)).toEqual([5]);
  });

  it('ignores a seq already in the list (Review Focus 1: a replayed backlog)', () => {
    let list: RunEventDto[] = [];
    for (const seq of [3, 4, 3, 4, 5]) list = applyRunEvent(list, ev(seq));
    expect(list.map((e) => e.seq)).toEqual([3, 4, 5]);
    const same = [ev(1), ev(2)];
    expect(applyRunEvent(same, ev(1))).toBe(same);
  });
});

describe('applyRunStatus', () => {
  it('patches the detail and every cached list row; a row that no longer fits its filter leaves it', () => {
    const qc = seeded();
    applyRunStatus(qc, org, projectId, status(61, 'idle'));
    expect(qc.getQueryData(runsQueries.detail(org, projectId, 61).queryKey)?.status).toBe('idle');
    expect(qc.getQueryData(runsQueries.detail(org, projectId, 61).queryKey)?.idleSince).not.toBeNull();
    const all = qc.getQueryData(runsQueries.list(org, projectId, 'all').queryKey);
    expect(all?.items.find((r) => r.number === 61)?.status).toBe('idle');
    expect(qc.getQueryData(runsQueries.list(org, projectId, 'active').queryKey)?.items.map((r) => r.status)).toEqual([
      'idle',
      'idle',
    ]);
    // needs_you now holds 61 on the server, but the cached list lacks the row: it is invalidated.
    expect(qc.getQueryState(runsQueries.list(org, projectId, 'needs_you').queryKey)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(runsQueries.list(org, projectId, 'all').queryKey)?.isInvalidated).toBe(false);

    applyRunStatus(qc, org, projectId, status(62, 'running'));
    expect(qc.getQueryData(runsQueries.list(org, projectId, 'needs_you').queryKey)?.items).toEqual([]);
  });

  it('moves the project counts once, however many streams deliver the change', () => {
    const qc = seeded();
    applyRunStatus(qc, org, projectId, status(61, 'idle'));
    applyRunStatus(qc, org, projectId, {
      runId: ids.run(1, 61),
      number: 61,
      status: 'idle',
      seq: 20,
    });
    expect(qc.getQueryData(projectsQueries.detail(org, projectId).queryKey)?.counts).toEqual({
      needsYou: 2,
      running: 0,
      queued: 1,
    });
    expect(qc.getQueryState(projectsQueries.detail(org, projectId).queryKey)?.isInvalidated).toBe(false);
  });

  it('a run nowhere in the cache invalidates the project counts and the lists instead', () => {
    const qc = seeded();
    applyRunStatus(qc, org, projectId, {
      runId: ids.run(1, 99),
      number: 99,
      status: 'queued',
      seq: 2,
    });
    expect(qc.getQueryState(projectsQueries.detail(org, projectId).queryKey)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(runsQueries.list(org, projectId, 'all').queryKey)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(runsQueries.list(org, projectId, 'active').queryKey)?.isInvalidated).toBe(false);
  });

  it('drops a lagging change: an older seq, or one that would take a final run back to active', () => {
    const qc = seeded();
    const counts = () => qc.getQueryData(projectsQueries.detail(org, projectId).queryKey)?.counts;
    // Run stream: idle (seq 20), then succeeded (seq 22). The project stream lags with the same changes.
    applyRunStatus(qc, org, projectId, status(61, 'idle', 20));
    applyRunStatus(qc, org, projectId, status(61, 'succeeded', 22));
    expect(counts()).toEqual({ needsYou: 1, running: 0, queued: 1 });
    applyRunStatus(qc, org, projectId, { runId: ids.run(1, 61), number: 61, status: 'idle', seq: 20 });
    applyRunStatus(qc, org, projectId, { runId: ids.run(1, 61), number: 61, status: 'succeeded', seq: 22 });
    const detail = qc.getQueryData(runsQueries.detail(org, projectId, 61).queryKey);
    expect(detail?.status).toBe('succeeded');
    expect(detail?.finishedAt).not.toBeNull();
    expect(counts()).toEqual({ needsYou: 1, running: 0, queued: 1 });
    expect(
      qc.getQueryData(runsQueries.list(org, projectId, 'all').queryKey)?.items.find((r) => r.number === 61)?.status,
    ).toBe('succeeded');

    // A final run loaded over REST (no seq seen yet) is not taken back to active either.
    const fresh = seeded();
    fresh.setQueryData(runsQueries.detail(org, projectId, 55).queryKey, run(55));
    applyRunStatus(fresh, org, projectId, status(55, 'running', 3));
    expect(fresh.getQueryData(runsQueries.detail(org, projectId, 55).queryKey)?.status).toBe('succeeded');
  });

  it('an uncached run also invalidates the ticket lists its status fits', () => {
    const qc = seeded();
    const ticketList = runsQueries.list(org, projectId, 'all', 'harbor-labs/invoicer-api#12').queryKey;
    qc.setQueryData(ticketList, listOf());
    applyRunStatus(qc, org, projectId, { runId: ids.run(1, 99), number: 99, status: 'queued', seq: 2 });
    expect(qc.getQueryState(ticketList)?.isInvalidated).toBe(true);
  });

  it('keeps a pending note on a non-final status and clears it, everywhere, on a final one', () => {
    const qc = seeded();
    const strip = vi.fn(() => {
      qc.setQueryData(runsQueries.detail(org, projectId, 61).queryKey, (r) => r && { ...r, statusNote: undefined });
    });
    setPendingAction(qc, ids.run(1, 61), 'finish', strip);
    qc.setQueryData(runsQueries.detail(org, projectId, 61).queryKey, (r) => r && { ...r, statusNote: 'Finishing…' });

    applyRunStatus(qc, org, projectId, status(61, 'idle'));
    expect(qc.getQueryData(runsQueries.detail(org, projectId, 61).queryKey)?.statusNote).toBe('Finishing…');
    expect(hasPendingAction(qc, ids.run(1, 61))).toBe(true);

    applyRunStatus(qc, org, projectId, status(61, 'succeeded', 21));
    const detail = qc.getQueryData(runsQueries.detail(org, projectId, 61).queryKey);
    expect(detail?.status).toBe('succeeded');
    expect(detail?.exitCode).toBe(0);
    expect(detail?.statusNote).toBeUndefined();
    expect(strip).toHaveBeenCalledTimes(1);
    expect(hasPendingAction(qc, ids.run(1, 61))).toBe(false);
  });
});
