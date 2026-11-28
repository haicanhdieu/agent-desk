import type { AccessDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { tenantAccessFixtures } from '@/mocks/dto/access';
import { toAccess } from '../access/queries';
import { ORG_SETTINGS_ORDER, canOpenSettings, firstSettingsTab, openOrgHref, orgSettingsTabs } from './appBar';

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
