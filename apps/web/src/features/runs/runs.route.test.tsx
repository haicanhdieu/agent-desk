import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

const projectId = ids.project.invoicerApi;
const base = `/o/alice/p/${projectId}`;
const runsApi = `/api/projects/${projectId}/runs`;
const ticket12Ref = 'harbor-labs/invoicer-api#12';

/** Records the query strings of GET /runs requests. */
function captureRunListQueries() {
  const queries: string[] = [];
  const listener = ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === runsApi) queries.push(url.search);
  };
  server.events.on('request:start', listener);
  stopCapture = () => server.events.removeListener('request:start', listener);
  return queries;
}
let stopCapture: (() => void) | undefined;
afterEach(() => {
  stopCapture?.();
  stopCapture = undefined;
});

const runNumbers = () =>
  screen.queryAllByRole('link', { name: /^Run \d+$/ }).map((a) => Number((a.textContent ?? '').replace('Run ', '')));
const chips = () => screen.getByRole('group', { name: 'Filter by status' });

describe('runs route', () => {
  it('lists every run grouped by ticket, newest group first, with counts on the chips', async () => {
    await renderRoute(`${base}/runs`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Runs' })).toBeInTheDocument();
    expect(runNumbers().sort((a, b) => a - b)).toEqual([52, 54, 55, 56, 57, 60, 61, 62, 63]);
    // Groups by newest run: #151 (63), PR #148 (62), #139 (61), #142 (60), PR #133 (57), ...
    expect(runNumbers().slice(0, 4)).toEqual([63, 62, 61, 60]);
    expect(screen.getByRole('link', { name: 'Run 62' })).toHaveAttribute('href', `${base}/runs/62`);
    expect(within(chips()).getByRole('link', { name: /^All/ })).toHaveTextContent('9');
    expect(within(chips()).getByRole('link', { name: /^All/ })).toHaveAttribute('aria-current', 'page');
    expect(within(chips()).getByRole('link', { name: /^Needs you/ })).toHaveAttribute(
      'href',
      `${base}/runs?filter=needs_you`,
    );
    expect(screen.getByRole('link', { name: /^Ignored/ })).toHaveTextContent('5');
    expect(screen.getByText('Run 62 needs you.')).toBeInTheDocument();
    expect(screen.getByText('Waiting for a slot')).toBeInTheDocument();
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
  });

  it('?filter=needs_you requests filter=needs_you and shows only idle runs', async () => {
    const queries = captureRunListQueries();
    await renderRoute(`${base}/runs?filter=needs_you`);
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    expect(queries.some((q) => new URLSearchParams(q).get('filter') === 'needs_you')).toBe(true);
    expect(runNumbers()).toEqual([62]);
    expect(within(chips()).getByRole('link', { name: /^Needs you/ })).toHaveAttribute('aria-current', 'page');
  });

  it('?filter=bogus falls back to all', async () => {
    const { router } = await renderRoute(`${base}/runs?filter=bogus`);
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    expect(runNumbers()).toHaveLength(9);
    expect(within(chips()).getByRole('link', { name: /^All/ })).toHaveAttribute('aria-current', 'page');
    expect(router.state.location.search).toEqual({});
  });

  it('?filter=ignored shows the ignored commands with their reasons and the connection warning', async () => {
    await renderRoute(`${base}/runs?filter=ignored`);
    expect(await screen.findByRole('heading', { level: 2, name: 'Ignored commands' })).toBeInTheDocument();
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(5);
    expect(within(rows[0] as HTMLElement).getByText('Not a collaborator')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('/code-build')).toBeInTheDocument();
    expect(screen.getByText('Ticket reached its run limit')).toBeInTheDocument();
    expect(screen.getByText('Same skill already running')).toBeInTheDocument();
    expect(screen.getByText("Ticket labels don't match")).toBeInTheDocument();
    expect(screen.getByText('No rule for this command')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Ignored/ })).toHaveAttribute('aria-current', 'page');
    // invoicer-api's webhook is healthy: no banner.
    expect(screen.queryByText(/No webhooks from GitHub/)).not.toBeInTheDocument();
  });

  it('shows the silent-webhook warning on the problems view of a silent project', async () => {
    const docs = ids.project.docsSite;
    await renderRoute(`/o/alice/p/${docs}/runs?filter=ignored`);
    expect(await screen.findByText(/^No webhooks from GitHub since/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Switch to polling' })).toHaveAttribute(
      'href',
      `/o/alice/p/${docs}/desk/agent`,
    );
  });

  it('clicking a filter chip gives a clean URL that the route reads back', async () => {
    const { router, user } = await renderRoute(`${base}/runs`);
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    await user.click(within(chips()).getByRole('link', { name: /^Queued/ }));
    await waitFor(() => expect(router.state.location.searchStr).toBe('?filter=queued'));
    expect(router.state.location.search).toEqual({ filter: 'queued' });
    await waitFor(() => expect(runNumbers()).toEqual([63]));
  });

  it('?ticket=12 stays a plain number-like string in hrefs and URL, and narrows the list', async () => {
    mockDb.state.runs = mockDb.state.runs.map((r) =>
      r.number === 55 || r.number === 57 ? { ...r, ticket: { ...r.ticket, number: 12, ref: ticket12Ref } } : r,
    );
    const { router, user } = await renderRoute(`${base}/runs?ticket=12`);
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    expect(router.state.location.search).toEqual({ ticket: '12' });
    expect(runNumbers().sort((a, b) => a - b)).toEqual([55, 57]);
    const ended = within(chips()).getByRole('link', { name: /^Ended/ });
    expect(ended).toHaveAttribute('href', `${base}/runs?filter=ended&ticket=12`);
    await user.click(ended);
    await waitFor(() => expect(router.state.location.searchStr).toBe('?filter=ended&ticket=12'));
    expect(router.state.location.search).toEqual({ filter: 'ended', ticket: '12' });
    expect(router.state.location.href).not.toContain('%22');
  });

  it('?filter=active lists every active run, idle included, matching its chip count', async () => {
    await renderRoute(`${base}/runs?filter=active`);
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    expect(runNumbers().sort((a, b) => a - b)).toEqual([61, 62]);
    expect(within(chips()).getByRole('link', { name: /^Active/ })).toHaveTextContent('2');
  });

  it('runs used per ticket count every run of the ticket, not only the filtered ones', async () => {
    const issue131 = mockDb.state.runs.find((r) => r.number === 55)?.ticket;
    if (!issue131) throw new Error('run 55 fixture missing');
    mockDb.state.runs = mockDb.state.runs.map((r) => (r.number === 63 ? { ...r, ticket: issue131 } : r));
    await renderRoute(`${base}/runs?filter=queued`);
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    expect(runNumbers()).toEqual([63]);
    expect(screen.getByText('2 of 10 runs')).toBeInTheDocument();
  });

  describe('with more runs than one API page', () => {
    // 120 newer runs on their own tickets, and ticket 12's two runs as the oldest (numbers 1 and 2).
    function seedMany() {
      const template = mockDb.state.runs.find((r) => r.number === 60);
      if (!template) throw new Error('run 60 fixture missing');
      const extra = Array.from({ length: 120 }, (_, i) => ({
        ...template,
        id: ids.run(1, 100 + i),
        number: 100 + i,
        ticket: { ...template.ticket, number: 500 + i, ref: `harbor-labs/invoicer-api#${500 + i}` },
      }));
      const old = [1, 2].map((n) => ({
        ...template,
        id: ids.run(1, n),
        number: n,
        ticket: { ...template.ticket, number: 12, ref: ticket12Ref },
      }));
      mockDb.state.runs = [...mockDb.state.runs, ...extra, ...old];
    }

    it('"All" lists and counts every run, following the cursor', async () => {
      seedMany();
      await renderRoute(`${base}/runs`);
      await screen.findByRole('heading', { level: 1, name: 'Runs' });
      expect(runNumbers()).toHaveLength(9 + 120 + 2);
      expect(within(chips()).getByRole('link', { name: /^All/ })).toHaveTextContent('131');
      expect(within(chips()).getByRole('link', { name: /^Ended/ })).toHaveTextContent(String(6 + 122));
    });

    it('?ticket= asks the server for the ticket ref and finds its oldest runs', async () => {
      seedMany();
      const queries = captureRunListQueries();
      await renderRoute(`${base}/runs?ticket=12`);
      await screen.findByRole('heading', { level: 1, name: 'Runs' });
      expect(runNumbers()).toEqual([1, 2]);
      expect(queries.some((q) => new URLSearchParams(q).get('ticket') === ticket12Ref)).toBe(true);
      expect(screen.getByText('2 of 10 runs')).toBeInTheDocument();
    });
  });

  it('shows the empty state when no run matches', async () => {
    mockDb.state.runs = mockDb.state.runs.filter((r) => r.projectId !== projectId);
    await renderRoute(`${base}/runs?filter=queued`);
    expect(await screen.findByRole('heading', { name: 'No runs match this filter' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show all runs' })).toHaveAttribute('href', `${base}/runs`);
  });

  it('shows an error with retry when the list fails', async () => {
    scenarios.serverError('runs.list');
    await renderRoute(`${base}/runs`);
    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

describe('needs-you route', () => {
  it('lists idle runs linking to /runs/<number>', async () => {
    const queries = captureRunListQueries();
    await renderRoute(`${base}/needs-you`);
    const link = await screen.findByRole('link', { name: 'Open run 62 in Agent Desk' });
    expect(link).toHaveAttribute('href', `${base}/runs/62`);
    expect(screen.getByText('Run 62 needs you')).toBeInTheDocument();
    expect(screen.getByText('(1) Needs you, invoicer-api')).toBeInTheDocument();
    expect(queries.some((q) => new URLSearchParams(q).get('filter') === 'needs_you')).toBe(true);
  });

  it('lists every idle run', async () => {
    mockDb.state.runs = mockDb.state.runs.map((r) => (r.number === 61 ? { ...r, status: 'idle' } : r));
    await renderRoute(`${base}/needs-you`);
    expect(await screen.findByRole('link', { name: 'Open run 61 in Agent Desk' })).toHaveAttribute(
      'href',
      `${base}/runs/61`,
    );
    expect(screen.getByRole('link', { name: 'Open run 62 in Agent Desk' })).toHaveAttribute('href', `${base}/runs/62`);
  });

  it('says so when no run needs you', async () => {
    mockDb.state.runs = mockDb.state.runs.filter((r) => r.status !== 'idle');
    await renderRoute(`${base}/needs-you`);
    expect(await screen.findAllByText('No runs need you right now.')).not.toHaveLength(0);
    expect(screen.queryByRole('link', { name: /^Open run/ })).not.toBeInTheDocument();
  });
});
