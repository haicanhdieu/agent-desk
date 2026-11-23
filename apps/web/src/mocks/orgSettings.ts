import type { OrgSettingsTabKey } from './types';

export const orgSettingsFixtures: {
  org: { name: 'Harbor Labs'; slug: 'harbor-labs' };
  tabs: Record<'owner' | 'admin' | 'projectAdmin', OrgSettingsTabKey[]>;
} = {
  org: { name: 'Harbor Labs', slug: 'harbor-labs' },
  tabs: {
    owner: ['general', 'members', 'invitations', 'audit'],
    admin: ['general', 'members', 'invitations', 'audit'],
    projectAdmin: ['invitations'],
  },
};
