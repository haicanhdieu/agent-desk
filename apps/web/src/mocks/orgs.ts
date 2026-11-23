import type { OrgOption, OrgSwitchData } from './types';

export const orgOptions: OrgOption[] = [
  { id: '0b1c0000-0000-4000-8000-000000000001', slug: 'acme', name: 'Acme' },
  { id: '0b1c0000-0000-4000-8000-000000000002', slug: 'beta', name: 'Beta' },
  {
    id: '0b1c0000-0000-4000-8000-000000000003',
    slug: 'a-very-long-organization-name',
    name: 'Northern Lights Cooperative for Applied Robotics and Sensing',
  },
];

const [acme, beta, long] = orgOptions;

const withLinks = (data: OrgSwitchData): OrgSwitchData =>
  data.current
    ? { ...data, projectsHref: `/o/${data.current.slug}`, settingsHref: `/o/${data.current.slug}/settings` }
    : data;

const base = {
  oneOrg: { current: acme, orgs: [acme], platformAdmin: false },
  severalOrgs: { current: acme, orgs: [acme, beta], platformAdmin: false },
  platformAdmin: { current: acme, orgs: [acme, beta], platformAdmin: true },
  platformAdminNoOrg: { current: null, orgs: [], platformAdmin: true },
  longName: { current: long, orgs: [acme, long], platformAdmin: false },
} satisfies Record<string, OrgSwitchData>;

/** The five base entries have no hrefs (menu without Projects or Settings); the `…Settings` variants carry both (owner or admin). */
export const orgSwitchFixtures: Record<
  keyof typeof base | 'oneOrgSettings' | 'severalOrgsSettings' | 'platformAdminSettings' | 'longNameSettings',
  OrgSwitchData
> = {
  ...base,
  oneOrgSettings: withLinks(base.oneOrg),
  severalOrgsSettings: withLinks(base.severalOrgs),
  platformAdminSettings: withLinks(base.platformAdmin),
  longNameSettings: withLinks(base.longName),
};
