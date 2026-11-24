import {
  PlatformAuditAction,
  type PlatformAdminDto,
  type PlatformAuditEntryDto,
  type PlatformMemberDto,
  type PlatformOrgDetailDto,
  type PlatformOrgDto,
} from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import {
  PLATFORM_AUDIT_ACTION_LABELS,
  toPlatformAdminRow,
  toPlatformAuditRow,
  toPlatformMemberRow,
  toPlatformOrgOverview,
  toPlatformOrgRow,
} from './map';

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

const ORG = { id: 'c3000000-0000-4000-8000-000000000001', name: 'Acme' };
const audit = (over: Partial<PlatformAuditEntryDto> = {}): PlatformAuditEntryDto => ({
  id: 'ba000000-0000-4000-8000-000000000001',
  at: '2026-11-23T11:00:00.000Z',
  actor: { userId: 'u1', name: 'Dev Admin', handle: 'dev-admin' },
  action: 'org.created',
  target: { type: 'org', id: ORG.id, label: 'Acme' },
  org: ORG,
  reason: null,
  changes: [],
  ...over,
});
const sentence = (dto: PlatformAuditEntryDto) => {
  const what = toPlatformAuditRow(dto, NOW).what;
  if (what.kind !== 'sentence') throw new Error('not a sentence');
  return what;
};
const text = (dto: PlatformAuditEntryDto) =>
  sentence(dto)
    .parts.map((p) => p.text)
    .join('');
const adminTarget = { type: 'platform_admin', id: 'a', label: 'a@x.io' };
const inviteTarget = { type: 'invitation', id: 'x', label: 'r@x.io' };
const assignTarget = { type: 'assignment', id: 'x', label: 'Ruth' };

describe('PLATFORM_AUDIT_ACTION_LABELS', () => {
  it('BR-50: every PlatformAuditAction has its label', () => {
    for (const action of PlatformAuditAction.options) expect(PLATFORM_AUDIT_ACTION_LABELS[action]).toBeTruthy();
    expect(PlatformAuditAction.options.map((a) => PLATFORM_AUDIT_ACTION_LABELS[a])).toEqual([
      'Platform admin added',
      'Platform admin revoked',
      'Organization created',
      'Organization updated',
      'Organization suspended',
      'Organization reactivated',
      'Assignment added',
      'Assignment removed',
      'Invitation created',
      'Invitation resent',
      'Invitation revoked',
    ]);
  });
});

describe('toPlatformAuditRow', () => {
  it('BR-45: writes the spec sentence for each action', () => {
    const t = (action: PlatformAuditEntryDto['action'], over: Partial<PlatformAuditEntryDto>) =>
      text(audit({ action, ...over }));
    expect(t('org.created', {})).toBe('Dev Admin created Acme');
    expect(t('org.suspended', { reason: 'r' })).toBe('Dev Admin suspended Acme');
    expect(t('org.reactivated', { reason: 'r' })).toBe('Dev Admin reactivated Acme');
    expect(t('platform_admin.granted', { org: null, target: adminTarget })).toBe(
      'Dev Admin added a@x.io as a platform admin',
    );
    expect(t('platform_admin.revoked', { org: null, target: adminTarget })).toBe(
      'Dev Admin revoked platform access for a@x.io',
    );
    expect(
      t('assignment.granted', { target: assignTarget, changes: [{ field: 'role', from: null, to: 'owner' }] }),
    ).toBe('Dev Admin gave Ruth the Owner role in Acme');
    expect(
      t('assignment.revoked', { target: assignTarget, changes: [{ field: 'role', from: 'admin', to: null }] }),
    ).toBe("Dev Admin removed Ruth's Admin role in Acme");
    expect(
      t('invitation.created', { target: inviteTarget, changes: [{ field: 'role', from: null, to: 'admin' }] }),
    ).toBe('Dev Admin invited r@x.io to Acme as Admin');
    expect(t('invitation.resent', { target: inviteTarget })).toBe('Dev Admin resent the invitation for r@x.io to Acme');
    expect(t('invitation.revoked', { target: inviteTarget })).toBe(
      'Dev Admin revoked the invitation for r@x.io to Acme',
    );
  });

  it('BR-45: an edit of both fields reads from the changes, with the URLs in mono', () => {
    const s = sentence(
      audit({
        action: 'org.updated',
        changes: [
          { field: 'name', from: 'Acme Labs', to: 'Acme' },
          { field: 'slug', from: 'acme-labs', to: 'acme' },
        ],
      }),
    );
    expect(s.parts.map((p) => p.text).join('')).toBe(
      'Dev Admin changed the name of Acme from Acme Labs to Acme and the URL from /o/acme-labs to /o/acme',
    );
    expect(s.parts.filter((p) => p.mono).map((p) => p.text)).toEqual(['/o/acme-labs', '/o/acme']);
    expect(s.title).toBe(s.parts.map((p) => p.text).join(''));
  });

  it('BR-45: a one-field edit names only that field', () => {
    expect(text(audit({ action: 'org.updated', changes: [{ field: 'name', from: 'A', to: 'Acme' }] }))).toBe(
      'Dev Admin changed the name of Acme from A to Acme',
    );
    expect(text(audit({ action: 'org.updated', changes: [{ field: 'slug', from: 'a', to: 'acme' }] }))).toBe(
      'Dev Admin changed the URL of Acme from /o/a to /o/acme',
    );
  });

  it('BR-45: the actor and the org are bold', () => {
    const bold = sentence(audit())
      .parts.filter((p) => p.strong)
      .map((p) => p.text);
    expect(bold).toEqual(['Dev Admin', 'Acme']);
  });

  it('BR-45: a gone actor reads Deleted user in the Who column and the sentence', () => {
    const row = toPlatformAuditRow(audit({ actor: null }), NOW);
    expect(row.who).toEqual({ label: 'Deleted user', tag: 'deleted' });
    expect(text(audit({ actor: null }))).toBe('Deleted user created Acme');
  });

  it('BR-45: a gone org falls back to the target label, then a plain phrase', () => {
    expect(text(audit({ org: null }))).toBe('Dev Admin created Acme');
    expect(text(audit({ org: null, action: 'invitation.revoked', target: inviteTarget }))).toBe(
      'Dev Admin revoked the invitation for r@x.io to a deleted organization',
    );
  });

  it('BR-45: the Reason note shows only on suspend and reactivate rows', () => {
    expect(toPlatformAuditRow(audit({ action: 'org.suspended', reason: 'Billing hold' }), NOW).note).toBe(
      'Reason: Billing hold',
    );
    expect(toPlatformAuditRow(audit({ action: 'org.reactivated', reason: 'Paid' }), NOW).note).toBe('Reason: Paid');
    expect(toPlatformAuditRow(audit({ action: 'org.created', reason: 'x' }), NOW).note).toBeUndefined();
    expect(toPlatformAuditRow(audit({ action: 'org.suspended', reason: null }), NOW).note).toBeUndefined();
  });

  it('markup in a reason or an org name stays text', () => {
    const row = toPlatformAuditRow(
      audit({
        action: 'org.suspended',
        reason: '<img src=x onerror=alert(1)>',
        org: { id: ORG.id, name: '<b>Acme</b>' },
      }),
      NOW,
    );
    expect(row.note).toBe('Reason: <img src=x onerror=alert(1)>');
    expect(row.what.kind === 'sentence' && row.what.parts.map((p) => p.text)).toContain('<b>Acme</b>');
  });

  it('shows when as relative time with the exact date', () => {
    const row = toPlatformAuditRow(audit(), NOW);
    expect(row.when.iso).toBe('2026-11-23T11:00:00.000Z');
    expect(row.when.label).toBe('1 hour ago');
  });
});

describe('toPlatformMemberRow (BR-26)', () => {
  const ALPHA = 'd1000000-0000-4000-8000-000000000001';
  const role = (key: string, name: string) => ({ id: `r-${key}`, key, name });
  const assignment = (id: string, r: ReturnType<typeof role>, projectId: string | null) => ({
    id,
    userId: 'user-lee',
    role: r,
    scope: projectId === null ? ({ type: 'org' } as const) : ({ type: 'project', projectId } as const),
    grantedBy: null,
    grantedAt: '2026-11-01T10:00:00.000Z',
  });
  const member = (over: Partial<PlatformMemberDto> = {}): PlatformMemberDto => ({
    userId: 'user-lee',
    handle: 'lee',
    name: 'Lee Park',
    email: 'lee@example.com',
    assignments: [],
    ...over,
  });
  const names = new Map([[ALPHA, 'Alpha']]);

  it('labels an org role "<Role> (organization)" and a project role "<Role> (<project name>)", keeping the assignment ids', () => {
    const row = toPlatformMemberRow(
      member({
        assignments: [
          assignment('a1', role('owner', 'Owner'), null),
          assignment('a2', role('member', 'Member'), ALPHA),
        ],
      }),
      names,
    );
    expect(row.assignments).toEqual([
      { assignmentId: 'a1', label: 'Owner (organization)' },
      { assignmentId: 'a2', label: 'Member (Alpha)' },
    ]);
    expect(row.assignments.map((a) => a.label).join(', ')).toBe('Owner (organization), Member (Alpha)');
  });

  it('a member with no assignment has none (the row shows a dash)', () => {
    expect(toPlatformMemberRow(member(), names).assignments).toEqual([]);
  });

  it('a nameless member has a null name and keeps the handle', () => {
    const row = toPlatformMemberRow(member({ name: '' }), names);
    expect(row.name).toBeNull();
    expect(row.handle).toBe('lee');
  });

  it('a project that is not in the name map reads as "a project", never its id', () => {
    const row = toPlatformMemberRow(
      member({ assignments: [assignment('a1', role('viewer', 'Viewer'), 'gone')] }),
      names,
    );
    expect(row.assignments[0]?.label).toBe('Viewer (a project)');
  });
});
