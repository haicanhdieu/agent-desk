import type { MemberRowView, OrgRoleKey, RoleCardOption } from './types';

// Members table views for the stories: what each caller sees (rights from BR-4 and BR-9).
let seq = 0;
const row = (over: Partial<MemberRowView> & Pick<MemberRowView, 'name' | 'handle'>): MemberRowView => ({
  userId: `user-view-${++seq}`,
  you: false,
  role: { key: 'member', name: 'Member' },
  projectRoles: '—',
  canChangeRole: true,
  canRemove: true,
  ...over,
});
const role = (key: OrgRoleKey) => ({ key, name: key[0].toUpperCase() + key.slice(1) });

const ownerView = (): MemberRowView[] => [
  row({ name: 'Alice Doe', handle: 'alice', you: true, role: role('owner'), canRemove: false }),
  row({ name: 'Priya Raman', handle: 'priya', role: role('owner') }),
  row({ name: 'Ben Okafor', handle: 'ben', role: role('admin') }),
  row({
    name: 'Cleo Martin',
    handle: 'cleo',
    role: role('member'),
    projectRoles: 'invoicer-api (Admin), invoicer-web (Member)',
  }),
  row({ name: 'Dana Wu', handle: 'dana', role: role('viewer') }),
  row({ name: 'Eli Ford', handle: 'eli', role: null, projectRoles: 'docs-site (Viewer)' }),
  row({
    name: 'Maximilian Alexander Featherstonehaugh-Montgomery',
    handle: 'maximilian-featherstonehaugh-montgomery',
    role: role('member'),
  }),
];

// The admin caller (Ben) cannot act on owners (BR-4); their own row keeps Change role only.
const adminView = (): MemberRowView[] =>
  ownerView().map((m) =>
    m.role?.key === 'owner'
      ? { ...m, you: false, canChangeRole: false, canRemove: false }
      : m.name === 'Ben Okafor'
        ? { ...m, you: true, canRemove: false }
        : m,
  );

export const memberRows: Record<'owner' | 'admin' | 'paged', MemberRowView[]> = {
  owner: ownerView(),
  admin: adminView(),
  paged: [
    row({ name: 'Alice Doe', handle: 'alice', you: true, role: role('owner'), canRemove: false }),
    ...Array.from({ length: 24 }, (_, i) =>
      row({ name: `Member ${String(i + 1).padStart(2, '0')}`, handle: `member${i + 1}` }),
    ),
  ],
};

const uuid = (n: number) => `b1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cards: RoleCardOption[] = [
  {
    roleId: uuid(1),
    key: 'owner',
    name: 'Owner',
    description: 'Everything an admin can do, and manage owners.',
  },
  {
    roleId: uuid(2),
    key: 'admin',
    name: 'Admin',
    description: 'Manage members, invitations, projects and settings.',
  },
  { roleId: uuid(3), key: 'member', name: 'Member', description: 'Use projects and start runs.' },
  { roleId: uuid(4), key: 'viewer', name: 'Viewer', description: 'See projects and runs.' },
  {
    roleId: null,
    key: 'none',
    name: 'No role',
    description: 'Stays a member with no organization role. Project roles stay.',
  },
];

export const roleCards: Record<'ownerCaller' | 'adminCaller', RoleCardOption[]> = {
  ownerCaller: cards,
  adminCaller: cards.filter((c) => c.key !== 'owner'),
};
