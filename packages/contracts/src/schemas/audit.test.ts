import { describe, expect, it } from 'vitest';
import { AuditAction, AuditChange, AuditEntryDto } from './audit';

const ID = '33333333-3333-4333-8333-333333333333';
const base = {
  id: ID,
  at: '2026-11-22T10:00:00Z',
  actor: null,
  actorKind: null,
  action: 'org.created',
  target: { type: null, id: null, label: null },
  changes: [],
  projects: [],
};

describe('AuditEntryDto', () => {
  it('parses an entry with no actor and no actor kind', () => {
    expect(AuditEntryDto.safeParse(base).success).toBe(true);
  });
  it('parses an entry with an actor and a change', () => {
    const r = AuditEntryDto.safeParse({
      ...base,
      actor: { userId: 'u1', name: 'Ada', handle: 'ada' },
      actorKind: 'member',
      action: 'member.role_changed',
      target: { type: 'user', id: 'u2', label: 'Bob' },
      changes: [{ field: 'role', from: 'member', to: null }],
    });
    expect(r.success).toBe(true);
  });
  it('drops a raw payload from the parsed entry', () => {
    const r = AuditEntryDto.parse({ ...base, payload: { secret: 'x' } });
    expect('payload' in r).toBe(false);
  });
});

describe('AuditEntryDto projects', () => {
  it('requires projects as an array of id and name', () => {
    const { projects: _omit, ...without } = base;
    expect(AuditEntryDto.safeParse(without).success).toBe(false);
    expect(AuditEntryDto.safeParse({ ...base, projects: [{ id: ID }] }).success).toBe(false);
    expect(AuditEntryDto.safeParse({ ...base, projects: [{ id: ID, name: 'P' }] }).success).toBe(true);
  });
});

describe('AuditChange', () => {
  it('accepts the status field', () => {
    expect(AuditChange.safeParse({ field: 'status', from: 'active', to: 'suspended' }).success).toBe(true);
  });
  it('rejects a field outside role, name and slug', () => {
    expect(AuditChange.safeParse({ field: 'email', from: 'a', to: 'b' }).success).toBe(false);
  });
});

describe('AuditAction', () => {
  it('lists the member and org action names', () => {
    expect(AuditAction.options).toEqual(
      expect.arrayContaining([
        'member.role_changed',
        'member.removed',
        'org.updated',
        'org.suspended',
        'org.reactivated',
      ]),
    );
  });
});

describe('project member audit actions', () => {
  it('lists the two new actions', () => {
    expect(AuditAction.options).toContain('project_member.role_changed');
    expect(AuditAction.options).toContain('project_member.removed');
  });
});
