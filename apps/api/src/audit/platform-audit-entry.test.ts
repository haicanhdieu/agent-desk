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
});
