import type { RunDto, RunEventDto } from '@agentdesk/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { runFixtures } from '@/mocks/dto/runs';
import { mockDb } from '@/mocks/msw/db';
import { FakeEventSource } from '@/test/fakeEventSource';
import { renderRoute } from '@/test/renderRoute';
import { setPendingAction } from './pending';
import { runsQueries } from './queries';
import { PROJECT_STREAM_HIDDEN_MS, useProjectEvents } from './useProjectEvents';
import { useRunEvents } from './useRunEvents';

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
    act(() => vi.advanceTimersByTime(3_000));
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.latest().url).toBe(`${runPrefix(61)}?after=2`);
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

describe('run detail route, live', () => {
  it('the indicator goes live → reconnecting → live; status idle updates the detail and the runs list row', async () => {
    const { queryClient } = await renderRoute(`${base}/runs/61`);
    expect(await screen.findByText('Reconnecting…')).toBeInTheDocument();
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
      counts: { needsYou: 2, running: 0 },
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
    expect(qc.getQueryState(listKey)?.isInvalidated).toBe(true);
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
