import { focusManager } from '@tanstack/react-query';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollbackText } from '@/mocks/dto/events';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { jsonResponse, routeHandler } from '@/mocks/msw/http';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { FakeEventSource } from '@/test/fakeEventSource';
import { FakeWebSocket } from '@/test/fakeWebSocket';
import { FakeXterm } from '@/test/fakeXterm';
import { renderRoute } from '@/test/renderRoute';

const projectId = ids.project.invoicerApi;
const base = `/o/alice/p/${projectId}`;
const runId = (n: number) => ids.run(1, n);
const dbRun = (n: number) => {
  const r = mockDb.state.runs.find((x) => x.projectId === projectId && x.number === n);
  if (!r) throw new Error(`run ${n} missing`);
  return r;
};

/** Holds the route's answer until `release()`; then answers 202. */
function holdAction(key: 'runs.finish' | 'runs.cancel') {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    routeHandler(key, async () => {
      await gate;
      return jsonResponse(null, 202);
    }),
  );
  return () => release();
}

const banner = () => screen.getByRole('banner');

/** The server accepts the action (202) but the run stays as it is (the worker ends it later). */
function acceptWithoutEnding(key: 'runs.finish' | 'runs.cancel') {
  server.use(routeHandler(key, async () => jsonResponse(null, 202)));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('run detail route', () => {
  it('an idle run renders the idle state with Finish enabled', async () => {
    await renderRoute(`${base}/runs/62`);
    expect(await screen.findByText('The agent is waiting for your answer')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Run 62');
    const finish = screen.getAllByRole('button', { name: 'Finish run' });
    expect(finish).toHaveLength(2);
    for (const b of finish) expect(b).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel run' })).toBeEnabled();
    expect(screen.getByText('Waiting for you')).toBeInTheDocument();
    // In-app links carry real hrefs.
    expect(
      within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: /^Runs/ }),
    ).toHaveAttribute('href', `${base}/runs`);
  });

  it('shows the final prompt of a run behind Show, and Not recorded for an older run', async () => {
    const recorded = await renderRoute(`${base}/runs/60`);
    const show = await screen.findByRole('button', { name: 'Show' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Final prompt' })).not.toBeInTheDocument();
    await recorded.user.click(show);
    expect(await screen.findByRole('region', { name: 'Final prompt' })).toBeVisible();
    cleanup();
    await renderRoute(`${base}/runs/62`);
    expect(await screen.findByText('Not recorded')).toBeInTheDocument();
  });

  it("shows the signed-in user in the top bar and the project's run limit per ticket", async () => {
    const project = mockDb.state.projects.find((p) => p.id === projectId);
    if (!project) throw new Error('project missing');
    project.maxRunsPerTicket = 7;
    await renderRoute(`${base}/runs/62`);
    expect(await screen.findByText('max 7 runs')).toBeInTheDocument();
    expect(within(banner()).getByText('AL')).toBeInTheDocument();
    expect(within(banner()).queryByText('KH')).not.toBeInTheDocument();
  });

  it('Finish posts and shows "Finishing…" on the run until the server answers', async () => {
    const release = holdAction('runs.finish');
    const { user } = await renderRoute(`${base}/runs/62`);
    const [topFinish] = await screen.findAllByRole('button', { name: 'Finish run' });
    if (!topFinish) throw new Error('no Finish button');
    await user.click(topFinish);
    expect(await within(banner()).findByText('Finishing…')).toBeInTheDocument();
    await waitFor(() => expect(mockDb.requests('POST', `/api/runs/${runId(62)}/finish`)).toBe(1));
    // A second click while it is in flight sends nothing.
    for (const b of screen.getAllByRole('button', { name: 'Finish run' })) expect(b).toBeDisabled();

    dbRun(62).status = 'succeeded';
    dbRun(62).finishedAt = new Date().toISOString();
    release();
    expect(await screen.findByText(/^Succeeded in /)).toBeInTheDocument();
    expect(within(banner()).queryByText('Finishing…')).not.toBeInTheDocument();
    expect(mockDb.requests('POST', `/api/runs/${runId(62)}/finish`)).toBe(1);
  });

  it('Finish marks the run in the cached runs lists too', async () => {
    const release = holdAction('runs.finish');
    const { user, router } = await renderRoute(`${base}/runs`);
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    await router.navigate({ to: `${base}/runs/62` });
    const [topFinish] = await screen.findAllByRole('button', { name: 'Finish run' });
    if (!topFinish) throw new Error('no Finish button');
    await user.click(topFinish);
    await within(banner()).findByText('Finishing…');
    await router.navigate({ to: `${base}/runs` });
    expect(await screen.findByText('Finishing…')).toBeInTheDocument();
    release();
  });

  it('cancel answered 409: the note goes away and the problem title is toasted', async () => {
    const { user } = await renderRoute(`${base}/runs/61`, {
      scenario: () => scenarios.problem('runs.cancel', { status: 409, title: 'Run already ended' }),
    });
    await user.click(await screen.findByRole('button', { name: 'Cancel run' }));
    // The refetch after the error is held back: the note must go by the rollback, not by fresh data.
    server.use(routeHandler('runs.byNumber', () => new Promise<Response>(() => {})));
    const dialog = screen.getByRole('dialog', { name: 'Cancel run 61?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel run' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Run already ended');
    expect(within(banner()).queryByText('Cancelling…')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel run' })).toBeEnabled();
  });

  it('cancel confirmed: posts, the run ends as cancelled after the refetch', async () => {
    const { user } = await renderRoute(`${base}/runs/61`);
    await user.click(await screen.findByRole('button', { name: 'Cancel run' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel run' }));
    expect(await screen.findByText(/^Cancelled at /)).toBeInTheDocument();
    expect(mockDb.requests('POST', `/api/runs/${runId(61)}/cancel`)).toBe(1);
  });

  it('Keep running closes the confirmation without posting', async () => {
    const { user } = await renderRoute(`${base}/runs/61`);
    await user.click(await screen.findByRole('button', { name: 'Cancel run' }));
    await user.click(screen.getByRole('button', { name: 'Keep running' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockDb.requests('POST', `/api/runs/${runId(61)}/cancel`)).toBe(0);
  });

  it('a succeeded run shows its stored scrollback from the run log, read-only', async () => {
    await renderRoute(`${base}/runs/60`);
    expect(await screen.findByText(/^Succeeded in /)).toBeInTheDocument();
    // The live terminal (xterm, faked in tests), read-only, with the stored scrollback written once.
    const terminal = await screen.findByRole('group', { name: 'Claude Code terminal' });
    const term = FakeXterm.latest();
    expect(terminal).toContainElement(term.element ?? null);
    expect(term.options.disableStdin).toBe(true);
    expect(term.writes).toEqual([scrollbackText(60)?.replace(/\n/g, '\r\n')]);
    expect(screen.getByRole('tab', { name: /Final scrollback/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
    expect(mockDb.requests('GET', `/api/runs/${runId(60)}/log`)).toBe(1);
  });

  it('scrollback text stays text', async () => {
    const events = mockDb.state.runEvents[runId(60)] ?? [];
    for (const e of events) if (e.type === 'scrollback') e.payload = { text: '<img src=x onerror=alert(1)>' };
    await renderRoute(`${base}/runs/60`);
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('an unknown run number is not found', async () => {
    await renderRoute(`${base}/runs/999`);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('a run number that is not a number is not found', async () => {
    await renderRoute(`${base}/runs/abc`);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it("another org's run (the API answers 404) is not found", async () => {
    await renderRoute(`${base}/runs/62`, {
      scenario: () => scenarios.problem('runs.byNumber', { status: 404, title: 'Run not found' }),
    });
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  describe('accepted (202) while the run is still active', () => {
    const finishPosts = () => mockDb.requests('POST', `/api/runs/${runId(62)}/finish`);
    const byNumberGets = () => mockDb.requests('GET', `/api/projects/${projectId}/runs/62`);

    async function finishAccepted() {
      acceptWithoutEnding('runs.finish');
      const rendered = await renderRoute(`${base}/runs/62`);
      const [topFinish] = await screen.findAllByRole('button', { name: 'Finish run' });
      if (!topFinish) throw new Error('no Finish button');
      const before = byNumberGets();
      await rendered.user.click(topFinish);
      // The settle refetch has landed: the run is still idle.
      await waitFor(() => expect(byNumberGets()).toBeGreaterThan(before));
      await waitFor(() => expect(rendered.queryClient.isFetching()).toBe(0));
      return rendered;
    }

    it('keeps "Finishing…" after the settle refetch, buttons held, no second POST', async () => {
      const { user } = await finishAccepted();
      expect(within(banner()).getByText('Finishing…')).toBeInTheDocument();
      expect(screen.getByText('The agent is waiting for your answer')).toBeInTheDocument();
      const buttons = screen.getAllByRole('button', { name: 'Finish run' });
      for (const b of buttons) expect(b).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel run' })).toBeDisabled();
      for (const b of buttons) await user.click(b);
      expect(finishPosts()).toBe(1);
    });

    it('drops the note once a refetch brings the final status', async () => {
      const { queryClient } = await finishAccepted();
      dbRun(62).status = 'succeeded';
      dbRun(62).finishedAt = new Date().toISOString();
      await act(() => queryClient.invalidateQueries());
      expect(await screen.findByText(/^Succeeded in /)).toBeInTheDocument();
      expect(within(banner()).queryByText('Finishing…')).not.toBeInTheDocument();
      // The log is refetched with the run, so the stored scrollback of the final run can load.
      expect(mockDb.requests('GET', `/api/runs/${runId(62)}/log`)).toBeGreaterThan(1);
    });

    it('keeps the note through a window-focus refetch', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] });
      await finishAccepted();
      const before = byNumberGets();
      // Past the 30 s stale time, then the window regains focus.
      vi.setSystemTime(Date.now() + 60_000);
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await waitFor(() => expect(byNumberGets()).toBeGreaterThan(before));
      await waitFor(() => expect(within(banner()).getByText('Finishing…')).toBeInTheDocument());
      for (const b of screen.getAllByRole('button', { name: 'Finish run' })) expect(b).toBeDisabled();
      act(() => focusManager.setFocused(undefined));
    });
  });
});

describe('run detail route, failed in setup', () => {
  it('shows "Setup failed" and the setup version, with a null start time (no NaN)', async () => {
    // Started_at is set when the session starts, so the run has none.
    Object.assign(dbRun(60), {
      status: 'failed',
      startedAt: null,
      exitCode: 1,
      failureReason: 'setup failed (exit 1)',
      failureStage: 'setup',
      setupScriptVersion: 5,
    });
    await renderRoute(`${base}/runs/60`);
    expect(await screen.findAllByText('Setup failed')).not.toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Version 5' })).toHaveAttribute('href', `${base}/desk/setup`);
    expect(screen.getByText(/The agent did not start\. Setup version 5/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open workspace setup' })).toHaveAttribute('href', `${base}/desk/setup`);
    expect(document.body.textContent).not.toMatch(/NaN|Invalid/);
  });
});

describe('run detail route, paused runs and kept sessions', () => {
  const PAUSED = 64;
  const KEPT = 65;
  const EXPIRED = 66;
  const resumePosts = (n: number) => mockDb.requests('POST', `/api/runs/${runId(n)}/resume`);

  /** Holds the resume answer until `release()`, then 204. */
  function holdResume() {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      routeHandler('runs.resume', async () => {
        await gate;
        return jsonResponse(null, 204);
      }),
    );
    return () => release();
  }

  it('a paused run shows the note, how long it can be resumed, when it paused, Resume and Finish', async () => {
    await renderRoute(`${base}/runs/${PAUSED}`);
    expect(await within(banner()).findByText('Paused')).toBeInTheDocument();
    expect(screen.getByText(/^Paused: waiting for your answer\. Can be resumed for \d+ days?\.$/)).toBeInTheDocument();
    expect(screen.getByText('Should the export include voided invoices?')).toBeInTheDocument();
    expect(screen.getByText(/^Paused .*, after 30 min with nobody attached$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
    expect(screen.queryByText('Re-open session')).not.toBeInTheDocument();
  });

  it('Resume posts once and the page then shows Queued', async () => {
    const { user } = await renderRoute(`${base}/runs/${PAUSED}`);
    await user.click(await screen.findByRole('button', { name: 'Resume' }));
    expect(await within(banner()).findByText('Queued')).toBeInTheDocument();
    expect(resumePosts(PAUSED)).toBe(1);
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Can be resumed for/)).not.toBeInTheDocument();
  });

  it('while the resume request is in flight both buttons are disabled and nothing more is sent', async () => {
    const release = holdResume();
    const { user } = await renderRoute(`${base}/runs/${PAUSED}`);
    const resume = await screen.findByRole('button', { name: 'Resume' });
    await user.click(resume);
    await waitFor(() => expect(resume).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled();
    await user.click(resume);
    expect(resumePosts(PAUSED)).toBe(1);
    release();
  });

  it('a 409 shows the server message in a toast and the button works again', async () => {
    const { user } = await renderRoute(`${base}/runs/${PAUSED}`, {
      scenario: () => scenarios.problem('runs.resume', { status: 409, title: 'This run is already being resumed' }),
    });
    const resume = await screen.findByRole('button', { name: 'Resume' });
    await user.click(resume);
    expect(await screen.findByRole('alert')).toHaveTextContent('This run is already being resumed');
    await waitFor(() => expect(resume).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled();
  });

  it('Finish on a paused run posts to finish', async () => {
    const { user } = await renderRoute(`${base}/runs/${PAUSED}`);
    await user.click(await screen.findByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(mockDb.requests('POST', `/api/runs/${runId(PAUSED)}/finish`)).toBe(1));
  });

  it('a succeeded run with a kept session shows when it is kept until and Re-open session', async () => {
    const { user } = await renderRoute(`${base}/runs/${KEPT}`);
    expect(await screen.findByText(/^Session kept until /)).toBeInTheDocument();
    expect(screen.getByText('Opened PR #148 with the CSV export and tests.')).toBeInTheDocument();
    expect(within(banner()).getByText('Succeeded')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Re-open session' }));
    expect(await within(banner()).findByText('Queued')).toBeInTheDocument();
    expect(resumePosts(KEPT)).toBe(1);
    expect(screen.queryByRole('button', { name: 'Re-open session' })).not.toBeInTheDocument();
  });

  it('a succeeded run whose kept time has passed has no Re-open session', async () => {
    dbRun(KEPT).sessionExpiresAt = new Date(Date.now() - 60_000).toISOString();
    await renderRoute(`${base}/runs/${KEPT}`);
    expect(await screen.findByText(/^Succeeded in /)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Re-open session' })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Session kept until /)).not.toBeInTheDocument();
  });

  it('the Re-open session button goes away when the kept time passes while the page is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date', 'setInterval', 'clearInterval'] });
    dbRun(KEPT).sessionExpiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    await renderRoute(`${base}/runs/${KEPT}`);
    expect(await screen.findByRole('button', { name: 'Re-open session' })).toBeInTheDocument();
    await act(async () => {
      vi.setSystemTime(Date.now() + 11 * 60_000);
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.queryByRole('button', { name: 'Re-open session' })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Session kept until /)).not.toBeInTheDocument();
  });

  it('an expired run shows the expired line and no action buttons', async () => {
    await renderRoute(`${base}/runs/${EXPIRED}`);
    expect(await within(banner()).findByText('Expired')).toBeInTheDocument();
    expect(
      screen.getByText('Nobody resumed this run within 7 days. The saved session was deleted.'),
    ).toBeInTheDocument();
    for (const name of ['Resume', 'Re-open session', 'Finish', 'Finish run', 'Cancel run']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('a resume_failed event (then the park comment) shows the error banner above the buttons', async () => {
    const events = mockDb.state.runEvents[runId(PAUSED)] ?? [];
    events.push({
      seq: (events.at(-1)?.seq ?? 0) + 1,
      ts: new Date().toISOString(),
      type: 'lifecycle',
      payload: { kind: 'resume_failed', reason: 'no saved session was found' },
    });
    // As on a real run, the park's ticket comment is the newest event.
    events.push({
      seq: (events.at(-1)?.seq ?? 0) + 1,
      ts: new Date().toISOString(),
      type: 'comment',
      payload: { kind: 'paused', commentId: 'c1' },
    });
    mockDb.state.runEvents[runId(PAUSED)] = events;
    await renderRoute(`${base}/runs/${PAUSED}`);
    const alert = await screen.findByText('Resume failed: no saved session was found');
    const resume = screen.getByRole('button', { name: 'Resume' });
    expect(alert.compareDocumentPosition(resume) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(resume).toBeEnabled();
  });

  it('shows the stored scrollback of a paused run, read-only', async () => {
    const events = mockDb.state.runEvents[runId(PAUSED)] ?? [];
    events.push({
      seq: (events.at(-1)?.seq ?? 0) + 1,
      ts: new Date().toISOString(),
      type: 'scrollback',
      payload: { text: 'paused scrollback' },
    });
    mockDb.state.runEvents[runId(PAUSED)] = events;
    await renderRoute(`${base}/runs/${PAUSED}`);
    await screen.findByRole('group', { name: 'Claude Code terminal' });
    const term = FakeXterm.latest();
    expect(term.options.disableStdin).toBe(true);
    expect(term.writes).toEqual(['paused scrollback']);
  });
});

describe('run detail route, pausing, pause reasons and resumed runs', () => {
  const IDLE = 62;
  const PAUSED = 64;
  const SUCCEEDED = 60;
  const QUEUED = 63;
  const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
  const pushEvent = (
    n: number,
    type: 'status' | 'lifecycle' | 'comment' | 'scrollback',
    payload: Record<string, unknown>,
  ) => {
    const r = dbRun(n);
    const events = mockDb.state.runEvents[r.id] ?? [];
    events.push({ seq: (events.at(-1)?.seq ?? 0) + 1, ts: iso(), type, payload });
    mockDb.state.runEvents[r.id] = events;
  };
  const runStream = (n: number) => {
    const source = FakeEventSource.matching(`/api/runs/${runId(n)}/events`).at(-1);
    if (!source) throw new Error(`no stream for run ${n}`);
    return source;
  };

  it('a run whose session is ending says it is pausing: no terminal, no terminal socket', async () => {
    dbRun(IDLE).sessionEndingAt = iso(-5_000);
    await renderRoute(`${base}/runs/${IDLE}`);
    expect(await screen.findByText('Session ending…')).toBeInTheDocument();
    expect(screen.getByText('Ending…')).toBeInTheDocument();
    expect(screen.queryByText('The agent is waiting for your answer')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Claude Code terminal' })).not.toBeInTheDocument();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('a pausing run shows its last scrollback greyed, as text, and opens no socket', async () => {
    dbRun(IDLE).sessionEndingAt = iso(-5_000);
    pushEvent(IDLE, 'scrollback', { text: 'line one\n<b>line two</b>' });
    await renderRoute(`${base}/runs/${IDLE}`);
    await screen.findByText('Session ending…');
    const log = await screen.findByRole('log');
    expect(log).toHaveTextContent('line one');
    expect(log).toHaveTextContent('<b>line two</b>');
    expect(log.querySelector('b')).toBeNull();
    expect(log.className).toMatch(/dimmed/);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('pausing turns into paused from the run stream, with the reason, and still no socket', async () => {
    dbRun(IDLE).sessionEndingAt = iso(-5_000);
    await renderRoute(`${base}/runs/${IDLE}`);
    await screen.findByText('Session ending…');
    act(() =>
      runStream(IDLE).emit(
        'status',
        {
          runId: runId(IDLE),
          number: IDLE,
          status: 'paused',
          seq: 900,
          exitCode: null,
          failureReason: null,
          waitingOn: null,
          agentNote: 'Which database?',
          pausedAt: iso(),
          sessionExpiresAt: iso(6 * 24 * 3_600_000 + 3_600_000),
          sessionEndingAt: null,
          pauseReason: 'pod_lost',
        },
        900,
      ),
    );
    expect(await screen.findByText('Paused: waiting for your answer. Can be resumed for 6 days.')).toBeInTheDocument();
    expect(screen.getByText(/the pod stopped unexpectedly \(out of memory \/ evicted\)$/)).toBeInTheDocument();
    expect(screen.queryByText('Session ending…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('a 4410 on the open terminal shows pausing once the run is refetched, and the socket is not reopened', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    await renderRoute(`${base}/runs/${IDLE}`);
    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
    const ws = FakeWebSocket.latest();
    act(() => ws.open());
    dbRun(IDLE).sessionEndingAt = iso();
    act(() => ws.serverClose(4410));
    expect(await screen.findByText('Session ending…')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('a paused run by a lost pod gives its reason and can be resumed', async () => {
    dbRun(PAUSED).pauseReason = 'pod_lost';
    await renderRoute(`${base}/runs/${PAUSED}`);
    expect(
      await screen.findByText(/^Paused .*, the pod stopped unexpectedly \(out of memory \/ evicted\)$/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled();
  });

  it('a paused run whose agent crashed: the exit code from the stored end line, and Resume', async () => {
    dbRun(PAUSED).pauseReason = 'agent_crashed';
    pushEvent(PAUSED, 'lifecycle', { line: 31, kind: 'session_ended', reason: 'agent_exit', code: 2 });
    await renderRoute(`${base}/runs/${PAUSED}`);
    expect(await screen.findByText('Paused: agent crashed (exit code 2)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled();
  });

  it('a crashed run with a malformed end event: the text without a number, no page error', async () => {
    dbRun(PAUSED).pauseReason = 'agent_crashed';
    pushEvent(PAUSED, 'lifecycle', { line: 31, kind: 'session_ended', reason: 'agent_exit', code: '<b>9</b>' });
    await renderRoute(`${base}/runs/${PAUSED}`);
    expect(await screen.findByText('Paused: agent crashed')).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('<b>9</b>');
  });

  it('a resumed idle run: the live terminal with the resumed banner and the agent note', async () => {
    const r = dbRun(IDLE);
    r.agentNote = 'Should the export include voided invoices?';
    pushEvent(IDLE, 'status', { status: 'paused' });
    pushEvent(IDLE, 'status', { status: 'queued' });
    await renderRoute(`${base}/runs/${IDLE}`);
    expect(
      await screen.findByText(
        'Resumed. The agent asked: Should the export include voided invoices?. Background tasks and sub-agents that were running when it paused were stopped.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
    expect(screen.getAllByRole('button', { name: 'Finish run' }).length).toBeGreaterThan(0);
  });

  it('a run that was never parked has no resumed banner', async () => {
    await renderRoute(`${base}/runs/${IDLE}`);
    await screen.findByText('The agent is waiting for your answer');
    expect(screen.queryByText(/^Resumed\./)).not.toBeInTheDocument();
  });

  it('a queued run that was parked before says it is resuming', async () => {
    pushEvent(QUEUED, 'status', { status: 'paused' });
    pushEvent(QUEUED, 'status', { status: 'queued' });
    await renderRoute(`${base}/runs/${QUEUED}`);
    expect(await screen.findByText('Resuming the run')).toBeInTheDocument();
    expect(screen.queryByText('Starting the agent')).not.toBeInTheDocument();
  });

  it('a queued Resume that had nothing kept to resume from: the person sees the message on the succeeded run', async () => {
    pushEvent(SUCCEEDED, 'lifecycle', {
      kind: 'resume_failed',
      reason: 'nothing was kept to resume from',
      text: 'The resume could not run: nothing was kept to resume from.',
    });
    // The park then posts the finish comment: it is the newest event on a real run.
    pushEvent(SUCCEEDED, 'comment', { kind: 'finish', commentId: 'c1' });
    await renderRoute(`${base}/runs/${SUCCEEDED}`);
    expect(await screen.findByText('Resume failed: nothing was kept to resume from')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Re-open session' })).not.toBeInTheDocument();
  });
});
