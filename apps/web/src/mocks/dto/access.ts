import {
  Permission,
  isPlatformPermission,
  type AccessDto,
  type AssignmentDto,
  type InvitationDto,
  type MemberDto,
  type PermissionLineDto,
  type PlatformMemberDto,
  type PlatformOrgDto,
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
const readOnly = ['project:read', 'agent:read', 'skill:read', 'rule:read', 'setup:read', 'run:read'] as const;

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

export const platformOrgFixtures: PlatformOrgDto[] = [
  { id: uuid('b4000000', 1), name: 'Harbor Labs', slug: 'harbor-labs', memberCount: 2, createdAt: MOCK_NOW },
  { id: uuid('b4000000', 2), name: 'Acme', slug: 'acme', memberCount: 1, createdAt: MOCK_NOW },
];

export const platformProjectFixtures: PlatformProjectDto[] = [
  { id: ids.project.invoicerApi, name: 'invoicer-api' },
  { id: ids.project.invoicerWeb, name: 'invoicer-web' },
];

export const platformMemberFixtures: PlatformMemberDto[] = memberFixtures.map((m) => ({
  ...m,
  email: `${m.handle ?? 'user'}@example.com`,
}));
