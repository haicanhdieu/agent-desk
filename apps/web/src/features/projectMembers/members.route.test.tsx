import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { applyProjectSpace, type ProjectSpaceRole, type ProjectSpaceScenario } from '@/mocks/msw/projectSpaceScenarios';
import { renderRoute } from '@/test/renderRoute';

const P = ids.project.invoicerApi;
const OTHER_PROJECT = ids.project.invoicerWeb;
const page = (project = P) => `/o/alice/p/${project}/desk/members`;

const as = (role: ProjectSpaceRole, scenario?: ProjectSpaceScenario) => () =>
  applyProjectSpace(mockDb, scenario === undefined ? { role } : { role, scenario });
const ready = () => screen.findByRole('heading', { level: 1, name: 'Members' });
const rows = () => screen.getAllByRole('row').slice(1);

async function watchMembers<T>(run: () => Promise<T>): Promise<{ result: T; listed: string[] }> {
  const listed: string[] = [];
  const listener = ({ request }: { request: Request }) => {
    const { pathname } = new URL(request.url);
    if (request.method === 'GET' && /^\/api\/projects\/[^/]+\/members$/.test(pathname)) listed.push(request.url);
  };
  server.events.on('request:start', listener);
  try {
    return { result: await run(), listed };
  } finally {
    server.events.removeListener('request:start', listener);
  }
}

describe('project members page: rows (BR-4)', () => {
  it('a project admin sees the people, their roles and the intro note', async () => {
    await renderRoute(page(), { scenario: as('projectAdmin') });
    await ready();
    expect(screen.getByText(/A role in .+ also applies here\./)).toBeInTheDocument();
    const ben = rows().find((r) => within(r).queryByText('Ben Okafor') !== null);
    expect(ben).toBeDefined();
    expect(ben).toHaveTextContent('Member, Viewer');
  });

  it('an org-wide person is listed with the Organization label and no row menu, with the BR-4 note', async () => {
    await renderRoute(page(), { scenario: as('projectAdmin') });
    await ready();
    const iris = rows().find((r) => within(r).queryByText('Iris Novak') !== null) as HTMLElement;
    expect(iris).toHaveTextContent('Owner');
    expect(within(iris).getByText('Organization')).toBeInTheDocument();
    expect(within(iris).queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Those people are labelled Organization/)).toBeInTheDocument();
  });

  it('a person with an org role and a project role shows both and keeps the row menu', async () => {
    await renderRoute(page(), { scenario: as('projectAdmin') });
    await ready();
    const omar = rows().find((r) => within(r).queryByText('Omar Reyes') !== null) as HTMLElement;
    expect(omar).toHaveTextContent('Member');
    expect(omar).toHaveTextContent('Viewer');
    expect(within(omar).getByText('Organization')).toBeInTheDocument();
    expect(within(omar).getByRole('button', { name: 'Actions for Omar Reyes' })).toBeInTheDocument();
  });

  it('the signed-in person has no row menu (BR-11)', async () => {
    await renderRoute(page(), { scenario: as('owner') });
    await ready();
    const self = rows().find((r) => within(r).queryByText('Lee Park') !== null);
    expect(self).toBeDefined();
    expect(within(self as HTMLElement).queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
  });

  it('paging shows the next page', async () => {
    const { user } = await renderRoute(page(), { scenario: as('owner', 'membersPaged') });
    await ready();
    expect(rows()).toHaveLength(20);
    await user.click(screen.getAllByRole('button', { name: 'Page 2' })[0] as HTMLElement);
    await waitFor(() => expect(rows()).toHaveLength(5));
  });
});

describe('project members page: states (BR-15)', () => {
  it('a skeleton shows while the list is held', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await renderRoute(page(), {
      scenario: () => {
        applyProjectSpace(mockDb, { role: 'owner' });
        server.use(
          http.get('*/api/projects/:projectId/members', async () => {
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
    const { user } = await renderRoute(page(), { scenario: as('owner', 'membersError') });
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await ready();
    expect(rows().length).toBeGreaterThan(0);
  });

  it('no roles shows the empty state', async () => {
    await renderRoute(page(), { scenario: as('owner', 'membersEmpty') });
    await ready();
    expect(screen.getByText('No project roles yet')).toBeInTheDocument();
  });
});

describe('project members page: refusals while open', () => {
  it.each([
    [404, 'Page not found'],
    [403, "You don't have access"],
  ] as const)('a %i from the list shows its error page, not the generic failure', async (status, text) => {
    await renderRoute(page(), {
      scenario: () => {
        applyProjectSpace(mockDb, { role: 'owner' });
        server.use(
          http.get('*/api/projects/:projectId/members', () =>
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

describe('project members page: access (BR-2, BR-3)', () => {
  it.each(['member', 'viewer'] as const)('a %s sees Forbidden and no members request is sent', async (role) => {
    const { listed } = await watchMembers(async () => {
      await renderRoute(page(), { scenario: as(role) });
      expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument();
    });
    expect(listed).toEqual([]);
  });

  it('a project admin of P opening another project sees Page not found and no members request is sent', async () => {
    const { listed } = await watchMembers(async () => {
      await renderRoute(page(OTHER_PROJECT), { scenario: as('projectAdmin') });
      expect(await screen.findByText('Page not found')).toBeInTheDocument();
    });
    expect(listed).toEqual([]);
  });
});
