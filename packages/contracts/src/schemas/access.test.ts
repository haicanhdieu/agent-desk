import { describe, expect, it } from 'vitest';
import {
  AccessDto,
  AssignmentDto,
  CreateAssignmentRequest,
  CreateInvitationRequest,
  InvitationDto,
  InvitationStatus,
  MemberDto,
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
  it('lists the four statuses', () => {
    expect(InvitationStatus.options).toEqual(['pending', 'accepted', 'revoked', 'expired']);
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
        invitedBy: 'u0',
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
