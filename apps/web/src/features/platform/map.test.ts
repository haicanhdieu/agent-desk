import type { PlatformAdminDto, PlatformOrgDetailDto, PlatformOrgDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { toPlatformAdminRow, toPlatformOrgOverview, toPlatformOrgRow } from './map';

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

const org = (over: Partial<PlatformOrgDto> = {}): PlatformOrgDto => ({
  id: 'b8000000-0000-4000-8000-000000000001',
  name: 'Acme',
  slug: 'acme',
  memberCount: 4,
  createdAt: '2026-11-21T10:00:00.000Z',
  status: 'active',
  suspendedAt: null,
  projectCount: 3,
  lastActivityAt: '2026-11-23T10:00:00.000Z',
  owner: { userId: 'u1', name: 'Alice Acme', handle: 'alice', email: 'alice@example.com' },
  ...over,
});

describe('toPlatformOrgRow', () => {
  it('BR-18: links to the platform detail and copies name, slug, counts and status', () => {
    expect(toPlatformOrgRow(org({ status: 'suspended' }), NOW, 'UTC')).toMatchObject({
      id: 'b8000000-0000-4000-8000-000000000001',
      href: '/platform/orgs/b8000000-0000-4000-8000-000000000001',
      name: 'Acme',
      slug: 'acme',
      members: 4,
      projects: 3,
      status: 'suspended',
    });
  });

  it('BR-19: shows the owner name, or null when there is no owner yet', () => {
    expect(toPlatformOrgRow(org(), NOW, 'UTC').owner).toBe('Alice Acme');
    expect(toPlatformOrgRow(org({ owner: null }), NOW, 'UTC').owner).toBeNull();
  });

  it('BR-19: last activity is null with no run, else relative with the full date as title', () => {
    expect(toPlatformOrgRow(org({ lastActivityAt: null }), NOW, 'UTC').lastActivity).toBeNull();
    expect(toPlatformOrgRow(org(), NOW, 'UTC').lastActivity).toEqual({
      label: '2 hours ago',
      title: '23 Nov 2026, 10:00',
    });
  });

  it('BR-18: created reads as a short date, with the full date in the title', () => {
    expect(toPlatformOrgRow(org(), NOW, 'UTC').created).toEqual({ label: '21 Nov', title: '21 Nov 2026, 10:00' });
  });
});

describe('toPlatformOrgOverview', () => {
  const detail = (over: Partial<PlatformOrgDetailDto> = {}): PlatformOrgDetailDto => ({
    id: 'b8000000-0000-4000-8000-000000000001',
    name: 'Acme',
    slug: 'acme',
    memberCount: 12,
    projectCount: 4,
    createdAt: '2026-03-03T10:00:00.000Z',
    lastActivityAt: '2026-11-23T10:00:00.000Z',
    status: 'active',
    suspendedAt: null,
    owner: { userId: 'u1', name: 'Dana Whitfield', handle: 'dana', email: 'dana@example.com' },
    suspension: null,
    ...over,
  });

  it('BR-24: takes the facts from the DTO and has no suspension for an active org', () => {
    const view = toPlatformOrgOverview(detail(), NOW);
    expect(view.facts).toEqual({
      slug: 'acme',
      owner: 'Dana Whitfield',
      members: 12,
      projects: 4,
      lastActivity: '2 hours ago',
      created: '3 Mar 2026',
      status: 'active',
    });
    expect(view.suspension).toBeNull();
  });

  it('BR-19: no owner and no activity stay null', () => {
    const view = toPlatformOrgOverview(detail({ owner: null, lastActivityAt: null }), NOW);
    expect(view.facts.owner).toBeNull();
    expect(view.facts.lastActivity).toBeNull();
  });

  it('BR-32: the suspension shows its date in UTC, who and the reason', () => {
    const view = toPlatformOrgOverview(
      detail({
        status: 'suspended',
        suspendedAt: '2026-11-21T23:30:00.000Z',
        suspension: {
          at: '2026-11-21T23:30:00.000Z',
          reason: 'Billing hold',
          by: { userId: 'u2', name: 'Sam Rivera', handle: 'sam' },
        },
      }),
      NOW,
    );
    expect(view.suspension).toEqual({ since: '21 Nov 2026', by: 'Sam Rivera', reason: 'Billing hold' });
  });

  it('BR-32: an actor that is gone shows no name', () => {
    const view = toPlatformOrgOverview(
      detail({ status: 'suspended', suspension: { at: '2026-11-21T10:00:00.000Z', reason: 'x', by: null } }),
      NOW,
    );
    expect(view.suspension?.by).toBeNull();
  });
});
