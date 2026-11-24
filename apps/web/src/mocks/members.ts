import type {
  InviteOption,
  MemberGrantView,
  MemberRowView,
  OrgRoleKey,
  ProjectGrantView,
  RoleCardOption,
} from './types';

// Members table views for the stories: what each caller sees (rights from BR-4 and BR-9).
let seq = 0;
const row = (over: Partial<MemberRowView> & Pick<MemberRowView, 'name' | 'handle'>): MemberRowView => ({
  userId: `user-view-${++seq}`,
  you: false,
  role: { key: 'member', name: 'Member' },
  grants: [],
  canChangeRole: true,
  canRemove: true,
  ...over,
});
const role = (key: OrgRoleKey) => ({ key, name: key[0].toUpperCase() + key.slice(1) });
let grantSeq = 0;
const orgGrant = (key: OrgRoleKey): MemberGrantView => ({
  id: `grant-view-${++grantSeq}`,
  scopeName: 'Organization',
  roleName: role(key).name,
});
const projectGrant = (scopeName: string, roleName: string): MemberGrantView => ({
  id: `grant-view-${++grantSeq}`,
  scopeName,
  roleName,
});
const PROJECT_NAMES = [
  'billing-jobs',
  'docs-site',
  'invoicer-api',
  'invoicer-web',
  'storefront',
  'status-page',
  'mobile-app',
  'data-pipeline',
];

const ownerView = (): MemberRowView[] => [
  row({
    name: 'Alice Doe',
    handle: 'alice',
    you: true,
    role: role('owner'),
    grants: [orgGrant('owner')],
    canChangeRole: false,
    canRemove: false,
  }),
  row({ name: 'Priya Raman', handle: 'priya', role: role('owner'), grants: [orgGrant('owner')] }),
  row({ name: 'Ben Okafor', handle: 'ben', role: role('admin'), grants: [orgGrant('admin')] }),
  row({
    name: 'Cleo Martin',
    handle: 'cleo',
    role: role('member'),
    grants: [orgGrant('member'), projectGrant('invoicer-api', 'Admin'), projectGrant('invoicer-web', 'Member')],
  }),
  row({ name: 'Dana Wu', handle: 'dana', role: role('viewer'), grants: [orgGrant('viewer')] }),
  row({ name: 'Eli Ford', handle: 'eli', role: null, grants: [projectGrant('docs-site', 'Viewer')] }),
  row({
    name: 'Maximilian Alexander Featherstonehaugh-Montgomery',
    handle: 'maximilian-featherstonehaugh-montgomery',
    role: role('member'),
    grants: [orgGrant('member')],
  }),
];

// The admin caller (Ben) cannot act on owners (BR-4); nobody has actions on their own row.
const adminView = (): MemberRowView[] =>
  ownerView().map((m) =>
    m.role?.key === 'owner'
      ? { ...m, you: false, canChangeRole: false, canRemove: false }
      : m.name === 'Ben Okafor'
        ? { ...m, you: true, canChangeRole: false, canRemove: false }
        : m,
  );

// Many grants: the chips wrap onto more lines, none is cut off.
const fatima = (): MemberRowView =>
  row({
    name: 'Fatima Zahra',
    handle: 'fatima',
    role: role('member'),
    grants: [orgGrant('member'), ...PROJECT_NAMES.map((n, i) => projectGrant(n, i % 2 === 0 ? 'Member' : 'Viewer'))],
  });

export const memberRows: Record<'owner' | 'admin' | 'paged' | 'manyGrants', MemberRowView[]> = {
  owner: ownerView(),
  manyGrants: [...ownerView(), fatima()],
  admin: adminView(),
  paged: [
    row({
      name: 'Alice Doe',
      handle: 'alice',
      you: true,
      role: role('owner'),
      grants: [orgGrant('owner')],
      canChangeRole: false,
      canRemove: false,
    }),
    ...Array.from({ length: 24 }, (_, i) =>
      row({ name: `Member ${String(i + 1).padStart(2, '0')}`, handle: `member${i + 1}`, grants: [orgGrant('member')] }),
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

/** The project roles Change access offers (never Owner). */
export const accessProjectRoleIds = { admin: uuid(2), member: uuid(3), viewer: uuid(4) } as const;
/** The projects the caller can add a grant on. */
export const accessProjects: InviteOption[] = PROJECT_NAMES.map((label, i) => ({
  id: `c1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  label,
}));
/** The member's current project grants in the dialog. */
export const accessProjectGrants: ProjectGrantView[] = [
  {
    assignmentId: 'd1000000-0000-4000-8000-000000000001',
    projectId: accessProjects[2]?.id ?? '',
    projectName: 'invoicer-api',
    roleId: uuid(2),
    roleName: 'Admin',
  },
  {
    assignmentId: 'd1000000-0000-4000-8000-000000000002',
    projectId: accessProjects[3]?.id ?? '',
    projectName: 'invoicer-web',
    roleId: uuid(3),
    roleName: 'Member',
  },
];
