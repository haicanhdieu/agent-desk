import type { PlatformAdminDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { toPlatformAdminRow } from './map';

const NOW = new Date('2026-11-23T12:00:00.000Z');

const dto = (over: Partial<PlatformAdminDto> = {}): PlatformAdminDto => ({
  id: 'c1000000-0000-4000-8000-000000000001',
  email: 'alice@example.com',
  userId: 'user-alice',
  name: 'Alice Doe',
  handle: 'alice',
  grantedAt: '2026-11-23T10:00:00.000Z',
  grantedBy: { name: 'Grace Hopper', handle: 'grace' },
  lastWorkingAdmin: false,
  ...over,
});

describe('toPlatformAdminRow', () => {
  it('BR-6: marks the entry of the signed-in user as You', () => {
    expect(toPlatformAdminRow(dto(), 'user-alice', NOW, 'UTC').you).toBe(true);
    expect(toPlatformAdminRow(dto(), 'user-other', NOW, 'UTC').you).toBe(false);
  });

  it('BR-6: an entry with no account is never You', () => {
    expect(toPlatformAdminRow(dto({ userId: null }), '', NOW, 'UTC').you).toBe(false);
  });

  it('BR-7: an entry with no account is neverSignedIn with empty name, handle and added by', () => {
    const row = toPlatformAdminRow(dto({ userId: null, name: null, handle: null, grantedBy: null }), 'x', NOW, 'UTC');
    expect(row).toMatchObject({ neverSignedIn: true, name: null, handle: null, addedBy: null });
    expect(toPlatformAdminRow(dto(), 'x', NOW, 'UTC').neverSignedIn).toBe(false);
  });

  it('BR-5: shows name, handle, email and who added the entry', () => {
    expect(toPlatformAdminRow(dto(), 'x', NOW, 'UTC')).toMatchObject({
      id: 'c1000000-0000-4000-8000-000000000001',
      email: 'alice@example.com',
      name: 'Alice Doe',
      handle: 'alice',
      addedBy: 'Grace Hopper',
    });
  });

  it('BR-16: copies lastWorkingAdmin from the DTO', () => {
    expect(toPlatformAdminRow(dto({ lastWorkingAdmin: true }), 'x', NOW, 'UTC').lastWorkingAdmin).toBe(true);
    expect(toPlatformAdminRow(dto({ lastWorkingAdmin: false }), 'x', NOW, 'UTC').lastWorkingAdmin).toBe(false);
  });

  it('BR-5: the added time reads relative, with the full date in the title', () => {
    expect(toPlatformAdminRow(dto(), 'x', NOW, 'UTC').addedAt).toEqual({
      label: '2 hours ago',
      title: '23 Nov 2026, 10:00',
    });
  });
});
