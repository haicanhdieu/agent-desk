import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { orgsQuery } from '@/features/auth/session';
import { roleFixtures } from '@/mocks/dto/access';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { useCreateInvitation, useResendInvitation, useRevokeInvitation } from './mutations';

const AUDIT_KEY = ['org', 'alice', 'audit', 'list', 1, 20] as const;
const LIST_KEY = ['org', 'alice', 'invitations', 'list', 'pending', 1, 20] as const;

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(orgsQuery.queryKey, [{ id: ids.org.alice, name: 'Alice', slug: 'alice', status: 'active' }]);
  queryClient.setQueryData(AUDIT_KEY, { items: [], total: 0, page: 1, pageSize: 20 });
  queryClient.setQueryData(LIST_KEY, { items: [], total: 0, page: 1, pageSize: 20 });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('invitation mutations: the audit log reads again', () => {
  it('create invalidates the org audit', async () => {
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useCreateInvitation('alice'), { wrapper });
    await act(() => result.current.mutateAsync({ email: 'new@x.dev', roleId: memberRoleId(), scope: { type: 'org' } }));
    expect(queryClient.getQueryState(AUDIT_KEY)?.isInvalidated).toBe(true);
  });

  it('resend invalidates the org audit', async () => {
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useResendInvitation('alice'), { wrapper });
    await act(() => result.current.mutateAsync(aliceInvitation().id));
    expect(queryClient.getQueryState(AUDIT_KEY)?.isInvalidated).toBe(true);
  });

  it('revoke invalidates the org audit', async () => {
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useRevokeInvitation('alice'), { wrapper });
    await act(() => result.current.mutateAsync(aliceInvitation().id));
    expect(queryClient.getQueryState(AUDIT_KEY)?.isInvalidated).toBe(true);
  });
});

function memberRoleId(): string {
  const role = roleFixtures.find((r) => r.key === 'member');
  if (!role) throw new Error('member role fixture missing');
  return role.id;
}

/** A pending invitation of the alice org that does not expire during the test. */
function aliceInvitation() {
  const template = mockDb.state.invitations[0];
  if (!template) throw new Error('no invitation in the seed');
  const row = {
    ...template,
    id: 'b3200000-0000-4000-8000-0000000000aa',
    orgId: ids.org.alice,
    status: 'pending' as const,
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
  mockDb.state.invitations.push(row);
  return row;
}
