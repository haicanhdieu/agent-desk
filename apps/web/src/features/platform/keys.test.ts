import { QueryClient } from '@tanstack/react-query';
import { vi, describe, expect, it } from 'vitest';
import { accessKeys } from '../access/keys';
import { orgsQuery, setActiveOrganization } from '../auth/session';
import { platformKeys } from './keys';

vi.mock('../auth/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth/client')>()),
  authClient: { organization: { setActive: vi.fn().mockResolvedValue({ data: {}, error: null }) } },
}));

const q = { page: 1, pageSize: 25 };

describe('platform query keys', () => {
  it('every key starts with platform', () => {
    const keys = [
      platformKeys.all(),
      platformKeys.admins(q),
      platformKeys.orgs(q),
      platformKeys.org('o1'),
      platformKeys.orgList('o1', 'members', q),
      platformKeys.orgList('o1', 'projects', q),
      platformKeys.orgList('o1', 'invitations', q),
      platformKeys.audit(q),
    ];
    for (const key of keys) expect(key[0]).toBe('platform');
  });

  it('every admins list key starts with the admins prefix that grant and revoke invalidate', () => {
    const prefix = platformKeys.adminsAll();
    expect(platformKeys.admins(q).slice(0, prefix.length)).toEqual(prefix);
    expect(platformKeys.admins({ page: 3, pageSize: 50 }).slice(0, prefix.length)).toEqual(prefix);
  });

  it('every directory and org key starts with the orgs prefix that a suspend or reactivate invalidates', () => {
    const prefix = platformKeys.orgsAll();
    for (const key of [platformKeys.orgs(q), platformKeys.org('o1'), platformKeys.orgList('o1', 'members', q)]) {
      expect(key.slice(0, prefix.length)).toEqual(prefix);
    }
  });

  it('the platform-admin flag key is session-wide, outside any org', () => {
    expect(accessKeys.platform()).toEqual(['session', 'platform']);
  });

  it('switching the active org keeps platform data and the platform-admin flag', async () => {
    const client = new QueryClient();
    client.setQueryData(['org', 'acme', 'projects'], ['p']);
    client.setQueryData(platformKeys.admins(q), ['admin']);
    client.setQueryData(platformKeys.org('o1'), { id: 'o1' });
    client.setQueryData(accessKeys.platform(), { platformAdmin: true });
    client.setQueryData(orgsQuery.queryKey, []);
    await setActiveOrganization(client, { id: 'o2', slug: 'beta', name: 'Beta' });
    expect(client.getQueryData(['org', 'acme', 'projects'])).toBeUndefined();
    expect(client.getQueryData(platformKeys.admins(q))).toEqual(['admin']);
    expect(client.getQueryData(platformKeys.org('o1'))).toEqual({ id: 'o1' });
    expect(client.getQueryData(accessKeys.platform())).toEqual({ platformAdmin: true });
  });
});
