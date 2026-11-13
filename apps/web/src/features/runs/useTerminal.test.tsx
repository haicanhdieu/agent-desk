import type { RunDto } from '@agentdesk/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode, RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveTerminalHandle } from '@/components/LiveTerminal';
import { ids } from '@/mocks/dto/ids';
import { runFixtures } from '@/mocks/dto/runs';
import { mockDb } from '@/mocks/msw/db';
import { FakeWebSocket } from '@/test/fakeWebSocket';
import { FakeXterm } from '@/test/fakeXterm';
import { renderRoute } from '@/test/renderRoute';
import { runsQueries } from './queries';
import {
  RESIZE_DEBOUNCE_MS,
  STABLE_OPEN_MS,
  TERMINAL_BACKOFF_MS,
  useTerminal,
  useTerminalSocket,
  type TerminalState,
} from './useTerminal';

const signOut = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('@/features/auth/signOut', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/auth/signOut')>()),
  signOutAndRedirect: signOut,
}));

const org = 'alice';
const projectId = ids.project.invoicerApi;
const base = `/o/${org}/p/${projectId}`;
const runId = (n: number) => ids.run(1, n);
const terminalPathOf = (n: number) => `/api/runs/${runId(n)}/terminal`;
const run = { org, projectId, number: 62 };
const encode = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

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

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function setup(opts: { enabled?: boolean } = {}) {
  const qc = new QueryClient();
  qc.setQueryData(runsQueries.detail(org, projectId, 62).queryKey, fixture(62));
  const write = vi.fn<LiveTerminalHandle['write']>();
  const term: RefObject<LiveTerminalHandle | null> = { current: { write } };
  const hook = renderHook(({ enabled }: { enabled: boolean }) => useTerminal(runId(62), enabled, term, run), {
    wrapper: wrapperFor(qc),
    initialProps: { enabled: opts.enabled ?? true },
  });
  return { qc, write, hook, state: (): TerminalState => hook.result.current.state };
}

const latest = () => FakeWebSocket.latest();

beforeEach(() => {
  signOut.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useTerminal', () => {
  it('opens ws(s)://<host>/api/runs/:runId/terminal for binary data', () => {
    const { state } = setup();
    const ws = latest();
    expect(ws.url).toBe(`ws://${window.location.host}${terminalPathOf(62)}`);
    expect(ws.binaryType).toBe('arraybuffer');
    expect(state()).toBe('connecting');
    act(() => ws.open());
    expect(state()).toBe('open');
  });

  it('opens nothing while disabled', () => {
    setup({ enabled: false });
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('writes bytes from the socket to the terminal', () => {
    const { write } = setup();
    const ws = latest();
    act(() => {
      ws.open();
      ws.receive(encode('\u001b[1mhello\u001b[0m é'));
    });
    expect(write).toHaveBeenCalledTimes(1);
    const bytes = write.mock.calls[0][0];
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(typeof bytes === 'string' ? bytes : decode(bytes)).toBe('\u001b[1mhello\u001b[0m é');
  });

  it('never acts on text frames from the server', () => {
    const { write, state } = setup();
    const ws = latest();
    act(() => {
      ws.open();
      ws.receive('{"type":"resize","cols":1,"rows":1}');
      ws.receive('eval(alert(1))');
    });
    expect(write).not.toHaveBeenCalled();
    expect(ws.sent).toEqual([]);
    expect(state()).toBe('open');
  });

  it('sends typed input as one UTF-8 binary frame', () => {
    const { hook } = setup();
    const ws = latest();
    act(() => ws.open());
    act(() => hook.result.current.onData('ls -é\r'));
    expect(ws.textFrames()).toEqual([]);
    expect(ws.binaryFrames().map(decode)).toEqual(['ls -é\r']);
  });

  it('drops input while the socket is not open', () => {
    const { hook } = setup();
    const ws = latest();
    act(() => hook.result.current.onData('x'));
    expect(ws.sent).toEqual([]);
  });

  it('sends the size after open, and two resizes within 100 ms as one resize frame', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { hook } = setup();
    const ws = latest();
    // The terminal reports its size before the socket opens: it is sent on open.
    act(() => hook.result.current.onResize({ cols: 100, rows: 30 }));
    act(() => vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS));
    expect(ws.sent).toEqual([]);
    act(() => ws.open());
    expect(ws.textFrames().map((f) => JSON.parse(f))).toEqual([{ type: 'resize', cols: 100, rows: 30 }]);

    act(() => hook.result.current.onResize({ cols: 120, rows: 40 }));
    act(() => vi.advanceTimersByTime(50));
    act(() => hook.result.current.onResize({ cols: 132, rows: 44 }));
    act(() => vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS - 1));
    expect(ws.textFrames()).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(ws.textFrames().slice(1)).toEqual(['{"type":"resize","cols":132,"rows":44}']);
    expect(ws.binaryFrames()).toEqual([]);
  });

  it('retries abnormal closes after 1, 2, 4, 8 and 10 s, then gives up', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { state } = setup();
    act(() => latest().serverClose(1006));
    for (const delay of TERMINAL_BACKOFF_MS) {
      const count = FakeWebSocket.instances.length;
      expect(state()).toBe('retrying');
      act(() => vi.advanceTimersByTime(delay - 1));
      expect(FakeWebSocket.instances).toHaveLength(count);
      act(() => vi.advanceTimersByTime(1));
      expect(FakeWebSocket.instances).toHaveLength(count + 1);
      act(() => latest().serverClose(1011));
    }
    expect(TERMINAL_BACKOFF_MS).toEqual([1000, 2000, 4000, 8000, 10000]);
    expect(state()).toBe('gave_up');
    act(() => vi.advanceTimersByTime(10 * 60_000));
    expect(FakeWebSocket.instances).toHaveLength(6);
  });

  it('a connection that stayed open 5 s resets the back-off', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { state } = setup();
    act(() => latest().serverClose(1006));
    act(() => vi.advanceTimersByTime(1000));
    act(() => latest().serverClose(1006));
    act(() => vi.advanceTimersByTime(2000));
    act(() => latest().open());
    expect(state()).toBe('open');
    act(() => vi.advanceTimersByTime(STABLE_OPEN_MS));
    act(() => latest().serverClose(1001));
    expect(state()).toBe('retrying');
    act(() => vi.advanceTimersByTime(1000));
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  it('accept-then-close does not reset the back-off: delays grow and it gives up', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { state } = setup();
    act(() => {
      latest().open();
      latest().serverClose(1011);
    });
    for (const delay of TERMINAL_BACKOFF_MS) {
      const count = FakeWebSocket.instances.length;
      act(() => vi.advanceTimersByTime(delay - 1));
      expect(FakeWebSocket.instances).toHaveLength(count);
      act(() => vi.advanceTimersByTime(1));
      expect(FakeWebSocket.instances).toHaveLength(count + 1);
      // The server accepts, then closes at once (well within STABLE_OPEN_MS).
      act(() => {
        latest().open();
        vi.advanceTimersByTime(STABLE_OPEN_MS - 1);
        latest().serverClose(1011);
      });
    }
    expect(state()).toBe('gave_up');
    act(() => vi.advanceTimersByTime(10 * 60_000));
    expect(FakeWebSocket.instances).toHaveLength(6);
  });

  it('reconnect() after giving up opens a new socket with a fresh back-off', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { hook, state } = setup();
    act(() => latest().serverClose(1006));
    for (const delay of TERMINAL_BACKOFF_MS) {
      act(() => vi.advanceTimersByTime(delay));
      act(() => latest().serverClose(1006));
    }
    expect(state()).toBe('gave_up');
    act(() => hook.result.current.reconnect());
    expect(FakeWebSocket.instances).toHaveLength(7);
    expect(state()).toBe('connecting');
    act(() => latest().serverClose(1006));
    act(() => vi.advanceTimersByTime(1000));
    expect(FakeWebSocket.instances).toHaveLength(8);
  });

  it('4403 → forbidden, no retry', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { state } = setup();
    act(() => latest().serverClose(4403));
    expect(state()).toBe('forbidden');
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('4401 → the sign-out path, no retry', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    setup();
    act(() => latest().serverClose(4401));
    expect(signOut).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('4409 → the run detail is invalidated, connecting while it refetches, no retry', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { qc, state } = setup();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    act(() => latest().open());
    act(() => latest().serverClose(4409));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: runsQueries.detail(org, projectId, 62).queryKey });
    expect(state()).toBe('connecting');
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('4409 while the refetched run is still active → gave_up (manual reconnect only)', async () => {
    const { state } = setup();
    act(() => latest().open());
    act(() => latest().serverClose(4409));
    await waitFor(() => expect(state()).toBe('gave_up'));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('1000 (the server ended the session) after the run ended → the run is refetched, no retry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { qc, state } = setup();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    act(() => latest().open());
    // The run finished on the server; the refetch the close triggers sees it final.
    qc.setQueryData(runsQueries.detail(org, projectId, 62).queryKey, { ...fixture(62), status: 'succeeded' });
    await act(async () => latest().serverClose(1000));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: runsQueries.detail(org, projectId, 62).queryKey });
    expect(state()).toBe('connecting');
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('1000 while the refetched run is still active → retries with the back-off', async () => {
    const { state } = setup();
    act(() => latest().open());
    act(() => latest().serverClose(1000));
    await waitFor(() => expect(state()).toBe('retrying'));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2), { timeout: TERMINAL_BACKOFF_MS[0] + 1_000 });
  });

  it('closes the socket on unmount and never reconnects after', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { hook } = setup();
    const ws = latest();
    act(() => ws.open());
    hook.unmount();
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    expect(ws.clientCloseCode).toBe(1000);
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('a pending retry is cancelled on unmount', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { hook } = setup();
    act(() => latest().serverClose(1006));
    hook.unmount();
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('closes the socket when `enabled` turns false', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { hook } = setup();
    const ws = latest();
    act(() => ws.open());
    hook.rerender({ enabled: false });
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe('useTerminalSocket', () => {
  const path = '/api/setup-tests/3f2b9c1e-0000-4000-8000-000000000001/terminal';
  const socketSetup = (onSessionEnd: () => void | Promise<boolean>) => {
    const write = vi.fn<LiveTerminalHandle['write']>();
    const term: RefObject<LiveTerminalHandle | null> = { current: { write } };
    const hook = renderHook(() => useTerminalSocket(path, true, term, onSessionEnd), {
      wrapper: wrapperFor(new QueryClient()),
    });
    return { write, hook };
  };

  it('opens the socket at the given path and writes its bytes to the terminal', () => {
    const { write, hook } = socketSetup(() => undefined);
    const ws = latest();
    expect(ws.url).toBe(`ws://${window.location.host}${path}`);
    act(() => {
      ws.open();
      ws.receive(encode('hello'));
    });
    expect(hook.result.current.state).toBe('open');
    expect(decode(write.mock.calls[0][0] as Uint8Array)).toBe('hello');
  });

  it('1000 and 4409 call onSessionEnd; the owner ending means no retry', async () => {
    const onSessionEnd = vi.fn(() => Promise.resolve(false));
    const { hook } = socketSetup(onSessionEnd);
    act(() => latest().open());
    await act(async () => latest().serverClose(1000));
    expect(onSessionEnd).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state).toBe('connecting');
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('4409 with the owner still active gives up; 1000 retries', async () => {
    const stillActive = vi.fn(() => Promise.resolve(true));
    const { hook } = socketSetup(stillActive);
    act(() => latest().open());
    await act(async () => latest().serverClose(4409));
    await waitFor(() => expect(hook.result.current.state).toBe('gave_up'));
    act(() => hook.result.current.reconnect());
    act(() => latest().open());
    await act(async () => latest().serverClose(1000));
    await waitFor(() => expect(hook.result.current.state).toBe('retrying'));
  });
});

describe('run detail terminal', () => {
  const socket = async () => {
    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
    return latest();
  };
  const liveXterm = () => FakeXterm.instances.find((t) => !t.disposed && !t.options.disableStdin);

  it('an idle run attaches: output reaches the terminal, typing sends a binary frame', async () => {
    await renderRoute(`${base}/runs/62`);
    const ws = await socket();
    expect(new URL(ws.url).pathname).toBe(terminalPathOf(62));
    act(() => {
      ws.open();
      ws.receive(encode('> waiting for you'));
    });
    const term = liveXterm();
    expect(term?.options.screenReaderMode).toBe(true);
    expect(term?.written()).toBe('> waiting for you');
    act(() => term?.type('yes\r'));
    expect(ws.binaryFrames().map(decode)).toEqual(['yes\r']);
    expect(ws.textFrames().map((f) => JSON.parse(f))).toEqual([{ type: 'resize', cols: 80, rows: 24 }]);
    expect(screen.getByRole('group', { name: 'Claude Code terminal' })).toBeInTheDocument();
  });

  it('Review Focus 4: 4409 → the run is refetched and its final scrollback shows read-only, no reconnect', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    const { queryClient } = await renderRoute(`${base}/runs/62`);
    const ws = await socket();
    act(() => ws.open());
    const byNumberGets = () => mockDb.requests('GET', `/api/projects/${projectId}/runs/62`);
    const before = byNumberGets();
    // The run ends on the server (scrollback stored), which closes the terminal with 4409.
    const r = dbRun(62);
    r.status = 'succeeded';
    r.finishedAt = new Date().toISOString();
    r.idleSince = null;
    const events = mockDb.state.runEvents[r.id] ?? [];
    events.push({
      seq: (events.at(-1)?.seq ?? 0) + 1,
      ts: r.finishedAt,
      type: 'scrollback',
      payload: { text: 'line one\nfinal line' },
    });
    mockDb.state.runEvents[r.id] = events;
    act(() => ws.serverClose(4409));

    await waitFor(() => expect(screen.getByText(/^Succeeded in /)).toBeInTheDocument());
    expect(byNumberGets()).toBeGreaterThan(before);
    await waitFor(() => expect(FakeXterm.instances.some((t) => !t.disposed && t.options.disableStdin)).toBe(true));
    const finalTerm = FakeXterm.instances.find((t) => !t.disposed && t.options.disableStdin);
    expect(finalTerm?.written()).toBe('line one\r\nfinal line');
    expect(liveXterm()).toBeUndefined();
    // Typing into the read-only terminal sends nothing anywhere.
    act(() => finalTerm?.type('x'));
    expect(ws.binaryFrames()).toEqual([]);

    // A later log reload does not write the scrollback again; nothing reconnects.
    await act(() => queryClient.invalidateQueries());
    act(() => vi.advanceTimersByTime(60_000));
    expect(finalTerm?.writes).toHaveLength(1);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('a finished run shows its stored scrollback in a read-only terminal, with no socket', async () => {
    await renderRoute(`${base}/runs/60`);
    await waitFor(() => expect(FakeXterm.instances.some((t) => !t.disposed)).toBe(true));
    const term = FakeXterm.instances.find((t) => !t.disposed);
    expect(term?.options.disableStdin).toBe(true);
    expect(term?.writes).toHaveLength(1);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('a later scrollback event replaces the read-only terminal', async () => {
    const { queryClient } = await renderRoute(`${base}/runs/60`);
    await waitFor(() => expect(FakeXterm.instances.some((t) => !t.disposed)).toBe(true));
    const first = FakeXterm.instances.find((t) => !t.disposed);
    const r = dbRun(60);
    const events = mockDb.state.runEvents[r.id] ?? [];
    events.push({
      seq: (events.at(-1)?.seq ?? 0) + 1,
      ts: new Date().toISOString(),
      type: 'scrollback',
      payload: { text: 'newer' },
    });
    await act(() => queryClient.invalidateQueries());
    await waitFor(() => expect(first?.disposed).toBe(true));
    const next = FakeXterm.instances.find((t) => !t.disposed);
    expect(next?.options.disableStdin).toBe(true);
    expect(next?.writes).toEqual(['newer']);
  });

  it.each(['queued', 'starting'] as const)('a %s run never shows the terminal-lost overlay', async (status) => {
    const r = dbRun(63);
    r.status = status;
    if (status === 'starting') r.startedAt = new Date().toISOString();
    await renderRoute(`${base}/runs/63`);
    expect(await screen.findByText('Starting the agent')).toBeInTheDocument();
    expect(screen.queryByText('Connection to the terminal lost')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reconnect now' })).not.toBeInTheDocument();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('4403 → "You can\'t open this terminal", no retry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    await renderRoute(`${base}/runs/62`);
    const ws = await socket();
    act(() => ws.serverClose(4403));
    expect(await screen.findByText("You can't open this terminal")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('after the back-off gives up, RunReconnect shows and Reconnect now attaches again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    await renderRoute(`${base}/runs/61`);
    const ws = await socket();
    act(() => ws.open());
    act(() => ws.serverClose(1006));
    // Retrying quietly: no overlay yet.
    expect(screen.queryByText('Connection to the terminal lost')).not.toBeInTheDocument();
    for (const delay of TERMINAL_BACKOFF_MS) {
      act(() => vi.advanceTimersByTime(delay));
      act(() => latest().serverClose(1006));
    }
    expect(await screen.findByText('Connection to the terminal lost')).toBeInTheDocument();
    const count = FakeWebSocket.instances.length;
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect now' }));
    expect(FakeWebSocket.instances).toHaveLength(count + 1);
    act(() => latest().open());
    await waitFor(() => expect(screen.queryByText('Connection to the terminal lost')).not.toBeInTheDocument());
  });
});
