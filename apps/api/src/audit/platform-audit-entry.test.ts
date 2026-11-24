import { describe, expect, it } from 'vitest';
import { buildPlatformAuditRow, type PlatformAuditEntry } from './platform-audit-entry';

const base: PlatformAuditEntry = {
  actorUserId: 'user-1',
  action: 'platform_admin.granted',
  targetType: 'platform_admin',
  targetId: '33333333-3333-4333-8333-333333333333',
  payload: { email: 'a@dev.local', userId: 'user-2' },
};

describe('buildPlatformAuditRow', () => {
  it('keeps the actor, action and target and the payload', () => {
    expect(buildPlatformAuditRow(base)).toEqual({
      actorUserId: 'user-1',
      action: 'platform_admin.granted',
      targetType: 'platform_admin',
      targetId: base.targetId,
      payload: { email: 'a@dev.local', userId: 'user-2' },
    });
  });

  it('keeps a null userId', () => {
    expect(buildPlatformAuditRow({ ...base, payload: { email: 'a@dev.local', userId: null } }).payload).toEqual({
      email: 'a@dev.local',
      userId: null,
    });
  });

  it('passes the payload through redactBody', () => {
    const row = buildPlatformAuditRow({
      ...base,
      payload: { email: 'a@dev.local', userId: null, token: 'secret' } as PlatformAuditEntry['payload'],
    });
    expect(row.payload).toEqual({ email: 'a@dev.local', userId: null });
  });

  it('copies targetOrgId onto the row and redacts a secret-looking reason in the payload', () => {
    const orgId = '44444444-4444-4444-8444-444444444444';
    const row = buildPlatformAuditRow({
      actorUserId: 'user-1',
      action: 'org.suspended',
      targetType: 'org',
      targetId: orgId,
      targetOrgId: orgId,
      payload: { from: 'active', to: 'suspended', reason: `leaked ghp_${'a'.repeat(36)} here`, token: 'secret' },
    });
    expect(row.targetOrgId).toBe(orgId);
    expect(row.targetType).toBe('org');
    expect(JSON.stringify(row.payload)).not.toContain('ghp_');
    expect(row.payload).not.toHaveProperty('token');
    expect(row.payload).toMatchObject({ from: 'active', to: 'suspended' });
  });

  it('leaves targetOrgId unset when the entry has none', () => {
    expect(buildPlatformAuditRow(base).targetOrgId).toBeUndefined();
  });
});
