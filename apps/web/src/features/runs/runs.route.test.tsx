import type { RunDto, RunStatsDto } from '@agentdesk/contracts';
import { focusManager } from '@tanstack/react-query';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { runFixtures } from '@/mocks/dto/runs';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

const projectId = ids.project.invoicerApi;
const base = `/o/alice/p/${projectId}`;
const runsApi = `/api/projects/${projectId}/runs`;
const ticket12Ref = '12';

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
  localStorage.clear();
});

const runNumbers = () =>
  screen.queryAllByRole('link', { name: /^Run \d+$/ }).map((a) => Number((a.textContent ?? '').replace('Run ', '')));
const chips = () => screen.getByRole('group', { name: 'Filter by status' });

describe('runs route', () => {
  it('lists every run grouped by ticket, newest group first, with counts on the chips', async () => {
    await renderRoute(`${base}/runs`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Runs' })).toBeInTheDocument();
    expect(runNumbers().sort((a, b) => a - b)).toEqual([52, 54, 55, 56, 57, 60, 61, 62, 63, 64, 65, 66]);
    // Groups by newest run: #152 (66), #151 (65), #150 (64), #151 (63), PR #148 (62), #139 (61), ...
    expect(runNumbers().slice(0, 6)).toEqual([66, 65, 64, 63, 62, 61]);
    expect(screen.getByRole('link', { name: 'Run 62' })).toHaveAttribute('href', `${base}/runs/62`);
    expect(within(chips()).getByRole('link', { name: /^All/ })).toHaveTextContent('12');
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

  describe('numbers served by runs.stats', () => {
    const idle62 = runFixtures.find((r) => r.projectId === projectId && r.number === 62);
    if (!idle62) throw new Error('run 62 fixture missing');
    // Numbers that the nine listed runs cannot add up to, and an idle run that is not on the list.
    const stats: RunStatsDto = {
      counts: { needs_you: 1, active: 2, queued: 1, ended: 59, all: 63, ignored: 3 },
      today: { total: 9, failed: 1 },
      idleRun: { ...idle62, number: 70, ticketRunCount: 1 },
      nextQueuedNumber: 63,
    };

    it('feeds the chips, the Today line and the banner, whatever the list holds', async () => {
      mockDb.state.runs = mockDb.state.runs.filter((r) => ![64, 65, 66].includes(r.number));
      server.use(http.get(`*${runsApi}/stats`, () => HttpResponse.json(stats)));
      await renderRoute(`${base}/runs`);
      await screen.findByRole('heading', { level: 1, name: 'Runs' });
      expect(runNumbers()).toHaveLength(9);
      const chip = (name: RegExp) => within(chips()).getByRole('link', { name });
      expect(chip(/^Needs you/)).toHaveTextContent('1');
      expect(chip(/^Active/)).toHaveTextContent('2');
      expect(chip(/^Queued/)).toHaveTextContent('1');
      expect(chip(/^Ended/)).toHaveTextContent('59');
      expect(chip(/^All/)).toHaveTextContent('63');
      expect(screen.getByRole('link', { name: /^Ignored/ })).toHaveTextContent('3');
      expect(screen.getByText('Today: 9 runs, 1 failed')).toBeInTheDocument();
      expect(screen.getByText('Run 70 needs you.')).toBeInTheDocument();
      expect(screen.getByText(/so Run 63 is waiting/)).toBeInTheDocument();
    });

    it('queued runs but no idle run: the banner says the next queued run is waiting and names no idle run', async () => {
      server.use(
        http.get(`*${runsApi}/stats`, () => HttpResponse.json({ ...stats, idleRun: null, nextQueuedNumber: 63 })),
      );
      await renderRoute(`${base}/runs`);
      await screen.findByRole('heading', { level: 1, name: 'Runs' });
      expect(await screen.findByText('Run 63 is waiting for a free slot.')).toBeInTheDocument();
      expect(screen.queryByText(/needs you\./)).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Answer in terminal' })).not.toBeInTheDocument();
    });

    it('no idle run and no queued run: no banner', async () => {
      server.use(
        http.get(`*${runsApi}/stats`, () => HttpResponse.json({ ...stats, idleRun: null, nextQueuedNumber: null })),
      );
      await renderRoute(`${base}/runs`);
      await screen.findByRole('heading', { level: 1, name: 'Runs' });
      expect(screen.queryByText(/is waiting for a free slot/)).not.toBeInTheDocument();
      expect(screen.queryByText(/needs you\./)).not.toBeInTheDocument();
    });

    it('asks for the stats of the local day and for no unfiltered list or ignored events on another chip', async () => {
      const queries = captureRunListQueries();
      const statsQueries: string[] = [];
      const listener = ({ request }: { request: Request }) => {
        const url = new URL(request.url);
        if (url.pathname === `${runsApi}/stats`) statsQueries.push(url.search);
      };
      server.events.on('request:start', listener);
      try {
        await renderRoute(`${base}/runs?filter=queued`);
        await screen.findByRole('heading', { level: 1, name: 'Runs' });
      } finally {
        server.events.removeListener('request:start', listener);
      }
      const since = new URLSearchParams(statsQueries[0]).get('since');
      expect(since).toBe(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).toISOString());
      expect(queries.map((q) => new URLSearchParams(q).get('filter'))).toEqual(['queued']);
      expect(mockDb.requests('GET', `/api/projects/${projectId}/ignored`)).toBe(0);
    });

    it('loads the ignored events, and no run list, only on the Ignored chip', async () => {
      const queries = captureRunListQueries();
      await renderRoute(`${base}/runs?filter=ignored`);
      expect(await screen.findByRole('heading', { level: 2, name: 'Ignored commands' })).toBeInTheDocument();
      expect(mockDb.requests('GET', `/api/projects/${projectId}/ignored`)).toBe(1);
      expect(queries).toEqual([]);
    });
  });

  it('remembers the Grouped by ticket choice after the page is reloaded', async () => {
    const first = await renderRoute(`${base}/runs`);
    const toggle = () => screen.findByRole('button', { name: 'Grouped by ticket' });
    expect(await toggle()).toHaveAttribute('aria-pressed', 'true');
    await first.user.click(await toggle());
    expect(await toggle()).toHaveAttribute('aria-pressed', 'false');

    // A reload: a fresh app on the same browser storage.
    cleanup();
    await renderRoute(`${base}/runs`);
    expect(await toggle()).toHaveAttribute('aria-pressed', 'false');
    await screen.findAllByRole('link', { name: /^Run \d+$/ });
    expect(screen.queryByText(/ of \d+ runs$/)).not.toBeInTheDocument();
  });

  it('shows the list grouped when the stored Grouped by ticket value is unreadable', async () => {
    localStorage.setItem('agentdesk.runs.grouped', 'bogus');
    await renderRoute(`${base}/runs`);
    expect(await screen.findByRole('button', { name: 'Grouped by ticket' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('?filter=needs_you requests filter=needs_you and shows the idle and paused runs', async () => {
    const queries = captureRunListQueries();
    await renderRoute(`${base}/runs?filter=needs_you`);
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    expect(queries.some((q) => new URLSearchParams(q).get('filter') === 'needs_you')).toBe(true);
    expect(runNumbers()).toEqual([64, 62]);
    expect(within(chips()).getByRole('link', { name: /^Needs you/ })).toHaveAttribute('aria-current', 'page');
  });

  it('?filter=bogus falls back to all', async () => {
    const { router } = await renderRoute(`${base}/runs?filter=bogus`);
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    expect(runNumbers()).toHaveLength(12);
    expect(within(chips()).getByRole('link', { name: /^All/ })).toHaveAttribute('aria-current', 'page');
    expect(router.state.location.search).toEqual({});
  });

  it('?filter=ignored shows the ignored commands with their reasons and the connection warning', async () => {
    // The webhook fixtures are dated 12 Nov; pin the clock near them so "silent for too long" does not depend on today.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'], now: new Date('2026-11-12T15:00:00.000Z') });
    try {
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
    } finally {
      vi.useRealTimers();
    }
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

  it('the Desk tab opens Routing rules, not Skills', async () => {
    await renderRoute(`${base}/runs`);
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    const tabs = screen.getByRole('navigation', { name: 'Project' });
    expect(within(tabs).getByRole('link', { name: /Desk/ })).toHaveAttribute('href', `${base}/desk/rules`);
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

  it('?filter=ignored&ticket=139 keeps the ticket on every filter chip link', async () => {
    await renderRoute(`${base}/runs?filter=ignored&ticket=139`);
    await screen.findByRole('heading', { level: 2, name: 'Ignored commands' });
    expect(within(chips()).getByRole('link', { name: /^Ended/ })).toHaveAttribute(
      'href',
      `${base}/runs?filter=ended&ticket=139`,
    );
    expect(screen.getByRole('link', { name: /^Ignored/ })).toHaveAttribute(
      'href',
      `${base}/runs?filter=ignored&ticket=139`,
    );
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

  it('refetches the rows and the chip counts together on window focus', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] });
    try {
      await renderRoute(`${base}/runs`);
      await screen.findByRole('heading', { level: 1, name: 'Runs' });
      expect(within(chips()).getByRole('link', { name: /^Needs you/ })).toHaveTextContent('2');
      // Run 61 goes idle while the tab is in the background; the cached data is now past its 30 s stale time.
      const run61 = mockDb.state.runs.find((r) => r.number === 61);
      if (!run61) throw new Error('run 61 fixture missing');
      run61.status = 'idle';
      run61.idleSince = new Date().toISOString();
      vi.setSystemTime(Date.now() + 60_000);
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await waitFor(() => expect(within(chips()).getByRole('link', { name: /^Needs you/ })).toHaveTextContent('3'));
      const row61 = screen.getByRole('link', { name: 'Run 61' }).closest('tr');
      if (!row61) throw new Error('row 61 missing');
      expect(within(row61).getByText(/Waiting \dm/)).toBeInTheDocument();
      expect(within(chips()).getByRole('link', { name: /^Active/ })).toHaveTextContent('2');
    } finally {
      focusManager.setFocused(undefined);
      vi.useRealTimers();
    }
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
        ticket: { ...template.ticket, number: 500 + i, ref: String(500 + i) },
      }));
      const old = [1, 2].map((n) => ({
        ...template,
        id: ids.run(1, n),
        number: n,
        ticket: { ...template.ticket, number: 12, ref: ticket12Ref },
      }));
      mockDb.state.runs = [...mockDb.state.runs, ...extra, ...old];
    }

    it('"All" shows 20 rows of a page and counts every run from the server', async () => {
      seedMany();
      const queries = captureRunListQueries();
      await renderRoute(`${base}/runs`);
      await screen.findByRole('heading', { level: 1, name: 'Runs' });
      expect(runNumbers()).toHaveLength(20);
      expect(within(chips()).getByRole('link', { name: /^All/ })).toHaveTextContent('134');
      expect(within(chips()).getByRole('link', { name: /^Ended/ })).toHaveTextContent(String(8 + 122));
      expect(queries.map((q) => new URLSearchParams(q).get('pageSize'))).toEqual(['20']);
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

  describe('paging', () => {
    /** Replaces the project's runs with `total` runs numbered 1..total, each on its own ticket unless `ticketOf` says. */
    function seedRuns(
      total: number,
      opts: { from?: number; status?: RunDto['status']; ticketOf?: (n: number) => string } = {},
    ) {
      const template = mockDb.state.runs.find((r) => r.number === (opts.from ?? 60));
      if (!template) throw new Error('template run missing');
      const ticketOf = opts.ticketOf ?? String;
      mockDb.state.runs = [
        ...mockDb.state.runs.filter((r) => r.projectId !== projectId),
        ...Array.from({ length: total }, (_, i) => {
          const n = i + 1;
          const ref = ticketOf(n);
          return {
            ...template,
            id: ids.run(1, n),
            number: n,
            status: opts.status ?? 'succeeded',
            queuedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
            ticket: { ...template.ticket, number: Number(ref), ref },
          };
        }),
      ];
    }
    const nav = () => screen.getByRole('navigation', { name: 'Pagination' });
    /** The wide page list comes first; jsdom shows both lists, the CSS container query picks one. */
    const pageButton = (n: number) => {
      const [button] = screen.getAllByRole('button', { name: `Page ${n}` });
      if (!button) throw new Error(`no Page ${n} button`);
      return button;
    };

    it('63 runs: 20 rows and "Showing 1–20 of 63"; Page 4 shows 3 rows and ?page=4', async () => {
      seedRuns(63);
      const { user, router } = await renderRoute(`${base}/runs`);
      await screen.findByRole('navigation', { name: 'Pagination' });
      expect(runNumbers()).toHaveLength(20);
      expect(nav()).toHaveTextContent('Showing 1–20 of 63');
      await user.click(pageButton(4));
      await waitFor(() => expect(runNumbers()).toHaveLength(3));
      expect(router.state.location.search).toEqual({ page: '4' });
      expect(nav()).toHaveTextContent('Showing 61–63 of 63');
    });

    it('?page=99 is replaced by the last page; ?page=abc shows page 1', async () => {
      seedRuns(63);
      const { router } = await renderRoute(`${base}/runs?page=99`);
      await waitFor(() => expect(router.state.location.search).toEqual({ page: '4' }));
      await waitFor(() => expect(runNumbers()).toHaveLength(3));
      cleanup();
      const again = await renderRoute(`${base}/runs?page=abc`);
      await screen.findByRole('navigation', { name: 'Pagination' });
      expect(runNumbers()).toHaveLength(20);
      expect(nav()).toHaveTextContent('Showing 1–20 of 63');
      expect(again.router.state.location.search).toEqual({});
    });

    it('TC-15.3: from ?page=3 every chip and the grouped toggle land on page 1, and no filter or ticket href carries page', async () => {
      seedRuns(63);
      const { user, router } = await renderRoute(`${base}/runs?page=3&ticket=12`);
      await screen.findByRole('heading', { level: 1, name: 'Runs' });
      const links = [...within(chips()).getAllByRole('link'), screen.getByRole('link', { name: /^Ignored/ })];
      expect(links.length).toBeGreaterThanOrEqual(6);
      for (const l of links) {
        const href = l.getAttribute('href') ?? '';
        expect(href, href).not.toContain('page');
        expect(href, href).toContain('ticket=12');
      }
      await user.click(screen.getByRole('button', { name: 'Grouped by ticket' }));
      await waitFor(() => expect(router.state.location.search).not.toHaveProperty('page'));
    });

    it('TC-15.3: changing the ticket from ?page=3 shows page 1 of the filtered result', async () => {
      // 25 runs on ticket 12 and 38 on their own tickets; the app has no ticket text box, the filter is ?ticket=.
      seedRuns(63, { ticketOf: (n) => (n <= 25 ? '12' : String(n)) });
      const { router } = await renderRoute(`${base}/runs?page=3`);
      await screen.findByRole('navigation', { name: 'Pagination' });
      expect(nav()).toHaveTextContent('Showing 41–60 of 63');
      await router.navigate({
        to: '/o/$org/p/$project/runs',
        params: { org: 'alice', project: projectId },
        search: { ticket: '12' },
      });
      await waitFor(() => expect(nav()).toHaveTextContent('Showing 1–20 of 25'));
      expect(runNumbers()).toHaveLength(20);
      expect(router.state.location.search).toEqual({ ticket: '12' });
    });

    it('grouped: a ticket split across pages shows its header on both with the same "N of max runs"', async () => {
      // Newest first: numbers 63..44 are page 1; runs 45, 44 and 43 (positions 19, 20, 21) share one ticket.
      seedRuns(63, { ticketOf: (n) => (n >= 43 && n <= 45 ? '9000' : String(n)) });
      const { user } = await renderRoute(`${base}/runs`);
      await screen.findByRole('navigation', { name: 'Pagination' });
      expect(screen.getAllByText('3 of 10 runs')).toHaveLength(1);
      expect(
        runNumbers()
          .slice(-2)
          .sort((a, b) => a - b),
      ).toEqual([44, 45]);
      await user.click(pageButton(2));
      await waitFor(() => expect(runNumbers()).toContain(43));
      expect(runNumbers()).toHaveLength(20);
      expect(screen.getAllByText('3 of 10 runs')).toHaveLength(1);
    });

    it('"Rows per page" 50 shows 50 rows on page 1', async () => {
      seedRuns(63);
      const { user } = await renderRoute(`${base}/runs?page=2`);
      await screen.findByRole('navigation', { name: 'Pagination' });
      await user.selectOptions(screen.getByLabelText('Rows per page'), '50');
      await waitFor(() => expect(runNumbers()).toHaveLength(50));
      expect(nav()).toHaveTextContent('Showing 1–50 of 63');
    });

    it('while page 2 is held, page 1 stays with the table and nav busy and every control disabled', async () => {
      seedRuns(63);
      const page2 = await (await fetch(`http://localhost:3000${runsApi}?filter=all&page=2&pageSize=20`)).json();
      const { user } = await renderRoute(`${base}/runs`);
      await screen.findByRole('navigation', { name: 'Pagination' });
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        http.get(`*${runsApi}`, async () => {
          await held;
          return HttpResponse.json(page2);
        }),
      );
      await user.click(pageButton(2));
      await waitFor(() => expect(nav()).toHaveAttribute('aria-busy', 'true'));
      expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
      expect(runNumbers()).toHaveLength(20);
      expect(runNumbers()).toContain(63);
      // The control still describes the page on screen, not the one being loaded.
      expect(nav()).toHaveTextContent('Showing 1–20 of 63');
      expect(pageButton(1)).toHaveAttribute('aria-current', 'page');
      expect(pageButton(2)).not.toHaveAttribute('aria-current');
      for (const control of [...within(nav()).getAllByRole('button'), screen.getByLabelText('Rows per page')]) {
        expect(control).toBeDisabled();
      }
      release();
      await waitFor(() => expect(nav()).toHaveAttribute('aria-busy', 'false'));
      expect(runNumbers()).not.toContain(63);
      expect(nav()).toHaveTextContent('Showing 21–40 of 63');
      expect(pageButton(2)).toHaveAttribute('aria-current', 'page');
    });

    it('while the 50-row page is held, the 20 rows stay and the control still reads "Showing 1–20"', async () => {
      seedRuns(63);
      const page50 = await (await fetch(`http://localhost:3000${runsApi}?filter=all&page=1&pageSize=50`)).json();
      const { user } = await renderRoute(`${base}/runs`);
      await screen.findByRole('navigation', { name: 'Pagination' });
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        http.get(`*${runsApi}`, async () => {
          await held;
          return HttpResponse.json(page50);
        }),
      );
      await user.selectOptions(screen.getByLabelText('Rows per page'), '50');
      await waitFor(() => expect(nav()).toHaveAttribute('aria-busy', 'true'));
      expect(runNumbers()).toHaveLength(20);
      expect(nav()).toHaveTextContent('Showing 1–20 of 63');
      expect(screen.getByLabelText('Rows per page')).toHaveValue('20');
      release();
      await waitFor(() => expect(runNumbers()).toHaveLength(50));
      expect(nav()).toHaveTextContent('Showing 1–50 of 63');
      expect(screen.getByLabelText('Rows per page')).toHaveValue('50');
    });

    it('needs you: while page 2 is held, the control still reads "Showing 1–20" with Page 1 current; then the new range', async () => {
      seedRuns(21, { from: 62, status: 'idle' });
      const { user } = await renderRoute(`${base}/needs-you`);
      await screen.findByRole('navigation', { name: 'Pagination' });
      const page2Body = await (
        await fetch(`http://localhost:3000${runsApi}?filter=needs_you&page=2&pageSize=20`)
      ).json();
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        http.get(`*${runsApi}`, async ({ request }) => {
          if (new URL(request.url).searchParams.get('page') !== '2') return undefined;
          await held;
          return HttpResponse.json(page2Body);
        }),
      );
      await user.click(pageButton(2));
      await waitFor(() => expect(nav()).toHaveAttribute('aria-busy', 'true'));
      expect(screen.getAllByRole('link', { name: /^Open run \d+ in Agent Desk$/ })).toHaveLength(20);
      expect(nav()).toHaveTextContent('Showing 1–20 of 21');
      expect(pageButton(1)).toHaveAttribute('aria-current', 'page');
      release();
      await waitFor(() => expect(nav()).toHaveAttribute('aria-busy', 'false'));
      expect(nav()).toHaveTextContent('Showing 21–21 of 21');
      expect(pageButton(2)).toHaveAttribute('aria-current', 'page');
    });

    it('needs you: 21 runs show 20 cards; Page 2 shows 1 card and "Showing 21–21 of 21"; the tab badge stays at 21', async () => {
      seedRuns(21, { from: 62, status: 'idle' });
      const { user } = await renderRoute(`${base}/needs-you`);
      await screen.findByRole('navigation', { name: 'Pagination' });
      const cards = () => screen.getAllByRole('link', { name: /^Open run \d+ in Agent Desk$/ });
      expect(cards()).toHaveLength(20);
      expect(screen.getByText('(21) Needs you, invoicer-api')).toBeInTheDocument();
      await user.click(pageButton(2));
      await waitFor(() => expect(cards()).toHaveLength(1));
      expect(nav()).toHaveTextContent('Showing 21–21 of 21');
      expect(screen.getByText('(21) Needs you, invoicer-api')).toBeInTheDocument();
    });
  });

  describe('paged ignored list', () => {
    const nav = () => screen.getByRole('navigation', { name: 'Pagination' });
    const ignoredRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
    /** Ignored events, newest first, as the server holds them. */
    function seedIgnored(count: number) {
      mockDb.state.ignored[projectId] = Array.from({ length: count }, (_, i) => ({
        id: ids.ignored(1000 + i),
        receivedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, count - i)).toISOString(),
        ticketRef: String(500 + i),
        ticketKind: null,
        command: 'code-build',
        author: 'mallory',
        outcome: 'ignored_unauthorized',
        detail: 'not allowed',
      }));
    }

    it('27 ignored: 20 rows; Page 2 shows 7 rows and "Showing 21–27 of 27"; the chip count stays 27', async () => {
      seedIgnored(27);
      const { user } = await renderRoute(`${base}/runs?filter=ignored`);
      await screen.findByRole('navigation', { name: 'Pagination' });
      expect(ignoredRows()).toHaveLength(20);
      expect(screen.getByRole('link', { name: /^Ignored/ })).toHaveTextContent('27');
      await user.click(screen.getAllByRole('button', { name: 'Page 2' })[0] as HTMLElement);
      await waitFor(() => expect(ignoredRows()).toHaveLength(7));
      expect(nav()).toHaveTextContent('Showing 21–27 of 27');
      expect(screen.getByRole('link', { name: /^Ignored/ })).toHaveTextContent('27');
    });

    it('while page 2 is held, the control still reads "Showing 1–20" with Page 1 current; then the new range', async () => {
      seedIgnored(27);
      const { user } = await renderRoute(`${base}/runs?filter=ignored`);
      await screen.findByRole('navigation', { name: 'Pagination' });
      const ignoredApi = `/api/projects/${projectId}/ignored`;
      const page2Body = await (await fetch(`http://localhost:3000${ignoredApi}?page=2&pageSize=20`)).json();
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        http.get(`*${ignoredApi}`, async ({ request }) => {
          if (new URL(request.url).searchParams.get('page') !== '2') return undefined;
          await held;
          return HttpResponse.json(page2Body);
        }),
      );
      await user.click(screen.getAllByRole('button', { name: 'Page 2' })[0] as HTMLElement);
      await waitFor(() => expect(nav()).toHaveAttribute('aria-busy', 'true'));
      expect(ignoredRows()).toHaveLength(20);
      expect(nav()).toHaveTextContent('Showing 1–20 of 27');
      expect(within(nav()).getAllByRole('button', { name: 'Page 1' })[0]).toHaveAttribute('aria-current', 'page');
      release();
      await waitFor(() => expect(nav()).toHaveAttribute('aria-busy', 'false'));
      expect(nav()).toHaveTextContent('Showing 21–27 of 27');
      expect(within(nav()).getAllByRole('button', { name: 'Page 2' })[0]).toHaveAttribute('aria-current', 'page');
    });

    it('from page 3 of All, the Ignored chip lands on page 1 of the ignored list', async () => {
      seedIgnored(27);
      const { user, router } = await renderRoute(`${base}/runs?page=3`);
      await screen.findByRole('heading', { level: 1, name: 'Runs' });
      await user.click(screen.getByRole('link', { name: /^Ignored/ }));
      await screen.findByRole('heading', { level: 2, name: 'Ignored commands' });
      expect(router.state.location.search).toEqual({ filter: 'ignored' });
      expect(await screen.findByRole('navigation', { name: 'Pagination' })).toHaveTextContent('Showing 1–20 of 27');
    });

    it('20 ignored: no pagination control', async () => {
      seedIgnored(20);
      await renderRoute(`${base}/runs?filter=ignored`);
      await screen.findByRole('heading', { level: 2, name: 'Ignored commands' });
      expect(ignoredRows()).toHaveLength(20);
      expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
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
    expect(screen.getByText('(2) Needs you, invoicer-api')).toBeInTheDocument();
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

  it('lists a paused run with the Paused badge and a Resume button that resumes it', async () => {
    const { user } = await renderRoute(`${base}/needs-you`);
    expect(await screen.findByRole('link', { name: 'Open run 64 in Agent Desk' })).toHaveAttribute(
      'href',
      `${base}/runs/64`,
    );
    expect(screen.getByTitle('status: paused')).toHaveTextContent('Paused');
    expect(screen.getByText('Run 64 is paused and can be resumed.')).toBeInTheDocument();
    // The idle run has no Resume.
    expect(screen.getAllByRole('button', { name: 'Resume' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(mockDb.requests('POST', `/api/runs/${ids.run(1, 64)}/resume`)).toBe(1));
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Open run 64 in Agent Desk' })).not.toBeInTheDocument(),
    );
  });

  it('an idle run that was paused earlier lists from its idle time, not the old pause time', async () => {
    const stale = '2026-11-01T03:07:00.000Z';
    mockDb.state.runs = mockDb.state.runs.map((r) => (r.number === 62 ? { ...r, pausedAt: stale } : r));
    const idleSince = mockDb.state.runs.find((r) => r.number === 62)?.idleSince;
    expect(idleSince).toBeTruthy();
    await renderRoute(`${base}/needs-you`);
    await screen.findByRole('link', { name: 'Open run 62 in Agent Desk' });
    const hhmm = (iso: string) => {
      const d = new Date(iso);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    expect(hhmm(stale)).not.toBe(hhmm(idleSince ?? ''));
    expect(screen.getByText(new RegExp(`edited ${hhmm(idleSince ?? '')}`))).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(`edited ${hhmm(stale)}`))).not.toBeInTheDocument();
  });

  it('a Resume that the server refuses shows its message', async () => {
    const { user } = await renderRoute(`${base}/needs-you`, {
      scenario: () => scenarios.problem('runs.resume', { status: 409, title: 'This run is already being resumed' }),
    });
    await user.click(await screen.findByRole('button', { name: 'Resume' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This run is already being resumed');
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled();
  });

  it('says so when no run needs you', async () => {
    mockDb.state.runs = mockDb.state.runs.filter((r) => r.status !== 'idle' && r.status !== 'paused');
    await renderRoute(`${base}/needs-you`);
    expect(await screen.findAllByText('No runs need you right now.')).not.toHaveLength(0);
    expect(screen.queryByRole('link', { name: /^Open run/ })).not.toBeInTheDocument();
  });
});
