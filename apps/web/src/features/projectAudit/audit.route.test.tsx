import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUDIT_MOCK_NOW } from '@/mocks/dto/audit';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { applyProjectSpace, type ProjectSpaceRole, type ProjectSpaceScenario } from '@/mocks/msw/projectSpaceScenarios';
import { renderRoute } from '@/test/renderRoute';

const P = ids.project.invoicerApi;
const OTHER_PROJECT = ids.project.invoicerWeb;
const page = (project = P) => `/o/alice/p/${project}/desk/audit`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(AUDIT_MOCK_NOW) });
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

const as = (role: ProjectSpaceRole, scenario?: ProjectSpaceScenario) => () =>
  applyProjectSpace(mockDb, scenario === undefined ? { role } : { role, scenario });
const ready = () => screen.findByRole('heading', { level: 1, name: 'Audit log' });
const rows = () => screen.getAllByRole('row').slice(1);

/** Records the project audit requests only. */
async function watchAudit<T>(run: () => Promise<T>): Promise<{ result: T; listed: string[] }> {
  const listed: string[] = [];
  const listener = ({ request }: { request: Request }) => {
    const { pathname } = new URL(request.url);
    if (/^\/api\/projects\/[^/]+\/audit$/.test(pathname)) listed.push(request.url);
  };
  server.events.on('request:start', listener);
  try {
    return { result: await run(), listed };
  } finally {
    server.events.removeListener('request:start', listener);
  }
}

describe('project audit page: rows (BR-16)', () => {
  it('a project admin sees the entries newest first and a deleted actor as Deleted user', async () => {
    await renderRoute(page(), { scenario: as('projectAdmin') });
    await ready();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['When', 'Who', 'What']);
    const times = rows().map((r) => r.querySelector('time')?.dateTime ?? '');
    expect(times).toEqual([...times].sort().reverse());
    expect(within(rows()[0] as HTMLElement).getAllByRole('cell')[1]).toHaveTextContent('Lee');
    expect(rows().some((r) => within(r).queryByText('Deleted user') !== null)).toBe(true);
  });

  it('an org owner sees the same page', async () => {
    await renderRoute(page(), { scenario: as('owner') });
    await ready();
    expect(rows().length).toBeGreaterThan(0);
  });

  it('paging keeps the old rows on screen while the next page loads', async () => {
    const { user } = await renderRoute(page(), { scenario: as('owner', 'auditPaged') });
    await ready();
    expect(rows()).toHaveLength(20);
    await user.click(screen.getAllByRole('button', { name: 'Page 2' })[0] as HTMLElement);
    await waitFor(() => expect(rows()).toHaveLength(5));
  });

  it('opens straight on page 2 with ?page=2', async () => {
    await renderRoute(`${page()}?page=2`, { scenario: as('owner', 'auditPaged') });
    await ready();
    await waitFor(() => expect(rows()).toHaveLength(5));
  });
});

describe('project audit page: states (BR-20)', () => {
  it('a skeleton shows while the list is held', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await renderRoute(page(), {
      scenario: () => {
        applyProjectSpace(mockDb, { role: 'owner' });
        server.use(
          http.get('*/api/projects/:projectId/audit', async () => {
            await held;
            return undefined;
          }),
        );
      },
    });
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
    await act(async () => release());
    await ready();
  });

  it('a failure shows the error and Retry shows the list', async () => {
    const { user } = await renderRoute(page(), { scenario: as('owner', 'auditError') });
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await ready();
    expect(rows().length).toBeGreaterThan(0);
  });

  it('no entries shows "No activity yet"', async () => {
    await renderRoute(page(), { scenario: as('owner', 'auditEmpty') });
    await ready();
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
  });
});

describe('project audit page: refusals while open', () => {
  it.each([
    [404, 'Page not found'],
    [403, "You don't have access"],
  ] as const)('a %i from the audit list shows its error page, not the generic failure', async (status, text) => {
    await renderRoute(page(), {
      scenario: () => {
        applyProjectSpace(mockDb, { role: 'owner' });
        server.use(
          http.get('*/api/projects/:projectId/audit', () =>
            HttpResponse.json(
              { type: 'about:blank', title: 'Refused', status },
              { status, headers: { 'content-type': 'application/problem+json' } },
            ),
          ),
        );
      },
    });
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});

describe('project audit page: access (BR-2, BR-3)', () => {
  it.each(['member', 'viewer'] as const)('a %s sees Forbidden and no audit request is sent', async (role) => {
    const { listed } = await watchAudit(async () => {
      await renderRoute(page(), { scenario: as(role) });
      expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument();
    });
    expect(listed).toEqual([]);
  });

  it('a project admin of P opening another project sees Page not found and no audit request is sent', async () => {
    const { listed } = await watchAudit(async () => {
      await renderRoute(page(OTHER_PROJECT), { scenario: as('projectAdmin') });
      expect(await screen.findByText('Page not found')).toBeInTheDocument();
    });
    expect(listed).toEqual([]);
  });
});
