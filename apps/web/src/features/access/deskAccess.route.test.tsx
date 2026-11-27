import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { applyProjectSpace, type ProjectSpaceRole } from '@/mocks/msw/projectSpaceScenarios';
import { scenarios } from '@/mocks/msw/scenarios';
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
    // The page's own landmark: the Setup tab has no project nav of its own while its script loads.
    // The Setup page replaces its first render once its script has loaded, so it is polled rather than found once.
    const landmark =
      tab === 'setup' ? { role: 'heading', name: 'Workspace setup' } : { role: 'navigation', name: 'Project sections' };
    await waitFor(() => expect(screen.getByRole(landmark.role, { name: landmark.name })).toBeInTheDocument());
    expect(screen.queryByRole('heading', FORBIDDEN)).not.toBeInTheDocument();
  });

  it('opens the new project wizard', async () => {
    await open('/o/acme/projects/new/repo', role);
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', FORBIDDEN)).not.toBeInTheDocument();
  });

  it('sees the Settings tab on the runs page', async () => {
    await open(`/o/acme/p/${P1}/runs`, role);
    expect(await screen.findByRole('link', { name: 'Project settings' })).toBeInTheDocument();
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
    const nav = await screen.findByRole('navigation', { name: 'Desk' });
    expect(within(nav).getByRole('link', { name: 'Members' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Audit log' })).toBeInTheDocument();
  });

  it.each(['member', 'viewer'] as const)('gives a %s no Settings tab', async (role) => {
    await renderRoute(`/o/alice/p/${P1}/runs`, { scenario: () => applyProjectSpace(mockDb, { role }) });
    expect(await screen.findByRole('link', { name: /^Runs/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Project settings' })).not.toBeInTheDocument();
  });
});
