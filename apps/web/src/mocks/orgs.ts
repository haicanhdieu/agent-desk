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

const base = {
  oneOrg: { current: acme, orgs: [acme], platformAdmin: false },
  severalOrgs: { current: acme, orgs: [acme, beta], platformAdmin: false },
  platformAdmin: { current: acme, orgs: [acme, beta], platformAdmin: true },
  platformAdminNoOrg: { current: null, orgs: [], platformAdmin: true },
  longName: { current: long, orgs: [acme, long], platformAdmin: false },
} satisfies Record<string, OrgSwitchData>;

export const orgSwitchFixtures: Record<keyof typeof base, OrgSwitchData> = base;
