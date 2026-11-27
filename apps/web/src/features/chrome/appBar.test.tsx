import type { AccessDto } from '@agentdesk/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tenantAccessFixtures } from '@/mocks/dto/access';
import { accessKeys } from '../access/keys';
import { setActiveOrganization, type Session } from '../auth/session';
import { toAccess } from '../access/queries';
import {
  ORG_SETTINGS_ORDER,
  canOpenSettings,
  firstSettingsTab,
  openOrgHref,
  orgSettingsTabs,
  useAppBar,
} from './appBar';

const apiMock = vi.hoisted(() => ({ access: vi.fn(), listInvitations: vi.fn(), platform: vi.fn() }));
vi.mock('@/features/api', () => ({ api: { me: apiMock } }));
// Only the server call of an org switch is replaced; `authCall` and the cache handling in session.ts are real.
const authMock = vi.hoisted(() => ({ setActive: vi.fn() }));
vi.mock('../auth/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth/client')>()),
  authClient: { organization: { setActive: authMock.setActive } },
}));

type Who = keyof typeof tenantAccessFixtures;
const WHO = Object.keys(tenantAccessFixtures) as Who[];
const ALL = {
  general: '/o/acme/settings/general',
  members: '/o/acme/settings/members',
  invitations: '/o/acme/settings/invitations',
  audit: '/o/acme/settings/audit',
};
const EXPECTED: Record<Who, { tabs: Record<string, string>; first: string | null }> = {
  owner: { tabs: ALL, first: 'members' },
  admin: { tabs: ALL, first: 'members' },
  projectAdmin: { tabs: { invitations: ALL.invitations }, first: 'invitations' },
  member: { tabs: {}, first: null },
  viewer: { tabs: {}, first: null },
  noRole: { tabs: {}, first: null },
};

describe('settings visibility (BR-2, BR-13, BR-44, BR-45)', () => {
  it.each(WHO)('%s: tabs, first tab and canOpenSettings follow the real grants', (who) => {
    const access = toAccess(tenantAccessFixtures[who]);
    expect(orgSettingsTabs('acme', access)).toEqual(EXPECTED[who].tabs);
    expect(firstSettingsTab(access)).toBe(EXPECTED[who].first);
    expect(canOpenSettings(access)).toBe(EXPECTED[who].first !== null);
  });

  it('a platform admin with no org role opens nothing', () => {
    const dto: AccessDto = { ...tenantAccessFixtures.noRole, platformAdmin: true };
    const access = toAccess(dto);
    expect(canOpenSettings(access)).toBe(false);
    expect(orgSettingsTabs('acme', access)).toEqual({});
  });

  it('lists the tabs in the side-menu order and opens the first of them', () => {
    const access = toAccess(tenantAccessFixtures.owner);
    expect(Object.keys(orgSettingsTabs('acme', access))).toEqual([...ORG_SETTINGS_ORDER]);
    expect([...ORG_SETTINGS_ORDER]).toEqual(['members', 'invitations', 'audit', 'general']);
  });
  it('encodes the slug in every href', () => {
    const tabs = orgSettingsTabs('a b', toAccess(tenantAccessFixtures.owner));
    expect(tabs.general).toBe('/o/a%20b/settings/general');
  });
});

const session: Session = {
  user: { id: 'u1', name: 'Alice Park', email: 'alice@example.com', handle: 'alice', image: null },
  activeOrganizationId: 'org-b',
};
const orgs = [
  { id: 'org-a', slug: 'acme', name: 'Acme', status: 'active' as const },
  { id: 'org-b', slug: 'beta', name: 'Beta', status: 'active' as const },
];

/** Like the app's client: fresh data is not refetched for 30s. */
function makeClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  client.setQueryData(['session'], session);
  client.setQueryData(['session', 'orgs'], orgs);
  return client;
}
function setup(client = makeClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return wrapper;
}
/** Waits until the query has finished fetching (data or error), so a "nothing shows" assertion is not read too early. */
const settled = (client: QueryClient, key: readonly unknown[]) =>
  waitFor(() => expect(['success', 'error']).toContain(client.getQueryState(key)?.status));
const invitations = (total: number) => ({ items: [], page: 1, pageSize: 100, total });
const never = () => new Promise<never>(() => undefined);

describe('useAppBar', () => {
  beforeEach(() => {
    apiMock.access.mockReset();
    apiMock.platform.mockReset();
    apiMock.platform.mockResolvedValue({ platformAdmin: false });
    apiMock.listInvitations.mockReset();
    apiMock.listInvitations.mockResolvedValue(invitations(0));
  });

  it.each(WHO)('%s: settingsHref only when a tab may open', async (who) => {
    // platformAdmin is set only so the render that holds the loaded access is observable (it never opens Settings).
    apiMock.access.mockResolvedValue(tenantAccessFixtures[who]);
    apiMock.platform.mockResolvedValue({ platformAdmin: true });
    const client = makeClient();
    const { result } = renderHook(() => useAppBar('acme'), { wrapper: setup(client) });
    await settled(client, accessKeys.org('acme'));
    if (EXPECTED[who].first === null) {
      await waitFor(() => expect(result.current.org.platformAdmin).toBe(true));
      expect(result.current.org.settingsHref).toBeUndefined();
    } else {
      await waitFor(() => expect(result.current.org.settingsHref).toBe('/o/acme/settings'));
    }
    expect(result.current.org.projectsHref).toBe('/o/acme/projects');
  });

  it('no settingsHref while access is pending or failed', async () => {
    apiMock.access.mockReturnValue(never());
    const pending = renderHook(() => useAppBar('acme'), { wrapper: setup() });
    expect(pending.result.current.org.settingsHref).toBeUndefined();
    apiMock.access.mockRejectedValue(new Error('boom'));
    const client = makeClient();
    const failed = renderHook(() => useAppBar('acme'), { wrapper: setup(client) });
    await settled(client, accessKeys.org('acme'));
    expect(client.getQueryState(accessKeys.org('acme'))?.status).toBe('error');
    expect(failed.result.current.org.settingsHref).toBeUndefined();
  });

  it('a platform admin with no org role gets no Settings item', async () => {
    apiMock.access.mockResolvedValue(tenantAccessFixtures.noRole);
    apiMock.platform.mockResolvedValue({ platformAdmin: true });
    const { result } = renderHook(() => useAppBar('acme'), { wrapper: setup() });
    await waitFor(() => expect(result.current.org.platformAdmin).toBe(true));
    expect(result.current.org.settingsHref).toBeUndefined();
  });

  it('user, current org and the several orgs come from the session', async () => {
    apiMock.access.mockResolvedValue(tenantAccessFixtures.owner);
    const { result } = renderHook(() => useAppBar('acme'), { wrapper: setup() });
    expect(result.current.user).toEqual({ login: 'alice', initials: 'AL' });
    expect(result.current.org.current?.slug).toBe('acme');
    expect(result.current.org.orgs).toHaveLength(2);
    expect(result.current.org.orgHref({ id: 'org-b', slug: 'beta', name: 'Beta' })).toBe('/o/beta/projects');
    expect(result.current.org.createHref).toBe('/platform/orgs/new');
  });

  it('personal pages (null slug) use the session access and the active org', async () => {
    apiMock.access.mockResolvedValue(tenantAccessFixtures.admin);
    const { result } = renderHook(() => useAppBar(null), { wrapper: setup() });
    expect(result.current.org.current?.slug).toBe('beta');
    await waitFor(() => expect(result.current.org.settingsHref).toBe('/o/beta/settings'));
    expect(result.current.org.projectsHref).toBe('/o/beta/projects');
  });

  it('after an org switch, a personal page reads the new active org access, not the cached one', async () => {
    authMock.setActive.mockResolvedValue({ data: {}, error: null });
    const client = makeClient();
    client.setQueryData(['session'], { ...session, activeOrganizationId: 'org-a' });
    apiMock.access.mockResolvedValue(tenantAccessFixtures.owner);
    const first = renderHook(() => useAppBar(null), { wrapper: setup(client) });
    await waitFor(() => expect(first.result.current.org.settingsHref).toBe('/o/acme/settings'));
    first.unmount();

    // The user opens /o/beta/... where they are only a member: the active org switches to beta.
    await setActiveOrganization(client, orgs[1]);
    apiMock.access.mockResolvedValue(tenantAccessFixtures.member);
    const second = renderHook(() => useAppBar(null), { wrapper: setup(client) });
    // The new org's grants load again; the session-wide platform flag is not org data and stays cached.
    await settled(client, accessKeys.session());
    await waitFor(() => expect(client.getQueryState(accessKeys.session())?.status).toBe('success'));
    expect(second.result.current.org.current?.slug).toBe('beta');
    expect(second.result.current.org.settingsHref).toBeUndefined();
    expect(apiMock.access).toHaveBeenCalledTimes(2);
  });

  it('BR-1: a platform admin gets platformHref on an org page and on a personal page', async () => {
    apiMock.access.mockResolvedValue(tenantAccessFixtures.member);
    apiMock.platform.mockResolvedValue({ platformAdmin: true });
    const org = renderHook(() => useAppBar('acme'), { wrapper: setup() });
    await waitFor(() => expect(org.result.current.org.platformHref).toBe('/platform'));
    const personal = renderHook(() => useAppBar(null), { wrapper: setup() });
    await waitFor(() => expect(personal.result.current.org.platformHref).toBe('/platform'));
    expect(personal.result.current.org.platformAdmin).toBe(true);
  });

  it('the logo of a platform admin with no org goes to Platform > Organizations', async () => {
    apiMock.access.mockResolvedValue(tenantAccessFixtures.noRole);
    apiMock.platform.mockResolvedValue({ platformAdmin: true });
    const client = makeClient();
    client.setQueryData(['session', 'orgs'], []);
    client.setQueryData(['session'], { ...session, activeOrganizationId: null });
    const { result } = renderHook(() => useAppBar(null), { wrapper: setup(client) });
    await waitFor(() => expect(result.current.org.projectsHref).toBe('/platform/orgs'));
  });

  it('the logo of a platform admin who has an org keeps the org projects target', async () => {
    apiMock.access.mockResolvedValue(tenantAccessFixtures.member);
    apiMock.platform.mockResolvedValue({ platformAdmin: true });
    const { result } = renderHook(() => useAppBar(null), { wrapper: setup() });
    await waitFor(() => expect(result.current.org.platformAdmin).toBe(true));
    expect(result.current.org.projectsHref).toBe('/o/beta/projects');
  });

  it('the logo of a person with no org who is not a platform admin keeps today target', async () => {
    const client = makeClient();
    client.setQueryData(['session', 'orgs'], []);
    client.setQueryData(['session'], { ...session, activeOrganizationId: null });
    apiMock.platform.mockResolvedValue({ platformAdmin: false });
    const { result } = renderHook(() => useAppBar(null), { wrapper: setup(client) });
    await settled(client, accessKeys.platform());
    expect(result.current.org.projectsHref).toBeUndefined();
  });

  it('BR-1: a person who is not a platform admin gets no platformHref', async () => {
    apiMock.access.mockResolvedValue(tenantAccessFixtures.owner);
    const client = makeClient();
    const { result } = renderHook(() => useAppBar('acme'), { wrapper: setup(client) });
    await settled(client, accessKeys.platform());
    expect(result.current.org.platformHref).toBeUndefined();
    expect(result.current.org.platformAdmin).toBe(false);
  });

  it('a failing me.platform hides the item and does not crash', async () => {
    apiMock.access.mockResolvedValue(tenantAccessFixtures.owner);
    apiMock.platform.mockRejectedValue(new Error('boom'));
    const client = makeClient();
    const { result } = renderHook(() => useAppBar('acme'), { wrapper: setup(client) });
    await settled(client, accessKeys.platform());
    expect(client.getQueryState(accessKeys.platform())?.status).toBe('error');
    expect(result.current.org.platformHref).toBeUndefined();
  });

  it('a platform admin gets manageHref for the current org, matched by id', async () => {
    apiMock.access.mockResolvedValue(tenantAccessFixtures.member);
    apiMock.platform.mockResolvedValue({ platformAdmin: true });
    const { result } = renderHook(() => useAppBar('acme'), { wrapper: setup() });
    await waitFor(() => expect(result.current.org.manageHref).toBe('/platform/orgs/org-a'));
  });

  it('a person who is not a platform admin gets no manageHref', async () => {
    apiMock.access.mockResolvedValue(tenantAccessFixtures.owner);
    const client = makeClient();
    const { result } = renderHook(() => useAppBar('acme'), { wrapper: setup(client) });
    await settled(client, accessKeys.platform());
    expect(result.current.org.manageHref).toBeUndefined();
  });

  it('a platform admin with no current org gets no manageHref', async () => {
    apiMock.platform.mockResolvedValue({ platformAdmin: true });
    const client = makeClient();
    client.setQueryData(['session', 'orgs'], []);
    client.setQueryData(['session'], { ...session, activeOrganizationId: null });
    const { result } = renderHook(() => useAppBar(null), { wrapper: setup(client) });
    await waitFor(() => expect(result.current.org.platformAdmin).toBe(true));
    expect(result.current.org.manageHref).toBeUndefined();
  });
});

describe('openOrgHref', () => {
  const memberships = [
    { id: 'org-a', slug: 'acme' },
    { id: 'org-b', slug: 'beta' },
  ];
  it('returns the projects page of the membership with that id', () => {
    expect(openOrgHref(memberships, 'org-b')).toBe('/o/beta/projects');
  });
  it('returns undefined for an id that is not a membership', () => {
    expect(openOrgHref(memberships, 'org-z')).toBeUndefined();
  });
  it('matches ids, never slugs', () => {
    expect(openOrgHref(memberships, 'acme')).toBeUndefined();
  });
});
