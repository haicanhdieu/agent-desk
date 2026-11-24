import type {
  InvitationDto,
  AssignmentDto,
  PlatformAuditEntryDto,
  PlatformMemberDto,
  PlatformOrgDto,
  PlatformProjectDto,
} from '@agentdesk/contracts';
import { roleFixtures } from './access';

// Fixtures of the platform organizations directory: the cases its screens and e2e specs need.
const uuid = (n: number) => `b8000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const owner = (n: number, name: string, handle: string | null) => ({
  userId: `user-owner-${String(n)}`,
  name,
  handle,
  email: `${handle ?? `owner${String(n)}`}@example.com`,
});

const base = { suspendedAt: null, lastActivityAt: '2026-11-20T09:00:00.000Z' } as const;

export const platformOrgDtoFixtures: PlatformOrgDto[] = [
  {
    ...base,
    // Three hours before the mock clock (SESSION_MOCK_NOW), so the directory reads "3 hours ago".
    lastActivityAt: '2026-11-19T11:20:00.000Z',
    id: uuid(1),
    name: 'Acme',
    slug: 'acme',
    memberCount: 4,
    createdAt: '2026-09-01T10:00:00.000Z',
    status: 'active',
    projectCount: 3,
    owner: owner(1, 'Alice Acme', 'alice'),
  },
  {
    // Two owners in the real data: the directory shows the earliest.
    ...base,
    id: uuid(2),
    name: 'Beta',
    slug: 'beta-labs',
    memberCount: 6,
    createdAt: '2026-09-15T10:00:00.000Z',
    status: 'active',
    projectCount: 2,
    owner: owner(2, 'Bea Tester', 'bea'),
  },
  {
    id: uuid(3),
    name: 'Orbit Systems',
    slug: 'orbit-systems',
    memberCount: 2,
    createdAt: '2026-08-10T10:00:00.000Z',
    status: 'suspended',
    suspendedAt: '2026-11-10T12:00:00.000Z',
    projectCount: 1,
    lastActivityAt: '2026-11-09T16:30:00.000Z',
    owner: owner(3, 'Omar Orbit', 'omar'),
  },
  {
    ...base,
    id: uuid(4),
    name: 'Ownerless Co',
    slug: 'ownerless',
    memberCount: 0,
    createdAt: '2026-10-20T10:00:00.000Z',
    status: 'active',
    projectCount: 0,
    owner: null,
  },
  {
    id: uuid(5),
    name: 'Quiet Works',
    slug: 'quiet-works',
    memberCount: 1,
    createdAt: '2026-10-25T10:00:00.000Z',
    status: 'active',
    suspendedAt: null,
    projectCount: 0,
    lastActivityAt: null,
    owner: owner(5, 'Quinn Quiet', null),
  },
  {
    ...base,
    id: uuid(6),
    name: 'The International Association of Extraordinarily Long Named Organizations and Partners',
    slug: 'international-association-long-named',
    memberCount: 12,
    createdAt: '2026-07-04T10:00:00.000Z',
    status: 'active',
    projectCount: 7,
    owner: owner(6, 'Lena Long', 'lena'),
  },
];

// The platform audit log: every action once, newest first in the real list (the handler sorts). One entry has a gone
// actor, one a gone organization; suspend and reactivate carry reasons; one edit changes a name and a slug.
const auditId = (n: number) => `ba000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const adminActor = { userId: 'user-dev-admin', name: 'Dev Admin', handle: 'dev-admin' } as const;
const acme = { id: uuid(1), name: 'Acme' } as const;
const orbit = { id: uuid(3), name: 'Orbit Systems' } as const;
const entry = (
  n: number,
  at: string,
  action: PlatformAuditEntryDto['action'],
  rest: Partial<PlatformAuditEntryDto> & Pick<PlatformAuditEntryDto, 'target'>,
): PlatformAuditEntryDto => ({
  id: auditId(n),
  at,
  actor: adminActor,
  action,
  org: acme,
  reason: null,
  changes: [],
  ...rest,
});

export const platformAuditFixtures: PlatformAuditEntryDto[] = [
  entry(1, '2026-11-19T10:00:00.000Z', 'platform_admin.granted', {
    org: null,
    target: { type: 'platform_admin', id: 'pat@example.com', label: 'pat@example.com' },
  }),
  entry(2, '2026-11-19T10:05:00.000Z', 'platform_admin.revoked', {
    org: null,
    target: { type: 'platform_admin', id: 'old@example.com', label: 'old@example.com' },
  }),
  entry(3, '2026-11-19T10:10:00.000Z', 'org.created', {
    target: { type: 'org', id: acme.id, label: 'Acme' },
  }),
  entry(4, '2026-11-19T10:15:00.000Z', 'org.updated', {
    target: { type: 'org', id: acme.id, label: 'Acme' },
    changes: [
      { field: 'name', from: 'Acme Labs', to: 'Acme' },
      { field: 'slug', from: 'acme-labs', to: 'acme' },
    ],
  }),
  entry(5, '2026-11-19T10:20:00.000Z', 'org.suspended', {
    org: orbit,
    target: { type: 'org', id: orbit.id, label: 'Orbit Systems' },
    reason: 'Billing hold',
    changes: [{ field: 'status', from: 'active', to: 'suspended' }],
  }),
  entry(6, '2026-11-19T10:25:00.000Z', 'org.reactivated', {
    org: orbit,
    target: { type: 'org', id: orbit.id, label: 'Orbit Systems' },
    reason: 'Invoice paid',
    changes: [{ field: 'status', from: 'suspended', to: 'active' }],
  }),
  entry(7, '2026-11-19T10:30:00.000Z', 'assignment.granted', {
    target: { type: 'assignment', id: auditId(107), label: 'alice' },
    changes: [{ field: 'role', from: null, to: 'owner' }],
  }),
  entry(8, '2026-11-19T10:35:00.000Z', 'assignment.revoked', {
    actor: null,
    target: { type: 'assignment', id: auditId(108), label: 'alice' },
    changes: [{ field: 'role', from: 'owner', to: null }],
  }),
  entry(9, '2026-11-19T10:40:00.000Z', 'invitation.created', {
    target: { type: 'invitation', id: auditId(109), label: 'new@example.com' },
    changes: [{ field: 'role', from: null, to: 'admin' }],
  }),
  entry(10, '2026-11-19T10:45:00.000Z', 'invitation.resent', {
    target: { type: 'invitation', id: auditId(109), label: 'new@example.com' },
  }),
  entry(11, '2026-11-19T10:50:00.000Z', 'invitation.revoked', {
    // The organization was removed since: no org to link to.
    org: null,
    target: { type: 'invitation', id: auditId(109), label: 'new@example.com' },
  }),
];

// The org detail tabs. Every directory org serves these until a scenario seeds others (a new org starts with none).
// Projects: 25 (more than a page), "Alpha" first. Members: one with Owner (organization) and Member (Alpha), one with an
// org role only, one with no assignment, one with no name (the contract's `name` is a string, so the empty one).
const detailId = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const roleRef = (key: string) => {
  const role = roleFixtures.find((r) => r.key === key);
  if (!role) throw new Error(`no ${key} role fixture`);
  return { id: role.id, key: role.key, name: role.name };
};

export const platformProjectFixtures: PlatformProjectDto[] = Array.from({ length: 25 }, (_, i) => ({
  id: detailId('b8100000', i + 1),
  name: i === 0 ? 'Alpha' : `Project ${String(i + 1).padStart(2, '0')}`,
}));

const alphaId = platformProjectFixtures[0]?.id ?? '';
const grant = (n: number, userId: string, roleKey: string, projectId: string | null, at: string): AssignmentDto => ({
  id: detailId('b8200000', n),
  userId,
  role: roleRef(roleKey),
  scope: projectId === null ? { type: 'org' } : { type: 'project', projectId },
  grantedBy: null,
  grantedAt: at,
});

export const platformMemberFixtures: PlatformMemberDto[] = [
  {
    userId: 'user-detail-alice',
    handle: 'alice',
    name: 'Alice Acme',
    email: 'alice@example.com',
    assignments: [
      grant(1, 'user-detail-alice', 'owner', null, '2026-09-01T09:00:00.000Z'),
      grant(2, 'user-detail-alice', 'member', alphaId, '2026-09-02T09:00:00.000Z'),
    ],
  },
  {
    userId: 'user-detail-bob',
    handle: 'bob',
    name: 'Bob Builder',
    email: 'bob@example.com',
    assignments: [grant(3, 'user-detail-bob', 'admin', null, '2026-10-05T10:30:00.000Z')],
  },
  { userId: 'user-detail-cara', handle: 'cara', name: 'Cara Idle', email: 'cara@example.com', assignments: [] },
  {
    userId: 'user-detail-noname',
    handle: 'noname',
    name: '',
    email: 'noname@example.com',
    assignments: [grant(4, 'user-detail-noname', 'viewer', null, '2026-10-06T10:30:00.000Z')],
  },
];

// Acme's invitations on the platform Invitations tab, as seen at the mock clock (SESSION_MOCK_NOW): one pending that
// expires in five hours and one revoked.
const inviter = { name: 'Alice Acme', handle: 'alice' };
export const platformInvitationFixtures: InvitationDto[] = [
  {
    id: detailId('b8300000', 1),
    email: 'pending@example.test',
    role: roleRef('member'),
    scope: { type: 'org' },
    status: 'pending',
    expiresAt: '2026-11-19T19:20:00.000Z',
    invitedBy: inviter,
    createdAt: '2026-11-19T10:00:00.000Z',
    acceptedAt: null,
  },
  {
    id: detailId('b8300000', 2),
    email: 'revoked@example.test',
    role: roleRef('viewer'),
    scope: { type: 'org' },
    status: 'revoked',
    expiresAt: '2026-11-21T10:00:00.000Z',
    invitedBy: inviter,
    createdAt: '2026-11-19T09:00:00.000Z',
    acceptedAt: null,
  },
];
