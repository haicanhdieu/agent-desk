import { describe, expect, it, vi } from 'vitest';
import { AuditEntryDto } from '@agentdesk/contracts';
import { toAuditEntry, type AuditLookups, type AuditRowIn } from './audit-view';
import { redactBody } from './redact-body';

// the real redactBody, wrapped so a test can see the call and, for one call, replace its result
vi.mock('./redact-body', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./redact-body')>();
  return { ...actual, redactBody: vi.fn(actual.redactBody) };
});

const AT = new Date('2026-11-22T10:00:00.000Z');
const ROW_ID = '11111111-1111-4111-8111-111111111111';
const INV_ID = '22222222-2222-4222-8222-222222222222';

const lookups: AuditLookups = {
  users: new Map([
    ['u-actor', { name: 'Alice Doe', handle: 'alice' }],
    ['u-target', { name: 'Bob Roe', handle: 'bob' }],
  ]),
  invitationEmails: new Map([[INV_ID, 'invitee@example.com']]),
  roleNames: new Map([
    ['owner', 'Owner'],
    ['admin', 'Admin'],
    ['member', 'Member'],
    ['viewer', 'Viewer'],
  ]),
};

function row(over: Partial<AuditRowIn>): AuditRowIn {
  return {
    id: ROW_ID,
    at: AT,
    actorUserId: 'u-actor',
    action: 'GET x.y',
    targetType: null,
    targetId: null,
    payload: {},
    ...over,
  };
}

describe('toAuditEntry', () => {
  it.each([
    [
      'member.role_changed',
      row({
        action: 'member.role_changed',
        targetType: 'user',
        targetId: 'u-target',
        payload: { from: ['member', 'viewer'], to: 'admin' },
      }),
      [{ field: 'role', from: 'Member, Viewer', to: 'Admin' }],
    ],
    [
      'member.role_changed to no role',
      row({
        action: 'member.role_changed',
        targetType: 'user',
        targetId: 'u-target',
        payload: { from: ['owner'], to: null },
      }),
      [{ field: 'role', from: 'Owner', to: null }],
    ],
    [
      'member.role_changed from no role',
      row({
        action: 'member.role_changed',
        targetType: 'user',
        targetId: 'u-target',
        payload: { from: [], to: 'viewer' },
      }),
      [{ field: 'role', from: null, to: 'Viewer' }],
    ],
    [
      'org.updated name and slug',
      row({
        action: 'org.updated',
        targetType: 'org',
        targetId: ROW_ID,
        payload: { from: { name: 'Old', slug: 'old' }, to: { name: 'New', slug: 'new' } },
      }),
      [
        { field: 'name', from: 'Old', to: 'New' },
        { field: 'slug', from: 'old', to: 'new' },
      ],
    ],
    [
      'org.updated name only',
      row({ action: 'org.updated', targetType: 'org', payload: { from: { name: 'Old' }, to: { name: 'New' } } }),
      [{ field: 'name', from: 'Old', to: 'New' }],
    ],
    [
      'member.removed',
      row({
        action: 'member.removed',
        targetType: 'user',
        targetId: 'u-target',
        payload: { from: [{ roleKey: 'admin', scope: 'org', projectId: null }] },
      }),
      [{ field: 'role', from: 'Admin', to: null }],
    ],
    [
      'invitation.created',
      row({
        action: 'invitation.created',
        targetType: 'invitation',
        targetId: INV_ID,
        payload: { email: 'x@example.com', to: { roleId: 'r', roleKey: 'member', scope: { type: 'org' } } },
      }),
      [{ field: 'role', from: null, to: 'Member' }],
    ],
    [
      'invitation.accepted',
      row({
        action: 'invitation.accepted',
        targetType: 'invitation',
        targetId: INV_ID,
        payload: { to: { roleKey: 'viewer', scope: { type: 'org' } } },
      }),
      [{ field: 'role', from: null, to: 'Viewer' }],
    ],
    ['invitation.resent', row({ action: 'invitation.resent', targetType: 'invitation', targetId: INV_ID }), []],
    ['invitation.revoked', row({ action: 'invitation.revoked', targetType: 'invitation', targetId: INV_ID }), []],
    ['invitation.declined', row({ action: 'invitation.declined', targetType: 'invitation', targetId: INV_ID }), []],
    ['invitation.expired', row({ action: 'invitation.expired', targetType: 'invitation', targetId: INV_ID }), []],
    [
      'assignment.granted',
      row({
        action: 'assignment.granted',
        targetType: 'user',
        targetId: 'u-target',
        payload: { to: { roleKey: 'admin' } },
      }),
      [],
    ],
    [
      'assignment.revoked',
      row({
        action: 'assignment.revoked',
        targetType: 'user',
        targetId: 'u-target',
        payload: { from: { roleKey: 'admin' } },
      }),
      [],
    ],
    ['org.created', row({ action: 'org.created', targetType: 'org', payload: { name: 'N', slug: 's' } }), []],
    ['a generic request row', row({ action: 'POST projects.create', payload: { name: 'P' } }), []],
  ])('%s maps to its changes and the DTO schema', (_name, input, changes) => {
    const out = toAuditEntry(input, lookups);
    expect(out.changes).toEqual(changes);
    expect(AuditEntryDto.safeParse(out).success).toBe(true);
  });

  it('a known action with a payload missing its fields maps to empty changes and keeps the target', () => {
    for (const action of [
      'member.role_changed',
      'org.updated',
      'member.removed',
      'invitation.created',
      'assignment.revoked',
    ]) {
      const out = toAuditEntry(row({ action, targetType: 'user', targetId: 'u-target', payload: {} }), lookups);
      expect(out.changes).toEqual([]);
      expect(out.target).toEqual({ type: 'user', id: 'u-target', label: 'Bob Roe' });
    }
    const odd = toAuditEntry(
      row({ action: 'member.role_changed', targetType: 'user', targetId: 'u-target', payload: { from: 'x', to: 5 } }),
      lookups,
    );
    expect(odd.changes).toEqual([]);
  });

  it('an unknown role key falls back to the key', () => {
    const out = toAuditEntry(
      row({ action: 'member.role_changed', payload: { from: ['custom'], to: 'owner' } }),
      lookups,
    );
    expect(out.changes).toEqual([{ field: 'role', from: 'custom', to: 'Owner' }]);
  });

  it('passes the payload through redactBody before reading it (a token never reaches a label)', () => {
    const out = toAuditEntry(
      row({
        action: 'org.updated',
        payload: { from: { name: 'Old', token: 'sekret' }, to: { name: 'New', token: 'sekret' } },
      }),
      lookups,
    );
    expect(JSON.stringify(out)).not.toContain('sekret');
    expect(out.changes).toEqual([{ field: 'name', from: 'Old', to: 'New' }]);
  });

  it('reads the actor kind and changes from the redacted copy of the payload, not from the stored one', () => {
    // No field the view reads can itself be secret-shaped, so a fixture cannot tell the redacted copy from the stored
    // payload; the call is observed instead. Removing `redactBody` from `toAuditEntry` fails every assertion here.
    const stored = { actorKind: 'member', from: { name: 'Old' }, to: { name: 'Stored' } };
    vi.mocked(redactBody).mockClear();
    vi.mocked(redactBody).mockReturnValueOnce({
      actorKind: 'platform_admin',
      from: { name: 'Old' },
      to: { name: 'Redacted' },
    });
    const out = toAuditEntry(row({ action: 'org.updated', payload: stored }), lookups);
    expect(redactBody).toHaveBeenCalledTimes(1);
    expect(redactBody).toHaveBeenCalledWith(stored);
    expect(out.actorKind).toBe('platform_admin');
    expect(out.changes).toEqual([{ field: 'name', from: 'Old', to: 'Redacted' }]);
  });

  it('a secret-shaped key holding a role-like value is dropped', () => {
    const out = toAuditEntry(
      row({ action: 'org.updated', payload: { from: { name: 'A' }, to: { name: 'B' }, secret: 'x' } }),
      lookups,
    );
    expect(JSON.stringify(out)).not.toContain('"x"');
  });

  it('has exactly the DTO keys and never a payload', () => {
    const out = toAuditEntry(row({ payload: { anything: 1 } }), lookups);
    expect(Object.keys(out).sort()).toEqual(['action', 'actor', 'actorKind', 'at', 'changes', 'id', 'target']);
    expect(Object.keys(out.target).sort()).toEqual(['id', 'label', 'type']);
    expect(out.at).toBe('2026-11-22T10:00:00.000Z');
  });

  it('reads the actor from the lookups and is null for a missing or unknown user', () => {
    expect(toAuditEntry(row({}), lookups).actor).toEqual({ userId: 'u-actor', name: 'Alice Doe', handle: 'alice' });
    expect(toAuditEntry(row({ actorUserId: 'gone' }), lookups).actor).toBeNull();
    expect(toAuditEntry(row({ actorUserId: null }), lookups).actor).toBeNull();
  });

  it('takes actorKind from the payload, else null', () => {
    const typed = (payload: Record<string, unknown>) => row({ action: 'org.updated', payload });
    expect(toAuditEntry(typed({ actorKind: 'platform_admin' }), lookups).actorKind).toBe('platform_admin');
    expect(toAuditEntry(typed({ actorKind: 'member' }), lookups).actorKind).toBe('member');
    expect(toAuditEntry(typed({ actorKind: 'root' }), lookups).actorKind).toBeNull();
    expect(toAuditEntry(typed({}), lookups).actorKind).toBeNull();
  });

  it('ignores an actorKind in the stored request body of a generic row', () => {
    const forged = row({ action: 'PUT agents.put', payload: { actorKind: 'platform_admin' } });
    expect(toAuditEntry(forged, lookups).actorKind).toBeNull();
  });

  it('labels only invitation targets with the invitee email, and users with their name', () => {
    expect(
      toAuditEntry(row({ action: 'invitation.revoked', targetType: 'invitation', targetId: INV_ID }), lookups).target
        .label,
    ).toBe('invitee@example.com');
    expect(
      toAuditEntry(row({ action: 'invitation.revoked', targetType: 'invitation', targetId: 'other' }), lookups).target
        .label,
    ).toBeNull();
    const user = toAuditEntry(row({ action: 'member.removed', targetType: 'user', targetId: 'u-target' }), lookups);
    expect(user.target.label).toBe('Bob Roe');
    // an email in the payload of a non-invitation row never becomes a label
    const generic = toAuditEntry(row({ targetType: 'org', targetId: 'o', payload: { email: 'a@b.c' } }), lookups);
    expect(generic.target.label).toBeNull();
    expect(JSON.stringify(generic)).not.toContain('a@b.c');
  });
});
