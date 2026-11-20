import type { ProjectDto, RunDto, RunEventDto, RunStatsDto } from '@agentdesk/contracts';
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
    // As the API counts: running includes the idle run 62.
    counts: { needsYou: 1, running: 2, queued: 1 },
  };
};
const listOf = (...runs: RunDto[]): RunList => ({
  items: runs.map((r): CachedRun => ({ ...r, ticketRunCount: 1 })),
  truncated: false,
});
const SINCE = '2026-11-12T00:00:00.000Z';
const statsData: RunStatsDto = {
  counts: { needs_you: 1, active: 2, queued: 1, ended: 8, all: 12, ignored: 0 },
  today: { total: 3, failed: 0 },
  idleRun: null,
  nextQueuedNumber: 63,
};

function seeded() {
  const qc = new QueryClient();
  qc.setQueryData(runsQueries.detail(org, projectId, 61).queryKey, run(61));
  qc.setQueryData(runsQueries.list(org, projectId, 'all').queryKey, listOf(run(61), run(62), run(63)));
  qc.setQueryData(runsQueries.list(org, projectId, 'active').queryKey, listOf(run(61), run(62)));
  qc.setQueryData(runsQueries.list(org, projectId, 'needs_you').queryKey, listOf(run(62)));
  qc.setQueryData(projectsQueries.detail(org, projectId).queryKey, project());
  qc.setQueryData(runsQueries.stats(org, projectId, SINCE).queryKey, statsData);
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

describe('applyRunStatus, agent state', () => {
  it('copies waitingOn and agentNote from the run stream event into the cached run', () => {
    const qc = seeded();
    applyRunStatus(qc, org, projectId, {
      ...status(61, 'idle'),
      waitingOn: null,
      agentNote: 'Which database?',
    });
    expect(qc.getQueryData(runsQueries.detail(org, projectId, 61).queryKey)?.agentNote).toBe('Which database?');
    applyRunStatus(qc, org, projectId, {
      ...status(61, 'running', 21),
      waitingOn: 'background',
      agentNote: null,
    });
    const detail = qc.getQueryData(runsQueries.detail(org, projectId, 61).queryKey);
    expect(detail?.waitingOn).toBe('background');
    expect(detail?.agentNote).toBeNull();
  });

  it('a project stream event (no agent state) leaves them alone', () => {
    const qc = seeded();
    applyRunStatus(qc, org, projectId, { ...status(61, 'running'), waitingOn: 'background', agentNote: null });
    applyRunStatus(qc, org, projectId, { runId: ids.run(1, 61), number: 61, status: 'running', seq: 22 });
    expect(qc.getQueryData(runsQueries.detail(org, projectId, 61).queryKey)?.waitingOn).toBe('background');
  });

  it('done is not a needs-you run but still holds a slot', () => {
    const qc = seeded();
    applyRunStatus(qc, org, projectId, { ...status(61, 'done'), waitingOn: null, agentNote: null });
    const counts = qc.getQueryData(projectsQueries.detail(org, projectId).queryKey)?.counts;
    expect(counts?.needsYou).toBe(1);
    expect(counts?.running).toBe(2);
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

  it('a status change invalidates the cached run stats, in any case of the change', () => {
    const qc = seeded();
    const stats = runsQueries.stats(org, projectId, SINCE).queryKey;
    expect(qc.getQueryState(stats)?.isInvalidated).toBe(false);
    applyRunStatus(qc, org, projectId, status(61, 'idle'));
    expect(qc.getQueryState(stats)?.isInvalidated).toBe(true);
    // The stats stay in the cache (so the page keeps showing numbers while they refetch).
    expect(qc.getQueryData(stats)).toEqual(statsData);
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
      running: 2,
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
    expect(counts()).toEqual({ needsYou: 1, running: 1, queued: 1 });
    applyRunStatus(qc, org, projectId, { runId: ids.run(1, 61), number: 61, status: 'idle', seq: 20 });
    applyRunStatus(qc, org, projectId, { runId: ids.run(1, 61), number: 61, status: 'succeeded', seq: 22 });
    const detail = qc.getQueryData(runsQueries.detail(org, projectId, 61).queryKey);
    expect(detail?.status).toBe('succeeded');
    expect(detail?.finishedAt).not.toBeNull();
    expect(counts()).toEqual({ needsYou: 1, running: 1, queued: 1 });
    expect(
      qc.getQueryData(runsQueries.list(org, projectId, 'all').queryKey)?.items.find((r) => r.number === 61)?.status,
    ).toBe('succeeded');

    // A final run loaded over REST (no seq seen yet) is not taken back to active either.
    const fresh = seeded();
    fresh.setQueryData(runsQueries.detail(org, projectId, 55).queryKey, run(55));
    applyRunStatus(fresh, org, projectId, status(55, 'running', 3));
    expect(fresh.getQueryData(runsQueries.detail(org, projectId, 55).queryKey)?.status).toBe('succeeded');
  });

  describe('a thin project-stream change and the full run-stream change of the same seq', () => {
    const thin = (s: RunDto['status'], seq: number) => ({ runId: ids.run(1, 61), number: 61, status: s, seq });
    const full = (s: RunDto['status'], seq: number, extra: Record<string, unknown> = {}) => ({
      ...status(61, s, seq),
      waitingOn: null,
      agentNote: null,
      pausedAt: null,
      sessionExpiresAt: null,
      sessionEndingAt: null,
      pauseReason: null,
      ...extra,
    });
    const parked = {
      pausedAt: '2026-11-20T01:51:51.325Z',
      sessionExpiresAt: '2026-11-27T01:51:51.325Z',
      pauseReason: 'stopped',
    };
    const detailOf = (qc: QueryClient) => qc.getQueryData(runsQueries.detail(org, projectId, 61).queryKey);

    it('keeps the kept session and the pause reason when the thin change arrives first (a Stop session)', () => {
      const qc = seeded();
      applyRunStatus(qc, org, projectId, full('idle', 20));
      applyRunStatus(qc, org, projectId, thin('paused', 30));
      applyRunStatus(qc, org, projectId, full('paused', 30, parked));
      expect(detailOf(qc)).toMatchObject({ status: 'paused', ...parked });
    });

    it('applies the full change of a seq the run stream already sent, when the session started ending', () => {
      const qc = seeded();
      applyRunStatus(qc, org, projectId, full('idle', 20));
      applyRunStatus(qc, org, projectId, full('idle', 20, { sessionEndingAt: '2026-11-20T01:51:51.243Z' }));
      expect(detailOf(qc)?.sessionEndingAt).toBe('2026-11-20T01:51:51.243Z');
    });

    it('does not let a thin change of the same seq clear what the full one set', () => {
      const qc = seeded();
      applyRunStatus(qc, org, projectId, full('paused', 30, parked));
      applyRunStatus(qc, org, projectId, thin('paused', 30));
      expect(detailOf(qc)).toMatchObject({ status: 'paused', ...parked });
    });

    it('moves the project counts once, whichever stream is first', () => {
      const qc = seeded();
      const counts = () => qc.getQueryData(projectsQueries.detail(org, projectId).queryKey)?.counts;
      applyRunStatus(qc, org, projectId, full('idle', 20));
      const idle = counts();
      applyRunStatus(qc, org, projectId, thin('paused', 30));
      applyRunStatus(qc, org, projectId, full('paused', 30, parked));
      const once = counts();
      const other = seeded();
      applyRunStatus(other, org, projectId, full('idle', 20));
      applyRunStatus(other, org, projectId, full('paused', 30, parked));
      expect(once).toEqual(other.getQueryData(projectsQueries.detail(org, projectId).queryKey)?.counts);
      expect(once).not.toEqual(idle);
    });
  });

  it('a resume takes a succeeded run back to queued: applied, finish time cleared, counts move', () => {
    const qc = seeded();
    qc.setQueryData(runsQueries.detail(org, projectId, 60).queryKey, run(60));
    applyRunStatus(qc, org, projectId, { runId: ids.run(1, 60), number: 60, status: 'queued', seq: 40 });
    const detail = qc.getQueryData(runsQueries.detail(org, projectId, 60).queryKey);
    expect(detail?.status).toBe('queued');
    expect(detail?.finishedAt).toBeNull();
    expect(qc.getQueryData(projectsQueries.detail(org, projectId).queryKey)?.counts.queued).toBe(2);
    // Anything else out of a final status is still dropped.
    applyRunStatus(qc, org, projectId, { runId: ids.run(1, 60), number: 60, status: 'succeeded', seq: 41 });
    applyRunStatus(qc, org, projectId, { runId: ids.run(1, 60), number: 60, status: 'idle', seq: 42 });
    expect(qc.getQueryData(runsQueries.detail(org, projectId, 60).queryKey)?.status).toBe('succeeded');
  });

  it('a run status event brings pausedAt and sessionExpiresAt into the cached run', () => {
    const qc = seeded();
    const paused = {
      ...status(61, 'paused', 30),
      waitingOn: null,
      agentNote: null,
      pausedAt: '2026-11-12T14:30:00.000Z',
      sessionExpiresAt: '2026-11-19T14:30:00.000Z',
    };
    applyRunStatus(qc, org, projectId, paused);
    const detail = qc.getQueryData(runsQueries.detail(org, projectId, 61).queryKey);
    expect(detail).toMatchObject({
      status: 'paused',
      pausedAt: '2026-11-12T14:30:00.000Z',
      sessionExpiresAt: '2026-11-19T14:30:00.000Z',
      finishedAt: null,
    });
    const row = qc.getQueryData(runsQueries.list(org, projectId, 'all').queryKey)?.items.find((r) => r.number === 61);
    expect(row?.pausedAt).toBe('2026-11-12T14:30:00.000Z');
    // Resumed: both go.
    applyRunStatus(qc, org, projectId, {
      ...status(61, 'queued', 31),
      waitingOn: null,
      agentNote: null,
      pausedAt: null,
      sessionExpiresAt: null,
    });
    expect(qc.getQueryData(runsQueries.detail(org, projectId, 61).queryKey)).toMatchObject({
      pausedAt: null,
      sessionExpiresAt: null,
    });
  });

  it('a run status event brings sessionEndingAt and pauseReason into the cached run; the project stream leaves them', () => {
    const qc = seeded();
    const key = runsQueries.detail(org, projectId, 61).queryKey;
    const withSession = (seq: number, sessionEndingAt: string | null, pauseReason: RunDto['pauseReason']) => ({
      ...status(61, 'running', seq),
      waitingOn: null,
      agentNote: null,
      pausedAt: null,
      sessionExpiresAt: null,
      sessionEndingAt,
      pauseReason,
    });
    // Still idle, but the session is ending: the run shows "pausing".
    applyRunStatus(qc, org, projectId, withSession(30, '2026-11-12T14:30:00.000Z', null));
    expect(qc.getQueryData(key)).toMatchObject({ status: 'running', sessionEndingAt: '2026-11-12T14:30:00.000Z' });
    // The project stream does not carry them.
    applyRunStatus(qc, org, projectId, { runId: ids.run(1, 61), number: 61, status: 'running', seq: 31 });
    expect(qc.getQueryData(key)?.sessionEndingAt).toBe('2026-11-12T14:30:00.000Z');
    // Parked: the ending is over and the reason is known.
    applyRunStatus(qc, org, projectId, { ...withSession(32, null, 'pod_lost'), status: 'paused' });
    expect(qc.getQueryData(key)).toMatchObject({ status: 'paused', sessionEndingAt: null, pauseReason: 'pod_lost' });
    const row = qc.getQueryData(runsQueries.list(org, projectId, 'all').queryKey)?.items.find((r) => r.number === 61);
    expect(row).toMatchObject({ sessionEndingAt: null, pauseReason: 'pod_lost' });
  });

  it('the project stream (no session fields) leaves pausedAt and sessionExpiresAt as cached', () => {
    const qc = seeded();
    applyRunStatus(qc, org, projectId, {
      ...status(61, 'paused', 30),
      waitingOn: null,
      agentNote: null,
      pausedAt: '2026-11-12T14:30:00.000Z',
      sessionExpiresAt: '2026-11-19T14:30:00.000Z',
    });
    applyRunStatus(qc, org, projectId, { runId: ids.run(1, 61), number: 61, status: 'paused', seq: 31 });
    expect(qc.getQueryData(runsQueries.detail(org, projectId, 61).queryKey)?.pausedAt).toBe('2026-11-12T14:30:00.000Z');
  });

  it('a paused run is in the needs-you list and counts as needs you in the project, but is no longer a live job', () => {
    const qc = seeded();
    const before = qc.getQueryData(projectsQueries.detail(org, projectId).queryKey)?.counts;
    applyRunStatus(qc, org, projectId, status(61, 'paused', 30));
    const needs = qc.getQueryData(runsQueries.list(org, projectId, 'needs_you').queryKey)?.items.map((r) => r.number);
    expect(needs).toContain(62);
    // Run 61 is not cached in the needs-you list: that list is refetched to pick up the paused run.
    expect(qc.getQueryState(runsQueries.list(org, projectId, 'needs_you').queryKey)?.isInvalidated).toBe(true);
    const after = qc.getQueryData(projectsQueries.detail(org, projectId).queryKey)?.counts;
    expect(after?.needsYou).toBe((before?.needsYou ?? 0) + 1);
    expect(after?.running).toBe((before?.running ?? 0) - 1);
  });

  it('an idle run that is paused stays in needs you and leaves the live jobs', () => {
    const qc = seeded();
    const before = qc.getQueryData(projectsQueries.detail(org, projectId).queryKey)?.counts;
    applyRunStatus(qc, org, projectId, status(62, 'paused', 30));
    const after = qc.getQueryData(projectsQueries.detail(org, projectId).queryKey)?.counts;
    expect(after?.needsYou).toBe(before?.needsYou);
    expect(after?.running).toBe((before?.running ?? 0) - 1);
  });

  it('a paused run that is resumed leaves needs you when it starts', () => {
    const qc = seeded();
    applyRunStatus(qc, org, projectId, status(62, 'paused', 30));
    applyRunStatus(qc, org, projectId, status(62, 'queued', 31));
    const counts = qc.getQueryData(projectsQueries.detail(org, projectId).queryKey)?.counts;
    expect(counts).toEqual({ needsYou: 0, running: 1, queued: 2 });
  });

  it('a paused run stays in the needs-you list when it was already there as idle', () => {
    const qc = seeded();
    applyRunStatus(qc, org, projectId, status(62, 'paused', 30));
    const needs = qc.getQueryData(runsQueries.list(org, projectId, 'needs_you').queryKey)?.items.map((r) => r.number);
    expect(needs).toEqual([62]);
  });

  it('an uncached run also invalidates the ticket lists its status fits', () => {
    const qc = seeded();
    const ticketList = runsQueries.list(org, projectId, 'all', '12').queryKey;
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
