import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { platformAdminFixtures, roleFixtures } from '@/mocks/dto/access';
import { platformMemberFixtures, platformOrgDtoFixtures } from '@/mocks/dto/platform';
import { scenarios } from '@/mocks/msw/scenarios';
import { orgsQuery } from '../auth/session';
import { platformKeys } from './keys';
import {
  useAddPlatformAssignment,
  useGrantPlatformAdmin,
  useRemovePlatformAssignment,
  useRevokePlatformAdmin,
  useSetOrgStatus,
  useUpdatePlatformOrg,
} from './mutations';

// Every platform change writes a platform audit entry, so the cached audit pages (fresh for 30 s) must read again.
const AUDIT_KEY = platformKeys.audit({ org: 'x', page: 1 });
const orgId = platformOrgDtoFixtures[0]?.id ?? '';

function setup() {
  scenarios.platform('platformAdminOrgs');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  queryClient.setQueryData(orgsQuery.queryKey, []);
  queryClient.setQueryData(AUDIT_KEY, { items: [], total: 0, page: 1, pageSize: 20 });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const audited = (queryClient: QueryClient) => queryClient.getQueryState(AUDIT_KEY)?.isInvalidated;

describe('platform mutations: the audit log reads again', () => {
  it('editing an org invalidates the platform audit', async () => {
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useUpdatePlatformOrg(orgId), { wrapper });
    await act(() => result.current.mutateAsync({ name: 'Acme Renamed' }));
    expect(audited(queryClient)).toBe(true);
  });

  it('suspending an org invalidates the platform audit', async () => {
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useSetOrgStatus(orgId), { wrapper });
    await act(() => result.current.mutateAsync({ to: 'suspended', reason: 'Unpaid' }));
    expect(audited(queryClient)).toBe(true);
  });

  it('adding and removing an assignment invalidate the platform audit', async () => {
    const { queryClient, wrapper } = setup();
    const role = roleFixtures.find((r) => r.key === 'viewer');
    const person = platformMemberFixtures.find((m) => m.assignments.length === 0);
    if (!role || !person) throw new Error('fixture missing');
    const add = renderHook(() => useAddPlatformAssignment(orgId), { wrapper });
    let id = '';
    await act(async () => {
      id = (await add.result.current.mutateAsync({ userId: person.userId, roleId: role.id, scope: { type: 'org' } }))
        .id;
    });
    expect(audited(queryClient)).toBe(true);
    queryClient.setQueryData(AUDIT_KEY, { items: [], total: 0, page: 1, pageSize: 20 });
    const remove = renderHook(() => useRemovePlatformAssignment(orgId), { wrapper });
    await act(() => remove.result.current.mutateAsync({ assignmentId: id }));
    expect(audited(queryClient)).toBe(true);
  });

  it('granting and revoking a platform admin invalidate the platform audit', async () => {
    const { queryClient, wrapper } = setup();
    const grant = renderHook(() => useGrantPlatformAdmin(), { wrapper });
    await act(() => grant.result.current.mutateAsync({ email: 'pat@example.com' }));
    expect(audited(queryClient)).toBe(true);
    queryClient.setQueryData(AUDIT_KEY, { items: [], total: 0, page: 1, pageSize: 20 });
    const revoke = renderHook(() => useRevokePlatformAdmin(), { wrapper });
    const adminId = platformAdminFixtures[1]?.id ?? '';
    await act(() => revoke.result.current.mutateAsync({ adminId, own: false }));
    expect(audited(queryClient)).toBe(true);
  });
});

describe('platform mutations: an assignment change leaves the project lists alone', () => {
  it('adding and removing an assignment refetch members and the directory, not the all-projects query', async () => {
    const { queryClient, wrapper } = setup();
    const membersKey = platformKeys.orgList(orgId, 'members', { page: 1 });
    const directoryKey = platformKeys.orgs({ page: 1 });
    const projectsKey = platformKeys.orgList(orgId, 'projects', { all: true });
    const seed = () => {
      for (const key of [membersKey, directoryKey, projectsKey]) queryClient.setQueryData(key, []);
    };
    const invalidated = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;
    const role = roleFixtures.find((r) => r.key === 'viewer');
    const person = platformMemberFixtures.find((m) => m.assignments.length === 0);
    if (!role || !person) throw new Error('fixture missing');

    seed();
    const add = renderHook(() => useAddPlatformAssignment(orgId), { wrapper });
    let id = '';
    await act(async () => {
      id = (await add.result.current.mutateAsync({ userId: person.userId, roleId: role.id, scope: { type: 'org' } }))
        .id;
    });
    expect(invalidated(membersKey)).toBe(true);
    expect(invalidated(directoryKey)).toBe(true);
    expect(invalidated(projectsKey)).toBe(false);

    seed();
    const remove = renderHook(() => useRemovePlatformAssignment(orgId), { wrapper });
    await act(() => remove.result.current.mutateAsync({ assignmentId: id }));
    expect(invalidated(membersKey)).toBe(true);
    expect(invalidated(directoryKey)).toBe(true);
    expect(invalidated(projectsKey)).toBe(false);
  });
});
