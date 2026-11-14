import type { RunDto, RunEventDto } from '@agentdesk/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { runFixtures } from '@/mocks/dto/runs';
import { mockDb } from '@/mocks/msw/db';
import { FakeEventSource } from '@/test/fakeEventSource';
import { FakeWebSocket } from '@/test/fakeWebSocket';
import { renderRoute } from '@/test/renderRoute';
import { setPendingAction } from './pending';
import { runsQueries } from './queries';
import { PROJECT_STREAM_HIDDEN_MS, useProjectEvents } from './useProjectEvents';
import { FINAL_LOG_RECHECK_MS, useFinalLogReload, useRunEvents } from './useRunEvents';

const org = 'alice';
const projectId = ids.project.invoicerApi;
const base = `/o/${org}/p/${projectId}`;
const runId = (n: number) => ids.run(1, n);
const runPrefix = (n: number) => `/api/runs/${runId(n)}/events`;
const projectStream = `/api/projects/${projectId}/events`;
const ev = (seq: number): RunEventDto => ({
  seq,
  ts: '2026-11-12T14:20:00.000Z',
  type: 'lifecycle',
  payload: { text: `line ${seq}` },
});
const statusMsg = (n: number, status: RunDto['status'], seq: number) => ({
  runId: runId(n),
  number: n,
  status,
  seq,
  exitCode: status === 'succeeded' ? 0 : null,
  failureReason: null,
  waitingOn: null,
  agentNote: null,
});
const fixture = (n: number): RunDto => {
  const r = runFixtures.find((x) => x.projectId === projectId && x.number === n);
  if (!r) throw new Error(`run ${n} missing`);
  return structuredClone(r);
};
const dbRun = (n: number) => {
  const r = mockDb.state.runs.find((x) => x.projectId === projectId && x.number === n);
  if (!r) throw new Error(`run ${n} missing`);
  return r;
};
const runSource = (n: number) => {
  const s = FakeEventSource.matching(runPrefix(n)).at(-1);
  if (!s) throw new Error(`no stream for run ${n}`);
  return s;
};
const projectSource = () => {
  const s = FakeEventSource.matching(projectStream).at(-1);
  if (!s) throw new Error('no project stream');
  return s;
};
const indicator = () => within(screen.getByRole('main')).getByText(/^(Live|Reconnecting…)$/);

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

let hidden = false;
Object.defineProperty(document, 'hidden', {
  configurable: true,
  get: () => hidden,
});
const setHidden = (h: boolean) => {
  hidden = h;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

afterEach(() => {
  hidden = false;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useRunEvents', () => {
  it('applies a replayed backlog once (Review Focus 1): 3, 4, reconnect, 3, 4, 5 → [3, 4, 5]', () => {
    const qc = new QueryClient();
    qc.setQueryData(runsQueries.detail(org, projectId, 61).queryKey, fixture(61));
    qc.setQueryData(runsQueries.events(org, projectId, 61).queryKey, []);
    const { result } = renderHook(() => useRunEvents(org, projectId, 61, runId(61)), { wrapper: wrapperFor(qc) });
    const source = FakeEventSource.latest();
    expect(source.url).toBe(runPrefix(61));
    expect(result.current).toBe('reconnecting');

    act(() => {
      source.open();
      source.emit('event', ev(3), 3);
      source.emit('event', ev(4), 4);
    });
    expect(result.current).toBe('live');
    act(() => source.fail());
    expect(result.current).toBe('reconnecting');
    act(() => {
      source.open();
      for (const seq of [3, 4, 5]) source.emit('event', ev(seq), seq);
    });
    expect(result.current).toBe('live');
    expect(qc.getQueryData(runsQueries.events(org, projectId, 61).queryKey)?.map((e) => e.seq)).toEqual([3, 4, 5]);
    // The browser reconnected by itself (Last-Event-ID): no second source.
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('drops malformed payloads and status for another run', () => {
    const qc = new QueryClient();
    qc.setQueryData(runsQueries.detail(org, projectId, 61).queryKey, fixture(61));
    qc.setQueryData(runsQueries.events(org, projectId, 61).queryKey, [ev(1)]);
    renderHook(() => useRunEvents(org, projectId, 61, runId(61)), {
      wrapper: wrapperFor(qc),
    });
    const source = FakeEventSource.latest();
    expect(source.url).toBe(`${runPrefix(61)}?after=1`);
    act(() => {
      source.open();
      source.emit('event', 'not json');
      source.emit('event', { seq: 'x' });
      source.emit('status', {
        ...statusMsg(61, 'idle', 2),
        status: 'sleeping',
      });
      source.emit('status', statusMsg(62, 'succeeded', 2));
    });
    expect(qc.getQueryData(runsQueries.events(org, projectId, 61).queryKey)?.map((e) => e.seq)).toEqual([1]);
    expect(qc.getQueryData(runsQueries.detail(org, projectId, 61).queryKey)?.status).toBe('running');
    expect(source.closed).toBe(false);
  });

  it('opens a new stream after the last seen seq when the browser gives up', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const qc = new QueryClient();
    qc.setQueryData(runsQueries.detail(org, projectId, 61).queryKey, fixture(61));
    qc.setQueryData(runsQueries.events(org, projectId, 61).queryKey, [ev(1)]);
    const { result } = renderHook(() => useRunEvents(org, projectId, 61, runId(61)), { wrapper: wrapperFor(qc) });
    const first = FakeEventSource.latest();
    act(() => {
      first.open();
      first.emit('event', ev(2), 2);
      first.fail(FakeEventSource.CLOSED);
    });
    expect(result.current).toBe('reconnecting');
    act(() => vi.advanceTimersByTime(1_200));
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.latest().url).toBe(`${runPrefix(61)}?after=2`);
  });

  it('backs off 1, 2, 4 … 30 s, gives up after 8 failed re-opens and stays reconnecting; an open resets it', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const qc = new QueryClient();
    const { result } = renderHook(() => useRunEvents(org, projectId, 61, runId(61)), { wrapper: wrapperFor(qc) });
    // With full jitter (+20 %).
    act(() => FakeEventSource.latest().fail(FakeEventSource.CLOSED));
    act(() => vi.advanceTimersByTime(1_200));
    act(() => FakeEventSource.latest().open());
    expect(result.current).toBe('live');
    const delays = [1_200, 2_400, 4_800, 9_600, 19_200, 36_000, 36_000, 36_000];
    for (const [i, delay] of delays.entries()) {
      act(() => FakeEventSource.latest().fail(FakeEventSource.CLOSED));
      act(() => vi.advanceTimersByTime(delay - 1));
      expect(FakeEventSource.instances).toHaveLength(i + 2);
      act(() => vi.advanceTimersByTime(1));
      expect(FakeEventSource.instances).toHaveLength(i + 3);
    }
    act(() => FakeEventSource.latest().fail(FakeEventSource.CLOSED));
    act(() => vi.advanceTimersByTime(10 * 60_000));
    expect(FakeEventSource.instances).toHaveLength(delays.length + 2);
    expect(result.current).toBe('reconnecting');
  });

  it('status succeeded → ended and the source is closed', () => {
    const qc = new QueryClient();
    qc.setQueryData(runsQueries.detail(org, projectId, 61).queryKey, fixture(61));
    const { result } = renderHook(() => useRunEvents(org, projectId, 61, runId(61)), { wrapper: wrapperFor(qc) });
    const source = FakeEventSource.latest();
    act(() => {
      source.open();
      source.emit('status', statusMsg(61, 'succeeded', 9), 9);
    });
    expect(result.current).toBe('ended');
    expect(source.closed).toBe(true);
    expect(qc.getQueryData(runsQueries.detail(org, projectId, 61).queryKey)?.status).toBe('succeeded');
  });

  it('closes the stream on unmount (no leaks)', () => {
    const qc = new QueryClient();
    const { unmount } = renderHook(() => useRunEvents(org, projectId, 61, runId(61)), { wrapper: wrapperFor(qc) });
    const source = FakeEventSource.latest();
    unmount();
    expect(source.closed).toBe(true);
  });
});

describe('useFinalLogReload', () => {
  const setup = () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const hook = renderHook(({ final, n }) => useFinalLogReload(org, projectId, n, final), {
      wrapper: wrapperFor(qc),
      initialProps: { final: false, n: 61 },
    });
    return { spy, hook };
  };

  it('reloads the run and its log once when it turns final, and the log again after the recheck delay', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { spy, hook } = setup();
    hook.rerender({ final: true, n: 61 });
    expect(spy).toHaveBeenCalledTimes(1);
    hook.rerender({ final: true, n: 61 });
    act(() => vi.advanceTimersByTime(FINAL_LOG_RECHECK_MS));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith({ queryKey: runsQueries.events(org, projectId, 61).queryKey, exact: true });
  });

  it('drops the recheck on unmount; another run loaded final reloads nothing', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { spy, hook } = setup();
    hook.rerender({ final: true, n: 61 });
    hook.unmount();
    act(() => vi.advanceTimersByTime(FINAL_LOG_RECHECK_MS));
    expect(spy).toHaveBeenCalledTimes(1);

    const other = setup();
    other.hook.rerender({ final: true, n: 55 });
    expect(other.spy).not.toHaveBeenCalled();
  });
});

describe('run detail route, live', () => {
  it('the indicator goes live → reconnecting → live; status idle updates the detail and the runs list row', async () => {
    const { queryClient } = await renderRoute(`${base}/runs/61`);
    // Until the terminal socket opens, the indicator is the terminal's; then it follows the event stream.
    expect(await screen.findByText('Connecting…')).toBeInTheDocument();
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    act(() => FakeWebSocket.latest().open());
    expect(indicator()).toHaveTextContent('Reconnecting…');
    const source = runSource(61);
    expect(source.url).toMatch(/\?after=\d+$/);

    act(() => source.open());
    expect(indicator()).toHaveTextContent('Live');
    act(() => source.fail());
    expect(indicator()).toHaveTextContent('Reconnecting…');
    act(() => source.open());
    expect(indicator()).toHaveTextContent('Live');

    act(() => source.emit('status', statusMsg(61, 'idle', 40), 40));
    expect(await screen.findByText('The agent finished its turn and is waiting for you')).toBeInTheDocument();
    const lists = queryClient.getQueriesData<{ items: RunDto[] }>({
      queryKey: ['org', org, 'projects', projectId],
    });
    const rows = lists.flatMap(([, d]) => (d && 'items' in d ? d.items.filter((r) => r.number === 61) : []));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.status).toBe('idle');
  });

  it('a final status ends the stream, clears a pending note and reloads the log', async () => {
    const { queryClient } = await renderRoute(`${base}/runs/62`);
    const source = runSource(62);
    act(() => source.open());
    act(() => {
      setPendingAction(queryClient, runId(62), 'finish', () => {
        queryClient.setQueryData(
          runsQueries.detail(org, projectId, 62).queryKey,
          (r) => r && { ...r, statusNote: undefined },
        );
      });
      queryClient.setQueryData(
        runsQueries.detail(org, projectId, 62).queryKey,
        (r) => r && { ...r, statusNote: 'Finishing…' },
      );
    });
    expect(await within(screen.getByRole('banner')).findByText('Finishing…')).toBeInTheDocument();
    const logs = mockDb.requests('GET', `/api/runs/${runId(62)}/log`);

    // The server has ended it (the refetch after the status agrees).
    dbRun(62).status = 'succeeded';
    dbRun(62).finishedAt = new Date().toISOString();
    dbRun(62).exitCode = 0;
    act(() => source.emit('status', statusMsg(62, 'succeeded', 40), 40));

    expect(await screen.findByText(/^Succeeded in /)).toBeInTheDocument();
    expect(source.closed).toBe(true);
    expect(within(screen.getByRole('banner')).queryByText('Finishing…')).not.toBeInTheDocument();
    await waitFor(() => expect(mockDb.requests('GET', `/api/runs/${runId(62)}/log`)).toBeGreaterThan(logs));
    expect(FakeEventSource.matching(runPrefix(62))).toHaveLength(1);
  });

  it('a lagging project event never takes an ended run back (run stream first, then project idle)', async () => {
    const { queryClient } = await renderRoute(`${base}/runs/62`);
    const counts = () => queryClient.getQueryData(['org', org, 'projects', projectId]);
    const run = runSource(62);
    const project = projectSource();
    act(() => {
      run.open();
      project.open();
    });
    expect(counts()).toMatchObject({ counts: { needsYou: 1 } });
    dbRun(62).status = 'succeeded';
    dbRun(62).finishedAt = new Date().toISOString();
    act(() => run.emit('status', statusMsg(62, 'succeeded', 40), 40));
    expect(await screen.findByText(/^Succeeded in /)).toBeInTheDocument();
    expect(counts()).toMatchObject({ counts: { needsYou: 0 } });
    const sources = FakeEventSource.instances.length;

    act(() => project.emit('run', { runId: runId(62), number: 62, status: 'idle', seq: 30 }));
    expect(queryClient.getQueryData(runsQueries.detail(org, projectId, 62).queryKey)?.status).toBe('succeeded');
    expect(screen.getByText(/^Succeeded in /)).toBeInTheDocument();
    expect(counts()).toMatchObject({ counts: { needsYou: 0 } });
    expect(FakeEventSource.instances).toHaveLength(sources);
    act(() => project.emit('run', { runId: runId(62), number: 62, status: 'succeeded', seq: 40 }));
    expect(counts()).toMatchObject({ counts: { needsYou: 0 } });
    expect(FakeEventSource.instances).toHaveLength(sources);
    await waitFor(() => expect(counts()).toMatchObject({ counts: { needsYou: 0 } }));
  });

  it('a refetch of the log while streaming keeps the events the stream added', async () => {
    const { queryClient } = await renderRoute(`${base}/runs/61`);
    const source = runSource(61);
    const key = runsQueries.events(org, projectId, 61).queryKey;
    const top = Math.max(...(queryClient.getQueryData(key) ?? []).map((e) => e.seq));
    act(() => {
      source.open();
      source.emit('event', ev(top + 1), top + 1);
    });
    await act(() => queryClient.refetchQueries({ queryKey: key, exact: true }));
    expect(queryClient.getQueryData(key)?.at(-1)?.seq).toBe(top + 1);
  });

  it('a final run opens no run stream', async () => {
    await renderRoute(`${base}/runs/55`);
    expect(await screen.findByText(/^Succeeded in /)).toBeInTheDocument();
    expect(FakeEventSource.matching(runPrefix(55))).toHaveLength(0);
  });
});

describe('project events', () => {
  it('a project event for a run in a cached list updates its status', async () => {
    const { queryClient } = await renderRoute(`${base}/runs`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Runs' })).toBeInTheDocument();
    const source = projectSource();
    act(() => {
      source.open();
      source.emit('run', {
        runId: runId(61),
        number: 61,
        status: 'idle',
        seq: 30,
      });
    });
    const all = queryClient.getQueryData(runsQueries.list(org, projectId, 'all').queryKey);
    expect(all?.items.find((r) => r.number === 61)?.status).toBe('idle');
    expect(queryClient.getQueryData(['org', org, 'projects', projectId])).toMatchObject({
      counts: { needsYou: 2, running: 2 },
    });
  });

  it('closes after the tab is hidden for 60 s; on visible a new stream opens and the runs queries refetch', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const qc = new QueryClient();
    const listKey = runsQueries.list(org, projectId, 'all').queryKey;
    qc.setQueryData(listKey, { items: [fixture(61)], truncated: false });
    renderHook(() => useProjectEvents(org, projectId), {
      wrapper: wrapperFor(qc),
    });
    const first = projectSource();
    expect(FakeEventSource.instances).toHaveLength(1);

    setHidden(true);
    act(() => vi.advanceTimersByTime(PROJECT_STREAM_HIDDEN_MS - 1));
    expect(first.closed).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(first.closed).toBe(true);
    expect(qc.getQueryState(listKey)?.isInvalidated).toBe(false);

    setHidden(false);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(projectSource()).not.toBe(first);
    // Catch-up waits for the new stream to open.
    expect(qc.getQueryState(listKey)?.isInvalidated).toBe(false);
    act(() => projectSource().open());
    expect(qc.getQueryState(listKey)?.isInvalidated).toBe(true);
  });

  it('a browser reconnect catches up once the stream is open again', () => {
    const qc = new QueryClient();
    const listKey = runsQueries.list(org, projectId, 'all').queryKey;
    qc.setQueryData(listKey, { items: [fixture(61)], truncated: false });
    renderHook(() => useProjectEvents(org, projectId), { wrapper: wrapperFor(qc) });
    const source = projectSource();
    act(() => source.open());
    expect(qc.getQueryState(listKey)?.isInvalidated).toBe(false);
    act(() => source.fail());
    expect(qc.getQueryState(listKey)?.isInvalidated).toBe(false);
    act(() => source.open());
    expect(qc.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('a stream the browser gives up on re-opens with growing delays, then stops; catch-up only on open', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    // Unobserved, the list would be garbage-collected during the minutes this test skips.
    const qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    const listKey = runsQueries.list(org, projectId, 'all').queryKey;
    qc.setQueryData(listKey, { items: [fixture(61)], truncated: false });
    renderHook(() => useProjectEvents(org, projectId), { wrapper: wrapperFor(qc) });

    const delays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000];
    for (const [i, delay] of delays.entries()) {
      act(() => projectSource().fail(FakeEventSource.CLOSED));
      act(() => vi.advanceTimersByTime(delay - 1));
      expect(FakeEventSource.instances).toHaveLength(i + 1);
      act(() => vi.advanceTimersByTime(1));
      expect(FakeEventSource.instances).toHaveLength(i + 2);
    }
    expect(qc.getQueryState(listKey)?.isInvalidated).toBe(false);
    act(() => projectSource().fail(FakeEventSource.CLOSED));
    act(() => vi.advanceTimersByTime(10 * 60_000));
    expect(FakeEventSource.instances).toHaveLength(delays.length + 1);
    expect(qc.getQueryState(listKey)?.isInvalidated).toBe(false);
  });

  it('an open resets the back-off and catches up', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const qc = new QueryClient();
    const listKey = runsQueries.list(org, projectId, 'all').queryKey;
    qc.setQueryData(listKey, { items: [fixture(61)], truncated: false });
    renderHook(() => useProjectEvents(org, projectId), { wrapper: wrapperFor(qc) });
    for (const delay of [1_000, 2_000, 4_000]) {
      act(() => projectSource().fail(FakeEventSource.CLOSED));
      act(() => vi.advanceTimersByTime(delay));
    }
    act(() => projectSource().open());
    expect(qc.getQueryState(listKey)?.isInvalidated).toBe(true);
    act(() => projectSource().fail(FakeEventSource.CLOSED));
    act(() => vi.advanceTimersByTime(1_000));
    expect(FakeEventSource.instances).toHaveLength(5);
  });

  it('a short hide keeps the stream', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const qc = new QueryClient();
    renderHook(() => useProjectEvents(org, projectId), {
      wrapper: wrapperFor(qc),
    });
    const first = projectSource();
    setHidden(true);
    act(() => vi.advanceTimersByTime(10_000));
    setHidden(false);
    act(() => vi.advanceTimersByTime(PROJECT_STREAM_HIDDEN_MS));
    expect(first.closed).toBe(false);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
