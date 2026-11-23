import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { accessKeys } from '@/features/access/keys';
import { refreshAccess } from './mutations';

describe('refreshAccess', () => {
  it("reads the org's access and the session-wide access again (the org menu follows a self-demotion)", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(accessKeys.org('alice'), {});
    queryClient.setQueryData(accessKeys.session(), {});
    await refreshAccess(queryClient, 'alice');
    expect(queryClient.getQueryState(accessKeys.org('alice'))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(accessKeys.session())?.isInvalidated).toBe(true);
  });
});
