import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { scrollbackText } from '@/mocks/dto/events';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { jsonResponse, routeHandler } from '@/mocks/msw/http';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
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

describe('run detail route', () => {
  it('an idle run renders the idle state with Finish enabled', async () => {
    await renderRoute(`${base}/runs/62`);
    expect(await screen.findByText('The agent finished its turn and is waiting for you')).toBeInTheDocument();
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
    const log = screen.getByRole('log', { name: 'Claude Code terminal' });
    const lastLine = scrollbackText(60)?.split('\n').at(-1);
    expect(lastLine).toBeTruthy();
    expect(within(log).getByText(lastLine ?? '')).toBeInTheDocument();
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
});
