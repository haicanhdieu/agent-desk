import {
  PERMISSION_LEVEL,
  Permission,
  isPlatformPermission,
  type AccessDto,
  type AssignmentDto,
  type InvitationDto,
  type MemberDto,
  type PermissionLineDto,
  type PlatformAdminDto,
  type PlatformMemberDto,
  type PlatformProjectDto,
  type RoleDto,
} from '@agentdesk/contracts';
import { ids, MOCK_NOW } from './ids';

// Access fixtures: the four built-in roles of the permission matrix, a few assignments and invitations for the
// signed-in org, and the platform views of the two mock orgs.
const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;

const roleId = {
  owner: uuid('b1000000', 1),
  admin: uuid('b1000000', 2),
  member: uuid('b1000000', 3),
  viewer: uuid('b1000000', 4),
};

const TENANT_PERMISSIONS = Permission.options.filter((p) => !isPlatformPermission(p));

const any = (permission: PermissionLineDto['permission']): PermissionLineDto => ({ permission, condition: 'any' });
const own = (permission: PermissionLineDto['permission']): PermissionLineDto => ({ permission, condition: 'own' });
// The seeded member and viewer reads: no Desk configuration (issue 216).
const readOnly = ['project:read', 'run:read'] as const;

export const roleFixtures: RoleDto[] = [
  {
    id: roleId.owner,
    key: 'owner',
    name: 'Owner',
    builtIn: true,
    assignableScopes: ['org'],
    permissions: TENANT_PERMISSIONS.map(any),
  },
  {
    id: roleId.admin,
    key: 'admin',
    name: 'Admin',
    builtIn: true,
    assignableScopes: ['org', 'project'],
    permissions: TENANT_PERMISSIONS.filter((p) => p !== 'org:delete').map(any),
  },
  {
    id: roleId.member,
    key: 'member',
    name: 'Member',
    builtIn: true,
    assignableScopes: ['org', 'project'],
    permissions: [
      ...[...readOnly, 'run:create' as const].map(any),
      own('run:update'),
      own('run:cancel'),
      own('terminal:attach'),
    ],
  },
  {
    id: roleId.viewer,
    key: 'viewer',
    name: 'Viewer',
    builtIn: true,
    assignableScopes: ['org', 'project'],
    permissions: readOnly.map(any),
  },
];

const ref = (key: keyof typeof roleId, name: string) => ({ id: roleId[key], key, name });

const ownerAssignment: AssignmentDto = {
  id: uuid('b2000000', 1),
  userId: ids.user.alice,
  role: ref('owner', 'Owner'),
  scope: { type: 'org' },
  grantedBy: null,
  grantedAt: '2026-09-01T09:00:00.000Z',
};

const bobAssignment: AssignmentDto = {
  id: uuid('b2000000', 2),
  userId: 'user-bob',
  role: ref('member', 'Member'),
  scope: { type: 'project', projectId: ids.project.invoicerApi },
  grantedBy: ids.user.alice,
  grantedAt: '2026-10-05T10:30:00.000Z',
};

export const assignmentFixtures: AssignmentDto[] = [ownerAssignment, bobAssignment];

export const invitationFixtures: InvitationDto[] = [
  {
    id: uuid('b3000000', 1),
    email: 'carol@example.com',
    role: ref('viewer', 'Viewer'),
    scope: { type: 'project', projects: [{ id: ids.project.invoicerApi, name: 'invoicer-api' }] },
    status: 'pending',
    expiresAt: '2026-11-19T09:00:00.000Z',
    invitedBy: { name: 'Alice', handle: 'alice' },
    createdAt: '2026-11-12T09:00:00.000Z',
    acceptedAt: null,
  },
  {
    id: uuid('b3000000', 2),
    email: 'dave@example.com',
    role: ref('admin', 'Admin'),
    scope: { type: 'org' },
    status: 'accepted',
    expiresAt: '2026-10-20T09:00:00.000Z',
    invitedBy: { name: 'Alice', handle: 'alice' },
    createdAt: '2026-10-13T09:00:00.000Z',
    acceptedAt: '2026-10-14T08:00:00.000Z',
  },
];

export const memberFixtures: MemberDto[] = [
  { userId: ids.user.alice, handle: 'alice', name: 'Alice', assignments: [ownerAssignment] },
  { userId: 'user-bob', handle: 'bob', name: 'Bob', assignments: [bobAssignment] },
];

/** What `GET /api/me/access` answers for the signed-in owner. */
export const accessFixture: AccessDto = {
  userId: ids.user.alice,
  platformAdmin: false,
  assignments: [{ roleKey: 'owner', scope: { type: 'org' }, permissions: TENANT_PERMISSIONS.map(any) }],
};

export const platformProjectFixtures: PlatformProjectDto[] = [
  { id: ids.project.invoicerApi, name: 'invoicer-api' },
  { id: ids.project.invoicerWeb, name: 'invoicer-web' },
];

export const platformMemberFixtures: PlatformMemberDto[] = memberFixtures.map((m) => ({
  ...m,
  email: `${m.handle ?? 'user'}@example.com`,
}));

const platformAdminId = (n: number) => uuid('b5000000', n);

/** The platform admin list: the hand-seeded first admin, one granted by them, and a seeded email with no account yet. */
export const platformAdminFixtures: PlatformAdminDto[] = [
  {
    id: platformAdminId(1),
    email: 'admin@dev.local',
    userId: 'user-dev-admin',
    name: 'Dev Admin',
    handle: 'dev-admin',
    grantedAt: MOCK_NOW,
    grantedBy: null,
    lastWorkingAdmin: false,
  },
  {
    id: platformAdminId(2),
    email: 'pat@example.com',
    userId: 'user-pat',
    name: 'Pat',
    handle: 'pat',
    grantedAt: MOCK_NOW,
    grantedBy: { name: 'Dev Admin', handle: 'dev-admin' },
    lastWorkingAdmin: false,
  },
  {
    id: platformAdminId(3),
    email: 'seeded@example.com',
    userId: null,
    name: null,
    handle: null,
    grantedAt: MOCK_NOW,
    grantedBy: null,
    lastWorkingAdmin: false,
  },
];

// Tenant-admin fixtures (Settings → Members): the Harbor Labs cast for the owner, admin and project-admin views.
const tenantUser = (n: number) => `user-tenant-${n}`;
const tenantAssignment = (
  n: number,
  userId: string,
  key: keyof typeof roleId,
  scope: AssignmentDto['scope'],
): AssignmentDto => ({
  id: uuid('b2100000', n),
  userId,
  role: ref(key, key[0].toUpperCase() + key.slice(1)),
  scope,
  grantedBy: ids.user.alice,
  grantedAt: '2026-10-05T10:30:00.000Z',
});
const orgScope = { type: 'org' } as const;
const tenantMember = (
  n: number,
  name: string,
  handle: string | null,
  roleKey: keyof typeof roleId | null,
  projectRoles: { key: keyof typeof roleId; projectId: string }[] = [],
): MemberDto => {
  const userId = tenantUser(n);
  return {
    userId,
    handle,
    name,
    assignments: [
      ...(roleKey ? [tenantAssignment(n, userId, roleKey, orgScope)] : []),
      ...projectRoles.map((p, i) =>
        tenantAssignment(n * 10 + i + 100, userId, p.key, { type: 'project', projectId: p.projectId }),
      ),
    ],
  };
};

const alice = { ...memberFixtures[0], name: 'Alice Doe' };
const owner2 = tenantMember(2, 'Priya Raman', 'priya', 'owner');
const admin = tenantMember(3, 'Ben Okafor', 'ben', 'admin');
const memberWithProjects = tenantMember(4, 'Cleo Martin', 'cleo', 'member', [
  { key: 'admin', projectId: ids.project.invoicerApi },
  { key: 'member', projectId: ids.project.invoicerWeb },
]);

export const tenantMemberFixtures: Record<'soleOwner' | 'twoOwners' | 'paged25', MemberDto[]> = {
  soleOwner: [alice, admin, memberWithProjects, tenantMember(5, 'Dana Wu', 'dana', 'viewer')],
  twoOwners: [
    alice,
    owner2,
    admin,
    memberWithProjects,
    tenantMember(6, 'Eli Ford', 'eli', null, [{ key: 'viewer', projectId: ids.project.docsSite }]),
  ],
  paged25: [
    alice,
    ...Array.from({ length: 24 }, (_, i) =>
      tenantMember(i + 10, `Member ${String(i + 1).padStart(2, '0')}`, `member${i + 1}`, 'member'),
    ),
  ],
};

const adminPermissions = roleFixtures[1].permissions;
const projectAdminPermissions = adminPermissions.filter((l) => PERMISSION_LEVEL[l.permission] === 'project');
const memberPermissions = roleFixtures[2].permissions;
const viewerPermissions = roleFixtures[3].permissions;
const orgAccess = (roleKey: string, permissions: PermissionLineDto[]): AccessDto => ({
  userId: ids.user.alice,
  platformAdmin: false,
  assignments: [{ roleKey, scope: orgScope, permissions }],
});

/** What `GET /api/orgs/:orgId/access` answers per caller. */
export const tenantAccessFixtures: Record<
  'owner' | 'admin' | 'projectAdmin' | 'member' | 'viewer' | 'noRole',
  AccessDto
> = {
  owner: orgAccess('owner', roleFixtures[0].permissions),
  admin: orgAccess('admin', adminPermissions),
  projectAdmin: {
    userId: ids.user.alice,
    platformAdmin: false,
    assignments: [
      {
        roleKey: 'admin',
        scope: { type: 'project', projectId: ids.project.invoicerApi },
        permissions: projectAdminPermissions,
      },
    ],
  },
  member: orgAccess('member', memberPermissions),
  viewer: orgAccess('viewer', viewerPermissions),
  noRole: { userId: ids.user.alice, platformAdmin: false, assignments: [] },
};
