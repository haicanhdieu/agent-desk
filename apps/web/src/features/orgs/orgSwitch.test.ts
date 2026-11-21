import { describe, expect, it } from 'vitest';
import { toOrgSwitch } from './orgSwitch';

const orgs = [
  { id: 'o1', slug: 'acme', name: 'Acme' },
  { id: 'o2', slug: 'beta', name: 'Beta' },
];

describe('toOrgSwitch', () => {
  it('finds the current org by slug', () => {
    const data = toOrgSwitch(orgs, 'beta', false);
    expect(data.current).toEqual(orgs[1]);
    expect(data.orgs).toEqual(orgs);
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
