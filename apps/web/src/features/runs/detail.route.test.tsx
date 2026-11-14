import { focusManager } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollbackText } from '@/mocks/dto/events';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { jsonResponse, routeHandler } from '@/mocks/msw/http';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
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
