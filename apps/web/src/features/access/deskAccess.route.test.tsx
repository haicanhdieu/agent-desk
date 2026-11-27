import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { applyProjectSpace, type ProjectSpaceRole } from '@/mocks/msw/projectSpaceScenarios';
import { scenarios } from '@/mocks/msw/scenarios';
import { applyShellScenario } from '@/mocks/msw/shellScenarios';
import { renderRoute } from '@/test/renderRoute';

// Issue 216: a member or viewer sees the Forbidden page on every Desk route and the new-project wizard, the app
// requests none of the protected data, and the Desk entry points are gone. Admins and owners keep everything.

const P1 = ids.project.invoicerApi;
const P2 = ids.project.invoicerWeb;
const desk = (project: string, tab: string) => `/o/acme/p/${project}/desk/${tab}`;
const DESK_TABS = ['agent', 'setup', 'skills', 'rules'] as const;
const FORBIDDEN = { name: "You don't have access" } as const;

/** Paths the app requests while a test runs (API calls only). */
let seen: string[] = [];
const listener = ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) seen.push(url.pathname);
};
const track = () => {
  seen = [];
  server.events.on('request:start', listener);
};
afterEach(() => server.events.removeListener('request:start', listener));

const DESK_DATA = /\/(agent|skills|rules|setup-script|plugins|setup-tests)(\/|$)|\/agents\/|\/rules\/|\/setup-tests\//;
const ORG_INVITATIONS = /^\/api\/orgs\/[^/]+\/invitations(\/|$)/;
const ORG_GATED = /^\/api\/orgs\/[^/]+\/(members|audit|invitations)(\/|$)/;
const deskCalls = () => seen.filter((p) => DESK_DATA.test(p));

const open = (path: string, scenario: Parameters<typeof scenarios.onboarding>[0]) => {
  track();
  return renderRoute(path, { scenario: () => scenarios.onboarding(scenario) });
};

describe.each(['member', 'viewer'] as const)('a %s', (role) => {
  it.each(DESK_TABS)('sees Forbidden on the Desk %s page and no Desk data is requested', async (tab) => {
    await open(desk(P1, tab), role);
    expect(await screen.findByRole('heading', FORBIDDEN)).toBeInTheDocument();
    expect(deskCalls()).toEqual([]);
  });

  it('sees Forbidden on the new project wizard and the connections API is not called', async () => {
    await open('/o/acme/projects/new/repo', role);
    expect(await screen.findByRole('heading', FORBIDDEN)).toBeInTheDocument();
    expect(seen.filter((p) => p.startsWith('/api/connections'))).toEqual([]);
  });

  it('sees Forbidden on the org invitations page and no invitations are requested', async () => {
    await open('/o/acme/invitations', role);
    expect(await screen.findByRole('heading', FORBIDDEN)).toBeInTheDocument();
    // The app bar's own /api/me/invitations (the caller's pending count) is allowed; the ORG's list is not.
    expect(seen.filter((p) => ORG_INVITATIONS.test(p))).toEqual([]);
  });

  it.each([
    '/o/acme/projects',
    '/o/acme/settings',
    '/o/acme/settings/members',
    '/o/acme/settings/audit',
    '/o/acme/settings/general',
  ])('on the org page %s the shell requests no Desk data and none of the gated org lists', async (path) => {
    await open(path, role);
    await screen.findByRole('navigation', { name: 'Organization menu' });
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(deskCalls()).toEqual([]);
    // Members, audit log and invitations of the org need org-level rights the role lacks.
    expect(seen.filter((p) => ORG_GATED.test(p))).toEqual([]);
  });

  it('has no Settings tab on the runs page and no Desk data is requested there', async () => {
    await open(`/o/acme/p/${P1}/runs`, role);
    expect(await screen.findByRole('link', { name: /^Runs/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Project settings' })).not.toBeInTheDocument();
    expect(deskCalls()).toEqual([]);
  });

  it('has no Agent & settings entry in a project row menu', async () => {
    const { user } = await open('/o/acme/projects', role);
    await user.click((await screen.findAllByRole('button', { name: /^More for / }))[0]!);
    expect(await screen.findByRole('link', { name: 'Runs' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Agent & settings' })).not.toBeInTheDocument();
  });
});

describe.each(['owner', 'orgAdmin'] as const)('an %s', (role) => {
  it.each(DESK_TABS)('opens the Desk %s page', async (tab) => {
    await open(desk(P1, tab), role);
    // The shell's Project menu marks the page's own item current; the page replaces its first render once its data
    // has loaded, so it is polled rather than found once.
    const item = { agent: 'Agent & settings', setup: 'Workspace setup', skills: 'Skills', rules: 'Routing rules' }[tab];
    const nav = await screen.findByRole('navigation', { name: 'Project menu' });
    await waitFor(() => expect(within(nav).getByRole('link', { name: item })).toHaveAttribute('aria-current', 'page'));
    expect(screen.queryByRole('heading', FORBIDDEN)).not.toBeInTheDocument();
  });

  it('opens the new project wizard', async () => {
    await open('/o/acme/projects/new/repo', role);
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', FORBIDDEN)).not.toBeInTheDocument();
  });

  it('sees the configuration items in the Project menu on the runs page', async () => {
    await open(`/o/acme/p/${P1}/runs`, role);
    const nav = await screen.findByRole('navigation', { name: 'Project menu' });
    expect(await within(nav).findByRole('link', { name: 'Routing rules' })).toBeInTheDocument();
  });
});

describe('an admin of one project', () => {
  it('opens the Desk of that project', async () => {
    await open(desk(P1, 'agent'), 'projectAdmin');
    expect(await screen.findByRole('heading', { level: 1, name: 'Agent & settings' })).toBeInTheDocument();
  });

  it('sees Page not found on the Desk of a project they do not administer and requests none of its data', async () => {
    await open(desk(P2, 'rules'), 'projectAdmin');
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(deskCalls()).toEqual([]);
  });

  it('sees Forbidden on the new project wizard (project:create is an org permission)', async () => {
    await open('/o/acme/projects/new/repo', 'projectAdmin');
    expect(await screen.findByRole('heading', FORBIDDEN)).toBeInTheDocument();
  });
});

describe('while access cannot be loaded', () => {
  it.each(DESK_TABS)('denies the Desk %s page (fail closed) and requests no Desk data', async (tab) => {
    track();
    await renderRoute(desk(P1, tab), {
      scenario: () => {
        scenarios.onboarding('owner');
        scenarios.serverError('me.access');
      },
    });
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Agent & settings' })).not.toBeInTheDocument();
    expect(deskCalls()).toEqual([]);
  });
});

describe('Delete project in the project list row menu (project:delete is an org-level permission)', () => {
  const openList = (role: ProjectSpaceRole) =>
    renderRoute('/o/alice/projects', { scenario: () => applyProjectSpace(mockDb, { role }) });
  const openMenu = async () => {
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: /^More for / }))[0]!);
    return screen.findByRole('dialog', { name: /^Actions for / });
  };

  it.each(['owner', 'admin'] as const)('offers an org %s the item', async (role) => {
    await openList(role);
    expect(within(await openMenu()).getByRole('button', { name: 'Delete project' })).toBeEnabled();
  });

  it.each(['projectAdmin', 'member', 'viewer'] as const)('does not offer a %s the item', async (role) => {
    await openList(role);
    const menu = await openMenu();
    expect(within(menu).getByRole('link', { name: 'Runs' })).toBeInTheDocument();
    expect(within(menu).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
  });
});

describe('the Access group of the Desk side menu (BR-1)', () => {
  const openAs = (role: ProjectSpaceRole) =>
    renderRoute(`/o/alice/p/${P1}/desk/agent`, { scenario: () => applyProjectSpace(mockDb, { role }) });

  it.each(['owner', 'admin', 'projectAdmin'] as const)('shows Members and Audit log to the %s', async (role) => {
    await openAs(role);
    const nav = await screen.findByRole('navigation', { name: 'Project menu' });
    expect(within(nav).getByRole('link', { name: 'Members' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Audit log' })).toBeInTheDocument();
  });

  it.each(['member', 'viewer'] as const)('gives a %s no Settings tab', async (role) => {
    await renderRoute(`/o/alice/p/${P1}/runs`, { scenario: () => applyProjectSpace(mockDb, { role }) });
    expect(await screen.findByRole('link', { name: /^Runs/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Project settings' })).not.toBeInTheDocument();
  });
});

describe('the project pages in the app shell', () => {
  const PAGES = [
    'runs',
    'desk/rules',
    'desk/skills',
    'desk/setup',
    'desk/agent',
    'desk/members',
    'desk/audit',
  ] as const;
  const menu = () => screen.getByRole('navigation', { name: 'Project menu' });
  const links = () =>
    within(menu())
      .getAllByRole('link')
      .map((a) => a.textContent?.replace(/\d+ needs you$/, '').trim());
  const openAs = (path: string, role: ProjectSpaceRole) =>
    renderRoute(`/o/alice/p/${P1}/${path}`, { scenario: () => applyProjectSpace(mockDb, { role }) });

  it.each(PAGES)('%s has one Project menu with every item of an owner and one main', async (page) => {
    await openAs(page, 'owner');
    await screen.findByRole('navigation', { name: 'Project menu' });
    expect(screen.getAllByRole('navigation', { name: 'Project menu' })).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(links()).toEqual([
      'All projects',
      'Runs',
      'Routing rules',
      'Skills',
      'Workspace setup',
      'Agent & settings',
      'Members',
      'Audit log',
      'Open repository',
    ]);
  });

  it.each(['member', 'viewer'] as const)('a %s on Runs sees Runs and the repository block only', async (role) => {
    track();
    await openAs('runs', role);
    await screen.findByRole('navigation', { name: 'Project menu' });
    expect(links()).toEqual(['All projects', 'Runs', 'Open repository']);
    expect(within(menu()).getByRole('region', { name: 'Repository' })).toBeInTheDocument();
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(deskCalls()).toEqual([]);
  });

  it('adminP1ViewerP2 sees the configuration items on P1 and Runs only on P2', async () => {
    await renderRoute(`/o/alice/p/${P1}/runs`, { scenario: () => applyShellScenario('adminP1ViewerP2') });
    await screen.findByRole('navigation', { name: 'Project menu' });
    await waitFor(() => expect(links()).toContain('Agent & settings'));
    cleanup();
    track();
    await renderRoute(`/o/alice/p/${P2}/runs`, { scenario: () => applyShellScenario('adminP1ViewerP2') });
    await screen.findByRole('navigation', { name: 'Project menu' });
    await waitFor(() => expect(links()).toEqual(['All projects', 'Runs', 'Open repository']));
    expect(deskCalls()).toEqual([]);
  });

  it.each(['rules', 'skills', 'setup', 'agent'])('a forbidden %s address keeps the Project menu', async (tab) => {
    await openAs(`desk/${tab}`, 'member');
    expect(await screen.findByRole('heading', FORBIDDEN)).toBeInTheDocument();
    expect(screen.getAllByRole('navigation', { name: 'Project menu' })).toHaveLength(1);
    expect(links()).toEqual(['All projects', 'Runs', 'Open repository']);
  });

  it('All projects goes to the projects of the org', async () => {
    const { router, user } = await openAs('desk/rules', 'owner');
    await user.click(await screen.findByRole('link', { name: 'All projects' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/o/alice/projects'));
  });
});

describe('the setup warning in the app shell', () => {
  const failedTest = () =>
    mockDb.state.setupTests.push({
      id: ids.created(901),
      projectId: P1,
      status: 'failed',
      scriptSha256: 'a'.repeat(64),
      matchesCurrentScript: true,
      checkoutSha: null,
      plugins: { installed: [], skipped: [], failed: [] },
      exitCode: 1,
      startedBy: 'kim-hale',
      createdAt: '2026-11-12T09:00:00.000Z',
      finishedAt: '2026-11-12T09:01:00.000Z',
      endedAt: '2026-11-12T09:20:00.000Z',
    });

  it.each(['desk/rules', 'desk/skills', 'desk/agent', 'desk/members'])(
    '%s shows it inside main, once, with a link to Workspace setup',
    async (page) => {
      await renderRoute(`/o/alice/p/${P1}/${page}`, {
        scenario: () => {
          applyProjectSpace(mockDb, { role: 'owner' });
          failedTest();
        },
      });
      const text = await screen.findByText('The last workspace setup test failed');
      expect(screen.getAllByText('The last workspace setup test failed')).toHaveLength(1);
      expect(screen.getByRole('main')).toContainElement(text);
      expect(screen.getByRole('link', { name: 'Open workspace setup' })).toHaveAttribute(
        'href',
        `/o/alice/p/${P1}/desk/setup`,
      );
    },
  );

  it('a project without a failed test shows no warning', async () => {
    await renderRoute(`/o/alice/p/${P1}/desk/rules`, { scenario: () => applyProjectSpace(mockDb, { role: 'owner' }) });
    await screen.findByRole('heading', { level: 1, name: 'Routing rules' });
    expect(screen.queryByText('The last workspace setup test failed')).not.toBeInTheDocument();
  });
});
