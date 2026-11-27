import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createMemoryHistory, createRoute } from '@tanstack/react-router';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppQueryClient } from '@/app/queryClient';
import { createRouterForTree } from '@/app/router';
import { ids } from '@/mocks/dto/ids';
import { platformOrgDtoFixtures } from '@/mocks/dto/platform';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { applyShellScenario } from '@/mocks/msw/shellScenarios';
import { createTestRootRoute } from '@/test/renderRoute';
import { accessKeys } from '../access/keys';
import { orgsQuery, sessionQuery, type Session } from '../auth/session';
import { projectsQueries } from '../projects/queries';
import type { RouteChrome } from './routeChrome';
import { useShellData, type ShellData, type ShellInput } from './useShellData';

interface Seen {
  path: string;
  org: string | null;
}
let seen: Seen[] = [];

afterEach(() => {
  server.events.removeAllListeners();
  seen = [];
});

const FIRST_ORG = platformOrgDtoFixtures[0];
if (!FIRST_ORG) throw new Error('platform org fixture missing');
const P1 = ids.project.invoicerApi;
const standard = (extra: Partial<RouteChrome> = {}): RouteChrome => ({ mode: 'standard', ...extra });

const orgInput = (extra: Partial<ShellInput> = {}): ShellInput => ({
  chrome: standard({ scope: 'org', item: 'projects', crumb: 'Projects' }),
  pathname: '/o/alice/projects',
  params: { org: 'alice' },
  ...extra,
});
const projectInput = (extra: Partial<ShellInput> = {}): ShellInput => ({
  chrome: standard({ scope: 'project', item: 'runs', crumb: 'Runs' }),
  pathname: `/o/alice/p/${P1}/runs`,
  params: { org: 'alice', project: P1 },
  ...extra,
});

interface Mounted {
  client: QueryClient;
  result: { current: ShellData };
  rerender(input: ShellInput): void;
  requests(prefix: string): Seen[];
}

/** The hook under the real router (it reads the latest location) and the MSW mock API; the session and orgs are loaded first unless `hold`. */
async function mount(
  input: ShellInput,
  opts: { scenario?: () => void; hold?: 'orgs-pending' | 'orgs-failed' | 'session-pending'; path?: string } = {},
): Promise<Mounted> {
  (opts.scenario ?? (() => scenarios.onboarding('twoOrgs')))();
  if (opts.hold === 'orgs-pending') server.use(http.get('*/auth/organization/list', () => new Promise(() => {})));
  if (opts.hold === 'orgs-failed') {
    server.use(http.get('*/auth/organization/list', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
  }
  if (opts.hold === 'session-pending') server.use(http.get('*/auth/get-session', () => new Promise(() => {})));
  const client = createAppQueryClient({ retryDelay: 0 });
  const root = createTestRootRoute();
  const routeTree = root.addChildren([createRoute({ getParentRoute: () => root, path: '$' })]);
  const history = createMemoryHistory({ initialEntries: [opts.path ?? input.pathname] });
  const router = createRouterForTree({ queryClient: client, history, routeTree });
  await router.load();
  if (opts.hold !== 'session-pending') await client.fetchQuery(sessionQuery);
  if (opts.hold === undefined || opts.hold === 'session-pending') await client.fetchQuery(orgsQuery);
  server.events.on('request:start', ({ request }) => {
    seen.push({ path: new URL(request.url).pathname, org: request.headers.get('x-org-id') });
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook((i: ShellInput) => useShellData(i), { wrapper, initialProps: input });
  return {
    client,
    result: hook.result,
    rerender: (i) => hook.rerender(i),
    requests: (prefix) => seen.filter((s) => s.path.startsWith(prefix)),
  };
}

const labels = (d: ShellData) => d.menu?.groups.flatMap((g) => (g.items ?? []).map((i) => i.label)) ?? [];
const currentOf = (d: ShellData) =>
  d.menu?.groups.flatMap((g) => (g.items ?? []).filter((i) => i.active).map((i) => i.label)) ?? [];
const ready = (m: Mounted) => waitFor(() => expect(m.result.current.menu?.state).toBe('ready'));

describe('useShellData: org pages', () => {
  it('sends the org access request with the org header and reaches a ready menu; no platform or project request', async () => {
    const m = await mount(orgInput());
    await ready(m);
    expect(labels(m.result.current)).toContain('Projects');
    expect(m.requests('/api/me/access').map((r) => r.org)).toEqual([ids.org.alice]);
    expect(m.requests('/api/projects')).toEqual([]);
    expect(m.requests('/api/platform')).toEqual([]);
    expect(m.result.current.crumbs).toEqual([{ label: 'Projects' }]);
    expect(m.result.current.titleScope).toBe('Alice');
  });

  it('the org switch is scope-only: no projectsHref, settingsHref or manageHref, even for a platform admin', async () => {
    const m = await mount(orgInput(), { scenario: () => scenarios.platform('platformAdminOrgs') });
    await ready(m);
    await waitFor(() => expect(m.result.current.orgSwitch.platformAdmin).toBe(true));
    const sw = m.result.current.orgSwitch;
    expect(sw.projectsHref).toBeUndefined();
    expect(sw.settingsHref).toBeUndefined();
    expect(sw.manageHref).toBeUndefined();
    expect(sw.platformHref).toBe('/platform');
    // The menu footer carries the platform link instead.
    await waitFor(() =>
      expect(m.result.current.menu?.footer).toEqual({
        kind: 'managePlatform',
        href: `/platform/orgs/${ids.org.alice}`,
      }),
    );
  });

  it('a non-admin sends no /api/platform request and gets no footer link', async () => {
    const m = await mount(orgInput());
    await ready(m);
    expect(m.requests('/api/platform')).toEqual([]);
    expect(m.result.current.menu?.footer).toBeUndefined();
  });

  it('a failed platform admin read alone hides the platform links and keeps the menu ready', async () => {
    const m = await mount(orgInput(), {
      scenario: () => {
        scenarios.platform('platformAdminOrgs');
        server.use(http.get('*/api/me/platform', () => HttpResponse.json({ title: 'boom' }, { status: 500 })));
      },
    });
    await waitFor(() => expect(m.client.getQueryState(accessKeys.platform())?.status).toBe('error'));
    await ready(m);
    expect(m.result.current.menu?.state).toBe('ready');
    expect(m.result.current.orgSwitch.platformHref).toBeUndefined();
    expect(m.result.current.menu?.footer).toBeUndefined();
  });

  it('a failed access read gives the Projects item and a menu error whose retry refetches', async () => {
    const m = await mount(orgInput(), {
      scenario: () => {
        scenarios.onboarding('twoOrgs');
        server.use(http.get('*/api/me/access', () => HttpResponse.json({ title: 'boom' }, { status: 500 })));
      },
    });
    await waitFor(() => expect(m.result.current.menu?.state).toBe('error'));
    expect(labels(m.result.current)).toEqual(['Projects']);
    server.resetHandlers();
    act(() => m.result.current.onRetryMenu());
    await ready(m);
  });
});

describe('useShellData: the org list states (BR-80)', () => {
  it.each([
    ['orgs-pending', 'ready', 'loading'],
    ['orgs-failed', 'error', 'error'],
  ] as const)('org list %s: only Projects, no tenant request, no org name', async (hold, menuState, listStatus) => {
    const m = await mount(orgInput(), { hold });
    await waitFor(() =>
      expect(m.result.current.orgSwitch.list?.status).toBe(listStatus === 'loading' ? 'loading' : 'error'),
    );
    expect(m.result.current.menu?.state).toBe(menuState);
    expect(labels(m.result.current)).toEqual(['Projects']);
    expect(m.result.current.menu?.footer).toBeUndefined();
    expect(m.result.current.titleScope).toBeUndefined();
    expect(m.result.current.orgSwitch.current).toBeNull();
    expect(m.requests('/api/me/access')).toEqual([]);
    expect(m.requests('/api/projects')).toEqual([]);
  });

  it('a project page with the org list pending: Runs only, a project placeholder, no project request', async () => {
    const m = await mount(projectInput(), { hold: 'orgs-pending' });
    await waitFor(() => expect(m.result.current.menu).not.toBeNull());
    expect(labels(m.result.current)).toEqual(['Runs']);
    expect(m.result.current.projectPlaceholder).toBe(true);
    expect(m.result.current.projectSwitch).toBeUndefined();
    expect(m.requests('/api/projects')).toEqual([]);
  });

  it('the org list failing on a project page adds the menu error, and its retry reaches the ready menu', async () => {
    const m = await mount(projectInput(), { hold: 'orgs-failed' });
    await waitFor(() => expect(m.result.current.menu?.state).toBe('error'));
    expect(labels(m.result.current)).toEqual(['Runs']);
    server.resetHandlers();
    act(() => m.result.current.onRetryMenu());
    await ready(m);
    expect(labels(m.result.current)).toContain('Runs');
  });
});

describe('useShellData: tenant query conditions', () => {
  it('a suspended org gets no menu and no tenant request, from its page and from /invitations', async () => {
    const m = await mount(orgInput(), { scenario: () => scenarios.platform('suspendedMember') });
    await waitFor(() => expect(m.result.current.orgSwitch.orgs.length).toBeGreaterThan(0));
    expect(m.result.current.menu).toBeNull();
    const personal: ShellInput = {
      chrome: standard({ scope: 'personal', item: 'projects', crumb: 'My invitations' }),
      pathname: '/invitations',
      params: {},
    };
    m.rerender(personal);
    expect(m.result.current.menu).toBeNull();
    expect(m.requests('/api/me/access')).toEqual([]);
    expect(m.requests('/api/projects')).toEqual([]);
  });

  it('personal pages use the session access (the active org) and the My invitations crumb', async () => {
    const m = await mount({
      chrome: standard({ scope: 'personal', item: 'projects', crumb: 'My invitations' }),
      pathname: '/invitations',
      params: {},
    });
    await ready(m);
    expect(m.client.getQueryState(accessKeys.session())?.status).toBe('success');
    expect(m.result.current.menu?.label).toBe('Organization menu');
    expect(m.result.current.crumbs).toEqual([{ label: 'My invitations' }]);
  });

  it('Review Focus 1: the session org turns to B while the URL stays on A: loading menu, no A-keyed request', async () => {
    const m = await mount(orgInput());
    await ready(m);
    seen = [];
    act(() => {
      m.client.setQueryData(sessionQuery.queryKey, (prev: Session | null | undefined) =>
        prev ? { ...prev, activeOrganizationId: ids.org.acme } : prev,
      );
    });
    await waitFor(() => expect(m.result.current.menu?.state).toBe('loading'));
    expect(labels(m.result.current)).toEqual(['Projects']);
    expect(m.result.current.menu?.footer).toBeUndefined();
    expect(m.requests('/api/')).toEqual([]);
  });

  it('a URL on another org than the shown params sends no request for the shown org', async () => {
    const m = await mount(orgInput(), { path: '/o/acme/projects' });
    expect(m.result.current.menu?.state).toBe('loading');
    expect(m.requests('/api/me/access')).toEqual([]);
  });

  it('no tenant query on platform pages, and a non-admin sends no /api/platform request', async () => {
    const m = await mount({
      chrome: standard({ scope: 'platform', item: 'platformOrgs', crumb: 'Organizations' }),
      pathname: '/platform/orgs',
      params: {},
    });
    await waitFor(() => expect(m.client.getQueryState(accessKeys.platform())?.status).toBe('success'));
    expect(m.result.current.menu).toBeNull();
    expect(m.requests('/api/me/access')).toEqual([]);
    expect(m.requests('/api/platform')).toEqual([]);
    expect(m.requests('/api/projects')).toEqual([]);
  });

  it('a platform admin gets the platform menu with Organizations current', async () => {
    const m = await mount(
      {
        chrome: standard({ scope: 'platform', item: 'platformOrgs', crumb: 'Organizations' }),
        pathname: '/platform/orgs',
        params: {},
      },
      { scenario: () => scenarios.platform('platformAdminOrgs') },
    );
    await waitFor(() => expect(m.result.current.menu?.label).toBe('Platform menu'));
    expect(currentOf(m.result.current)).toEqual(['Organizations']);
    expect(m.result.current.orgSwitch.scope).toBe('platform');
    expect(m.requests('/api/me/access')).toEqual([]);
  });
});

describe('useShellData: project pages', () => {
  it('shows the project, repo with its branch and the lazy switcher; the list is fetched only on open', async () => {
    const m = await mount(projectInput());
    await ready(m);
    const d = m.result.current;
    expect(labels(d)).toContain('Runs');
    expect(d.projectPlaceholder).toBe(false);
    expect(d.titleScope).toBe('invoicer-api');
    expect(d.menu?.footer).toMatchObject({
      kind: 'repo',
      repo: {
        owner: 'harbor-labs',
        name: 'invoicer-api',
        branch: 'main',
        repoUrl: 'https://github.com/harbor-labs/invoicer-api',
      },
    });
    expect(d.projectSwitch?.status).toBe('loading');
    expect(d.projectSwitch?.allProjectsHref).toBe('/o/alice/projects');
    expect(d.projectSwitch?.newProjectHref).toBe('/o/alice/projects/new/repo');
    // Detail, connection and access only: no list, no per-project extras.
    expect(
      m
        .requests('/api/projects')
        .map((r) => r.path)
        .sort(),
    ).toEqual([`/api/projects/${P1}`, `/api/projects/${P1}/connection`]);
    act(() => m.result.current.projectSwitch?.onOpen?.());
    await waitFor(() => expect(m.result.current.projectSwitch?.status).toBe('ready'));
    expect(m.requests('/api/projects').some((r) => r.path === '/api/projects')).toBe(true);
  });

  it('the run page adds a Runs link before Run {n}; item runs is the parent', async () => {
    const m = await mount(
      projectInput({
        chrome: standard({ scope: 'project', item: 'runs', parent: true, crumb: 'Run' }),
        pathname: `/o/alice/p/${P1}/runs/62`,
        params: { org: 'alice', project: P1, run: '62' },
      }),
    );
    await ready(m);
    expect(m.result.current.crumbs).toEqual([{ label: 'Runs', href: `/o/alice/p/${P1}/runs` }, { label: 'Run 62' }]);
    expect(m.result.current.titleScope).toBe('invoicer-api');
  });

  it('a project with no default branch shows the repo with no branch', async () => {
    const m = await mount(projectInput(), { scenario: () => applyShellScenario('noDefaultBranch') });
    await ready(m);
    expect(m.result.current.menu?.footer).toMatchObject({ kind: 'repo', repo: { branch: null } });
  });

  it('after a cached success a 404 refetch removes the name, switcher and repo', async () => {
    const m = await mount(projectInput());
    await ready(m);
    expect(m.result.current.projectSwitch).toBeDefined();
    scenarios.problem('projects.get', { status: 404, title: 'Project not found', type: 'not-found' });
    await act(async () => {
      await m.client.refetchQueries({ queryKey: projectsQueries.detail('alice', P1).queryKey });
    });
    await waitFor(() => expect(m.result.current.projectSwitch).toBeUndefined());
    const d = m.result.current;
    expect(d.menu?.label).toBe('Organization menu');
    expect(d.titleScope).toBeUndefined();
    expect(d.menu?.footer).toBeUndefined();
  });

  it('a 500 with no data gives Runs only, a menu error and a project placeholder', async () => {
    scenarios.serverError('projects.get');
    const m = await mount(projectInput());
    await waitFor(() => expect(m.result.current.menu?.state).toBe('error'));
    const d = m.result.current;
    expect(labels(d)).toEqual(['Runs']);
    expect(d.projectPlaceholder).toBe(true);
    expect(d.projectSwitch).toBeUndefined();
    expect(d.titleScope).toBeUndefined();
  });
});

describe('useShellData: error pages', () => {
  it.each(['notFound', 'forbidden'] as const)(
    '%s on a project page keeps the project menu and marks no item',
    async (pageState) => {
      const m = await mount(projectInput({ pageState }));
      await ready(m);
      expect(m.result.current.menu?.label).toBe('Project menu');
      expect(currentOf(m.result.current)).toEqual([]);
      expect(m.result.current.goToProjectsHref).toBe('/o/alice/projects');
    },
  );

  it('a project that is gone (404) falls back to the org menu, marks no item and goes to that org', async () => {
    scenarios.problem('projects.get', { status: 404, title: 'Project not found', type: 'not-found' });
    const m = await mount(projectInput({ pageState: 'notFound' }));
    await waitFor(() => expect(m.result.current.menu?.label).toBe('Organization menu'));
    await ready(m);
    expect(currentOf(m.result.current)).toEqual([]);
    expect(m.result.current.crumbs).toEqual([]);
    expect(m.result.current.projectPlaceholder).toBe(false);
  });

  it('a project page whose session is still loading keeps the project placeholder once the org list is ready', async () => {
    const m = await mount(projectInput(), { hold: 'session-pending' });
    await waitFor(() => expect(m.result.current.orgSwitch.orgs.length).toBeGreaterThan(0));
    expect(m.result.current.projectPlaceholder).toBe(true);
  });

  it('a project 404 on a non-error page falls back to the org menu with no item marked', async () => {
    scenarios.problem('projects.get', { status: 404, title: 'Project not found', type: 'not-found' });
    const m = await mount(projectInput({ chrome: standard({ scope: 'project', item: 'members', crumb: 'Members' }) }));
    await waitFor(() => expect(m.result.current.menu?.label).toBe('Organization menu'));
    await ready(m);
    expect(currentOf(m.result.current)).toEqual([]);
    expect(labels(m.result.current)).toContain('Members');
  });

  it('a project page of an org the user is not a member of: no project placeholder and no menu', async () => {
    const m = await mount(projectInput({ pathname: `/o/nobody/p/${P1}/runs`, params: { org: 'nobody', project: P1 } }));
    await waitFor(() => expect(m.result.current.orgSwitch.orgs.length).toBeGreaterThan(0));
    expect(m.result.current.projectPlaceholder).toBe(false);
    expect(m.result.current.menu).toBeNull();
    expect(m.requests('/api/projects')).toEqual([]);
  });

  it('a project page of a suspended org: no project placeholder and no menu', async () => {
    const m = await mount(projectInput(), { scenario: () => scenarios.platform('suspendedMember') });
    await waitFor(() => expect(m.result.current.orgSwitch.orgs.length).toBeGreaterThan(0));
    expect(m.result.current.projectPlaceholder).toBe(false);
    expect(m.result.current.menu).toBeNull();
    expect(m.requests('/api/projects')).toEqual([]);
  });

  it('forbidden keeps the page crumb; the error state marks the page item', async () => {
    const m = await mount(orgInput({ pageState: 'forbidden' }));
    await ready(m);
    expect(m.result.current.crumbs).toEqual([{ label: 'Projects' }]);
    m.rerender(orgInput({ pageState: 'error' }));
    expect(currentOf(m.result.current)).toEqual(['Projects']);
  });

  it('a non-member org slug gives no menu and goes to /', async () => {
    const m = await mount(
      orgInput({ pageState: 'notFound', pathname: '/o/nobody/projects', params: { org: 'nobody' } }),
    );
    await waitFor(() => expect(m.result.current.orgSwitch.orgs.length).toBeGreaterThan(0));
    expect(m.result.current.menu).toBeNull();
    expect(m.result.current.goToProjectsHref).toBe('/');
    expect(m.requests('/api/me/access')).toEqual([]);
  });

  it('scope none gives no menu', async () => {
    const m = await mount({ chrome: standard({ scope: undefined }), pathname: '/sign-in', params: {} });
    await waitFor(() => expect(m.result.current.orgSwitch.orgs.length).toBeGreaterThan(0));
    expect(m.result.current.menu).toBeNull();
  });
});

describe('useShellData: platform org pages', () => {
  const platformOrg = (orgId: string, extra: Partial<ShellInput> = {}): ShellInput => ({
    chrome: standard({ scope: 'platformOrg', item: 'orgMembers', crumb: 'Members' }),
    pathname: `/platform/orgs/${orgId}/members`,
    params: { orgId },
    ...extra,
  });
  const admin = () => scenarios.platform('platformAdminOrgs');

  it('loading, then the org name in the crumbs, header and title scope', async () => {
    const m = await mount(platformOrg(FIRST_ORG.id), { scenario: admin });
    expect(m.result.current.crumbs[1]).toMatchObject({ loading: true });
    await waitFor(() => expect(m.result.current.menu?.header).toMatchObject({ name: FIRST_ORG.name }));
    expect(m.result.current.crumbs.map((c) => c.label)).toEqual(['Organizations', FIRST_ORG.name, 'Members']);
    expect(m.result.current.titleScope).toBe('Platform');
    expect(currentOf(m.result.current)).toEqual(['Members']);
  });

  it('a failed read names the org "Organization"', async () => {
    scenarios.serverError('platform.getOrg');
    const m = await mount(platformOrg(FIRST_ORG.id), { scenario: admin });
    await waitFor(() => expect(m.result.current.menu?.header).toEqual({ name: 'Organization' }));
    expect(m.result.current.crumbs.map((c) => c.label)).toEqual(['Organizations', 'Organization', 'Members']);
  });

  it('a missing org gives the platform menu with Organizations current', async () => {
    const m = await mount(platformOrg('b6000000-0000-4000-8000-0000000000ff'), { scenario: admin });
    await waitFor(() => expect(m.result.current.menu?.label).toBe('Platform menu'));
    await waitFor(() => expect(currentOf(m.result.current)).toEqual(['Organizations']));
    expect(m.result.current.menu?.header).toBeUndefined();
    expect(m.result.current.goToProjectsHref).toBe('/');
  });
});

describe('useShellData: agent and settings (BR-7)', () => {
  it('has no search in its input: the same input gives the same menu item, crumbs and title scope', async () => {
    const input = projectInput({
      chrome: standard({ scope: 'project', item: 'agent', crumb: 'Agent & settings' }),
      pathname: `/o/alice/p/${P1}/desk/agent`,
    });
    const m = await mount(input);
    await ready(m);
    const first = {
      item: currentOf(m.result.current),
      crumbs: m.result.current.crumbs,
      scope: m.result.current.titleScope,
    };
    m.rerender({ ...input });
    expect({
      item: currentOf(m.result.current),
      crumbs: m.result.current.crumbs,
      scope: m.result.current.titleScope,
    }).toEqual(first);
    expect(first.item).toEqual(['Agent & settings']);
  });
});
