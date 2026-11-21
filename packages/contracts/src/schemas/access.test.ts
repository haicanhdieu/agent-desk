import { describe, expect, it } from 'vitest';
import {
  AccessDto,
  AssignmentDto,
  CreateAssignmentRequest,
  CreateInvitationRequest,
  InvitationDto,
  InvitationListQuery,
  InvitationStatus,
  INVITATION_EXPIRY_SECONDS,
  AcceptInvitationResponse,
  MemberDto,
  MyInvitationDto,
  OrgChecklistDto,
  RoleDto,
} from './access';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const ROLE = '33333333-3333-4333-8333-333333333333';
const TS = '2026-11-21T10:00:00Z';

describe('CreateAssignmentRequest', () => {
  const ok = { userId: 'u1', roleId: ROLE, scope: { type: 'org' } };
  it('accepts org and project scopes', () => {
    expect(CreateAssignmentRequest.safeParse(ok).success).toBe(true);
    expect(CreateAssignmentRequest.safeParse({ ...ok, scope: { type: 'project', projectId: P1 } }).success).toBe(true);
  });
  it.each([
    ['missing roleId', { userId: 'u1', scope: { type: 'org' } }],
    ['project without projectId', { ...ok, scope: { type: 'project' } }],
    ['unknown scope type', { ...ok, scope: { type: 'team' } }],
    ['empty userId', { ...ok, userId: '' }],
  ])('rejects %s', (_n, body) => {
    expect(CreateAssignmentRequest.safeParse(body).success).toBe(false);
  });
});

describe('CreateInvitationRequest', () => {
  const base = { email: 'a@example.com', roleId: ROLE, scope: { type: 'org' } };
  const project = (projectIds: string[]) => ({ ...base, scope: { type: 'project', projectIds } });
  const email = (len: number) => `${'a'.repeat(len - 12)}@example.com`;
  it('rejects a malformed email', () => {
    expect(CreateInvitationRequest.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false);
  });
  it('limits the email to 254 chars', () => {
    expect(CreateInvitationRequest.safeParse({ ...base, email: email(254) }).success).toBe(true);
    expect(CreateInvitationRequest.safeParse({ ...base, email: email(255) }).success).toBe(false);
  });
  it('limits projectIds to 1..100', () => {
    const ids = (n: number) =>
      Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(CreateInvitationRequest.safeParse(project([])).success).toBe(false);
    expect(CreateInvitationRequest.safeParse(project(ids(101))).success).toBe(false);
    expect(CreateInvitationRequest.safeParse(project(ids(100))).success).toBe(true);
  });
  it('lowercases the email', () => {
    expect(CreateInvitationRequest.parse({ ...base, email: 'Mixed@Example.COM' }).email).toBe('mixed@example.com');
  });
  it('deduplicates projectIds keeping order', () => {
    expect(CreateInvitationRequest.parse(project([P1, P1, P2])).scope).toEqual({
      type: 'project',
      projectIds: [P1, P2],
    });
  });
});

describe('InvitationStatus', () => {
  it('lists the five statuses', () => {
    expect(InvitationStatus.options).toEqual(['pending', 'accepted', 'declined', 'revoked', 'expired']);
  });
});

describe('DTOs', () => {
  const role = { id: ROLE, key: 'member', name: 'Member' };
  const assignment = {
    id: P1,
    userId: 'u1',
    role,
    scope: { type: 'org' },
    grantedBy: null,
    grantedAt: TS,
  };
  it('MemberDto has no email key', () => {
    expect(Object.keys(MemberDto.shape)).not.toContain('email');
    expect(MemberDto.safeParse({ userId: 'u1', handle: null, name: 'N', assignments: [assignment] }).success).toBe(
      true,
    );
  });
  it('InvitationDto needs invitedBy to be an InviterDto or null', () => {
    const base = {
      id: P1,
      email: 'a@example.com',
      role,
      scope: { type: 'org' },
      status: 'pending',
      expiresAt: TS,
      createdAt: TS,
      acceptedAt: null,
    };
    expect(InvitationDto.safeParse({ ...base, invitedBy: null }).success).toBe(true);
    expect(InvitationDto.safeParse({ ...base, invitedBy: { name: 'Ada', handle: 'ada' } }).success).toBe(true);
    expect(InvitationDto.safeParse({ ...base, invitedBy: 'u0' }).success).toBe(false);
    expect(InvitationDto.safeParse({ ...base, invitedBy: { name: 'Ada' } }).success).toBe(false);
  });
  it('parses RoleDto, AssignmentDto, InvitationDto and AccessDto', () => {
    expect(
      RoleDto.safeParse({
        ...role,
        builtIn: true,
        assignableScopes: ['org', 'project'],
        permissions: [{ permission: 'run:read', condition: 'any' }],
      }).success,
    ).toBe(true);
    expect(AssignmentDto.safeParse(assignment).success).toBe(true);
    expect(
      InvitationDto.safeParse({
        id: P1,
        email: 'a@example.com',
        role,
        scope: { type: 'project', projects: [{ id: P2, name: 'P' }] },
        status: 'pending',
        expiresAt: TS,
        invitedBy: { name: 'Ada', handle: 'ada' },
        createdAt: TS,
        acceptedAt: null,
      }).success,
    ).toBe(true);
    expect(
      AccessDto.safeParse({
        userId: 'u1',
        platformAdmin: false,
        assignments: [
          {
            roleKey: 'member',
            scope: { type: 'project', projectId: P1 },
            permissions: [{ permission: 'run:update', condition: 'own' }],
          },
        ],
      }).success,
    ).toBe(true);
  });
});

describe('onboarding schemas', () => {
  const myBase = {
    id: P1,
    org: { id: P2, name: 'Acme', slug: 'acme' },
    role: { key: 'member', name: 'Member' },
    scope: { type: 'org' },
    expiresAt: TS,
    status: 'pending',
  };
  it('expires an invitation after two days', () => {
    expect(INVITATION_EXPIRY_SECONDS).toBe(172800);
  });
  it('knows declined invitations', () => {
    expect(InvitationStatus.safeParse('declined').success).toBe(true);
  });
  it('lists pending by default and accepts the six statuses', () => {
    expect(InvitationListQuery.parse({}).status).toBe('pending');
    for (const status of ['pending', 'accepted', 'declined', 'revoked', 'expired', 'all']) {
      expect(InvitationListQuery.safeParse({ status }).success, status).toBe(true);
    }
    expect(InvitationListQuery.safeParse({ status: 'bogus' }).success).toBe(false);
  });
  it('parses my invitations with and without an inviter', () => {
    expect(MyInvitationDto.safeParse({ ...myBase, invitedBy: null }).success).toBe(true);
    expect(MyInvitationDto.safeParse({ ...myBase, invitedBy: { name: 'Ada', handle: 'ada' } }).success).toBe(true);
  });
  it('strips link and token from my invitations', () => {
    const parsed = MyInvitationDto.parse({ ...myBase, invitedBy: null, link: 'https://x', token: 't' });
    expect(parsed).not.toHaveProperty('link');
    expect(parsed).not.toHaveProperty('token');
  });
  it('accept answers with the org', () => {
    expect(AcceptInvitationResponse.safeParse({ org: myBase.org }).success).toBe(true);
  });
  it('rejects an unknown checklist step', () => {
    const ok = { complete: false, projectId: null, steps: [{ key: 'create_project', done: false }] };
    expect(OrgChecklistDto.safeParse(ok).success).toBe(true);
    expect(OrgChecklistDto.safeParse({ ...ok, steps: [{ key: 'nope', done: false }] }).success).toBe(false);
  });
});
