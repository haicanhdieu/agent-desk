import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { problemResponse, routeDef } from '@/mocks/msw/http';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { platformKeys } from '../platform/keys';
import { useCreateOrgWithOwner } from './createOrg';

// Creating an org and inviting its owner write platform audit entries (`org.created`, `invitation.created`), so the
// cached audit pages (fresh for 30 s) must read again.
const AUDIT_KEY = platformKeys.audit({ org: 'x', page: 1 });

function setup() {
  scenarios.platform('platformAdminOrgs');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  queryClient.setQueryData(AUDIT_KEY, { items: [], total: 0, page: 1, pageSize: 20 });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useCreateOrgWithOwner: the audit log reads again', () => {
  it('invalidates the platform audit after the org and again after its owner invitation are created', async () => {
    const { queryClient, wrapper } = setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateOrgWithOwner({ onOrgSwitched: () => undefined }), { wrapper });
    await act(() => result.current.submit({ name: 'Audit Org', slug: 'audit-org', email: 'owner@example.com' }));
    expect(result.current.state.kind).toBe('created');
    // One call for `org.created`, one for `invitation.created` (an audit read between them would miss the second).
    const auditCalls = invalidate.mock.calls.filter(([filters]) => filters?.queryKey?.join('/') === 'platform/audit');
    expect(auditCalls).toHaveLength(2);
    expect(queryClient.getQueryState(AUDIT_KEY)?.isInvalidated).toBe(true);
  });

  it('invalidates the platform audit as soon as the org exists, even if the invitation then fails', async () => {
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useCreateOrgWithOwner({ onOrgSwitched: () => undefined }), { wrapper });
    const roles = routeDef('platform.listRoles');
    server.use(http.get(roles.path, () => problemResponse({ status: 500, title: 'Down' })));
    await act(() => result.current.submit({ name: 'Audit Org Two', slug: 'audit-org-two', email: 'o@example.com' }));
    expect(result.current.state.kind).toBe('invitationFailed');
    expect(queryClient.getQueryState(AUDIT_KEY)?.isInvalidated).toBe(true);
  });
});
