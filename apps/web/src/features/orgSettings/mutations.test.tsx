import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { orgsQuery } from '@/features/auth/session';
import { ids } from '@/mocks/dto/ids';
import { useUpdateOrg } from './mutations';

const AUDIT_KEY = (org: string) => ['org', org, 'audit', 'list', 1, 20] as const;

describe('useUpdateOrg: the audit log reads again', () => {
  const setup = () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(orgsQuery.queryKey, [{ id: ids.org.alice, name: 'Alice', slug: 'alice' }]);
    for (const org of ['alice', 'alice-2']) queryClient.setQueryData(AUDIT_KEY(org), { items: [] });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return { queryClient, wrapper };
  };

  it('a rename invalidates the org audit', async () => {
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useUpdateOrg('alice', ids.org.alice), { wrapper });
    await act(() => result.current.mutateAsync({ name: 'Alice Inc' }));
    expect(queryClient.getQueryState(AUDIT_KEY('alice'))?.isInvalidated).toBe(true);
  });

  it('a slug change invalidates the audit under the new slug (the old slug cache is dropped by the page)', async () => {
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useUpdateOrg('alice', ids.org.alice), { wrapper });
    await act(() => result.current.mutateAsync({ slug: 'alice-2' }));
    expect(queryClient.getQueryState(AUDIT_KEY('alice-2'))?.isInvalidated).toBe(true);
  });
});
