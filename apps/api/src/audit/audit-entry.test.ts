import { describe, expect, it } from 'vitest';
import { buildAuditRow, type AuditEntry } from './audit-entry';

const base: AuditEntry = {
  orgId: '33333333-3333-4333-8333-333333333333',
  actorUserId: 'user-1',
  action: 'assignment.granted',
  targetType: 'user',
  targetId: 'user-2',
  payload: { to: { roleId: 'r1', roleKey: 'admin', scope: { type: 'org' } } },
};

describe('buildAuditRow', () => {
  it('keeps the payload and maps the columns', () => {
    expect(buildAuditRow(base)).toEqual({
      orgId: base.orgId,
      actorUserId: 'user-1',
      action: 'assignment.granted',
      targetType: 'user',
      targetId: 'user-2',
      payload: { to: { roleId: 'r1', roleKey: 'admin', scope: { type: 'org' } } },
    });
  });

  it('adds actorKind to the payload', () => {
    const row = buildAuditRow({ ...base, actorKind: 'platform_admin' });
    expect(row.payload).toEqual({ ...base.payload, actorKind: 'platform_admin' });
  });

  it('drops token and password keys at any depth', () => {
    const row = buildAuditRow({
      ...base,
      payload: { token: 'x', to: { password: 'p', nested: [{ token: 't', keep: 1 }], roleKey: 'a' } },
    });
    expect(row.payload).toEqual({ to: { nested: [{ keep: 1 }], roleKey: 'a' } });
  });

  it('omits actorKind when undefined', () => {
    expect(buildAuditRow(base).payload).not.toHaveProperty('actorKind');
  });
});

describe('buildAuditRow for the invitee actions', () => {
  it.each(['invitation.declined', 'invitation.resent'] as const)('accepts %s', (action) => {
    const row = buildAuditRow({ ...base, action, targetType: 'invitation', payload: { email: 'a@b.c' } });
    expect(row.action).toBe(action);
  });
});
