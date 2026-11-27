import { describe, expect, it, vi } from 'vitest';
import { toOrgSwitch, toOrgSwitchList } from './orgSwitch';

const orgs = [
  { id: 'o1', slug: 'acme', name: 'Acme', status: 'active' as const },
  { id: 'o2', slug: 'beta', name: 'Beta', status: 'active' as const },
];

describe('toOrgSwitch', () => {
  it('finds the current org by slug', () => {
    const data = toOrgSwitch(orgs, 'beta', false);
    expect(data.current).toEqual({ id: 'o2', slug: 'beta', name: 'Beta' });
    expect(data.orgs.map((o) => o.slug)).toEqual(['acme', 'beta']);
  });

  it('passes platformAdmin through', () => {
    expect(toOrgSwitch(orgs, 'acme', true).platformAdmin).toBe(true);
    expect(toOrgSwitch(orgs, 'acme', false).platformAdmin).toBe(false);
  });

  it('gives current null without a slug or for an unknown slug', () => {
    expect(toOrgSwitch(orgs, null, false).current).toBeNull();
    expect(toOrgSwitch(orgs, 'nope', false).current).toBeNull();
  });
});

describe('toOrgSwitch: suspended orgs (BR-48)', () => {
  it('marks only the suspended org, the current one included', () => {
    const list = [orgs[0], { ...orgs[1], status: 'suspended' as const }].flatMap((o) => (o ? [o] : []));
    const data = toOrgSwitch(list, 'beta', false);
    expect(data.orgs.map((o) => o.suspended ?? false)).toEqual([false, true]);
    expect(data.current?.suspended).toBe(true);
  });
});

describe('toOrgSwitchList: the org list states', () => {
  it('no data and no error is loading, with no orgs', () => {
    expect(toOrgSwitchList({ isError: false, refetch: vi.fn() })).toEqual({ orgs: [], list: { status: 'loading' } });
  });

  it('no data and an error is the error state, whose retry refetches', () => {
    const refetch = vi.fn();
    const { orgs: none, list } = toOrgSwitchList({ isError: true, refetch });
    expect(none).toEqual([]);
    expect(list?.status).toBe('error');
    if (list?.status === 'error') list.onRetry();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('data is ready: the orgs and no list state', () => {
    expect(toOrgSwitchList({ data: orgs, isError: false, refetch: vi.fn() })).toEqual({ orgs });
  });

  it('a failed refetch with data keeps the list', () => {
    expect(toOrgSwitchList({ data: orgs, isError: true, refetch: vi.fn() })).toEqual({ orgs });
  });
});
