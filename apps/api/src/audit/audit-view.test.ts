import { describe, expect, it, vi } from 'vitest';
import { AuditEntryDto, type Access, type Grant, type GrantLine, type Permission } from '@agentdesk/contracts';
import { auditViewerOf, toAuditEntry, type AuditLookups, type AuditRowIn } from './audit-view';
import { redactBody } from './redact-body';

// the real redactBody, wrapped so a test can see the call and, for one call, replace its result
vi.mock('./redact-body', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./redact-body')>();
  return { ...actual, redactBody: vi.fn(actual.redactBody) };
});

const AT = new Date('2026-11-22T10:00:00.000Z');
const ROW_ID = '11111111-1111-4111-8111-111111111111';
const INV_ID = '22222222-2222-4222-8222-222222222222';

const P1 = '33333333-3333-4333-8333-333333333331';
const P2 = '33333333-3333-4333-8333-333333333332';
const P3 = '33333333-3333-4333-8333-333333333333';
const P_GONE = '33333333-3333-4333-8333-333333333399';

const line = (permission: Permission): GrantLine => ({ permission, condition: 'any' });
const grant = (roleKey: string, scope: Grant['scope'], permissions: Permission[]): Grant => ({
  roleId: `role-${roleKey}`,
  roleKey,
  scope,
  lines: permissions.map(line),
});
const ORG_PERMS: Permission[] = ['member:read', 'assignment:read', 'project:read', 'audit:read', 'project-audit:read'];
const PROJECT_PERMS: Permission[] = ['assignment:read', 'project:read', 'project-audit:read'];
const owner = auditViewerOf({ userId: 'o', grants: [grant('owner', { type: 'org' }, ORG_PERMS)] });
const orgAdmin = auditViewerOf({ userId: 'a', grants: [grant('admin', { type: 'org' }, ORG_PERMS)] });
const adminOf = (...ids: string[]): Access => ({
  userId: 'pa',
  grants: ids.map((projectId) => grant('admin', { type: 'project', projectId }, PROJECT_PERMS)),
});
const p1Admin = auditViewerOf(adminOf(P1));

const lookups: AuditLookups = {
  projectNames: new Map([
    [P1, 'Alpha'],
    [P2, 'Beta'],
    [P3, 'Alpha'],
  ]),
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
    projectIds: [],
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
      [{ field: 'role', from: null, to: 'Admin' }],
    ],
    [
      'project_member.role_changed',
      row({
        action: 'project_member.role_changed',
        targetType: 'user',
        targetId: 'u-target',
        payload: { projectId: P1, from: ['member', 'viewer'], to: 'admin' },
      }),
      [{ field: 'role', from: 'Member, Viewer', to: 'Admin' }],
    ],
    [
      'project_member.removed',
      row({
        action: 'project_member.removed',
        targetType: 'user',
        targetId: 'u-target',
        payload: { projectId: P1, from: ['admin'] },
      }),
      [{ field: 'role', from: 'Admin', to: null }],
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
    const out = toAuditEntry(input, lookups, owner);
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
      'assignment.granted',
      'project_member.role_changed',
      'project_member.removed',
    ]) {
      const out = toAuditEntry(row({ action, targetType: 'user', targetId: 'u-target', payload: {} }), lookups, owner);
      expect(out.changes).toEqual([]);
      expect(out.target).toEqual({ type: 'user', id: 'u-target', label: 'Bob Roe' });
    }
    const odd = toAuditEntry(
      row({ action: 'member.role_changed', targetType: 'user', targetId: 'u-target', payload: { from: 'x', to: 5 } }),
      lookups,
      owner,
    );
    expect(odd.changes).toEqual([]);
    for (const [action, payload] of [
      ['assignment.granted', { to: 'admin' }],
      ['project_member.role_changed', { from: 'member', to: 'admin' }],
      ['project_member.role_changed', { from: ['member'], to: 5 }],
      ['project_member.removed', { from: 'admin' }],
    ] as const) {
      const bad = toAuditEntry(row({ action, targetType: 'user', targetId: 'u-target', payload }), lookups, owner);
      expect(bad.changes).toEqual([]);
    }
  });

  it('an unknown role key falls back to the key', () => {
    const out = toAuditEntry(
      row({ action: 'member.role_changed', payload: { from: ['custom'], to: 'owner' } }),
      lookups,
      owner,
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
      owner,
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
    const out = toAuditEntry(row({ action: 'org.updated', payload: stored }), lookups, owner);
    expect(redactBody).toHaveBeenCalledTimes(1);
    expect(redactBody).toHaveBeenCalledWith(stored);
    expect(out.actorKind).toBe('platform_admin');
    expect(out.changes).toEqual([{ field: 'name', from: 'Old', to: 'Redacted' }]);
  });

  it('a secret-shaped key holding a role-like value is dropped', () => {
    const out = toAuditEntry(
      row({ action: 'org.updated', payload: { from: { name: 'A' }, to: { name: 'B' }, secret: 'x' } }),
      lookups,
      owner,
    );
    expect(JSON.stringify(out)).not.toContain('"x"');
  });

  it('has exactly the DTO keys and never a payload', () => {
    const out = toAuditEntry(row({ payload: { anything: 1 } }), lookups, owner);
    expect(Object.keys(out).sort()).toEqual([
      'action',
      'actor',
      'actorKind',
      'at',
      'changes',
      'id',
      'projects',
      'target',
    ]);
    expect(Object.keys(out.target).sort()).toEqual(['id', 'label', 'type']);
    expect(out.at).toBe('2026-11-22T10:00:00.000Z');
  });

  it('reads the actor from the lookups and is null for a missing or unknown user', () => {
    expect(toAuditEntry(row({}), lookups, owner).actor).toEqual({
      userId: 'u-actor',
      name: 'Alice Doe',
      handle: 'alice',
    });
    expect(toAuditEntry(row({ actorUserId: 'gone' }), lookups, owner).actor).toBeNull();
    expect(toAuditEntry(row({ actorUserId: null }), lookups, owner).actor).toBeNull();
  });

  it('takes actorKind from the payload, else null', () => {
    const typed = (payload: Record<string, unknown>) => row({ action: 'org.updated', payload });
    expect(toAuditEntry(typed({ actorKind: 'platform_admin' }), lookups, owner).actorKind).toBe('platform_admin');
    expect(toAuditEntry(typed({ actorKind: 'member' }), lookups, owner).actorKind).toBe('member');
    expect(toAuditEntry(typed({ actorKind: 'root' }), lookups, owner).actorKind).toBeNull();
    expect(toAuditEntry(typed({}), lookups, owner).actorKind).toBeNull();
  });

  it('ignores an actorKind in the stored request body of a generic row', () => {
    const forged = row({ action: 'PUT agents.put', payload: { actorKind: 'platform_admin' } });
    expect(toAuditEntry(forged, lookups, owner).actorKind).toBeNull();
  });

  it('labels only invitation targets with the invitee email, and users with their name', () => {
    expect(
      toAuditEntry(row({ action: 'invitation.revoked', targetType: 'invitation', targetId: INV_ID }), lookups, owner)
        .target.label,
    ).toBe('invitee@example.com');
    expect(
      toAuditEntry(row({ action: 'invitation.revoked', targetType: 'invitation', targetId: 'other' }), lookups, owner)
        .target.label,
    ).toBeNull();
    const user = toAuditEntry(
      row({ action: 'member.removed', targetType: 'user', targetId: 'u-target' }),
      lookups,
      owner,
    );
    expect(user.target.label).toBe('Bob Roe');
    // an email in the payload of a non-invitation row never becomes a label
    const generic = toAuditEntry(
      row({ targetType: 'org', targetId: 'o', payload: { email: 'a@b.c' } }),
      lookups,
      owner,
    );
    expect(generic.target.label).toBeNull();
    expect(JSON.stringify(generic)).not.toContain('a@b.c');
  });
});

const INVITATION_ACTIONS = [
  'invitation.created',
  'invitation.resent',
  'invitation.revoked',
  'invitation.accepted',
  'invitation.declined',
  'invitation.expired',
] as const;

describe('toAuditEntry invitation redaction per viewer', () => {
  const inv = (action: string, projectIds: string[]) =>
    row({ action, targetType: 'invitation', targetId: INV_ID, projectIds, payload: {} });

  it.each(INVITATION_ACTIONS)(
    '%s: owner and org admin get the email and every project, sorted by name then id',
    (a) => {
      for (const viewer of [owner, orgAdmin]) {
        const out = toAuditEntry(inv(a, [P2, P3, P1]), lookups, viewer);
        expect(out.target.label).toBe('invitee@example.com');
        expect(out.projects).toEqual([
          { id: P1, name: 'Alpha' },
          { id: P3, name: 'Alpha' },
          { id: P2, name: 'Beta' },
        ]);
      }
    },
  );

  it.each(INVITATION_ACTIONS)('%s: a P1 admin sees the email and P1 when the invitation lists P1 only', (a) => {
    const out = toAuditEntry(inv(a, [P1]), lookups, p1Admin);
    expect(out.target.label).toBe('invitee@example.com');
    expect(out.projects).toEqual([{ id: P1, name: 'Alpha' }]);
  });

  it.each(INVITATION_ACTIONS)('%s: a P1 admin of P1 + P2 loses the email and never sees P2', (a) => {
    const out = toAuditEntry(inv(a, [P1, P2]), lookups, p1Admin);
    expect(out.target.label).toBeNull();
    expect(out.projects).toEqual([{ id: P1, name: 'Alpha' }]);
    const json = JSON.stringify(out);
    expect(json).not.toContain(P2);
    expect(json).not.toContain('Beta');
    expect(json).not.toContain('invitee@example.com');
  });

  it.each(INVITATION_ACTIONS)('%s: a project admin gets no email on an org-scope invitation', (a) => {
    const out = toAuditEntry(inv(a, []), lookups, p1Admin);
    expect(out.target.label).toBeNull();
    expect(out.projects).toEqual([]);
  });

  it.each(INVITATION_ACTIONS)('%s: an org-scope invitation keeps the email for an owner, with no projects', (a) => {
    const out = toAuditEntry(inv(a, []), lookups, owner);
    expect(out.target.label).toBe('invitee@example.com');
    expect(out.projects).toEqual([]);
  });

  it.each(INVITATION_ACTIONS)('%s: a deleted listed project is left out, never shown as an id', (a) => {
    const some = toAuditEntry(inv(a, [P_GONE, P1]), lookups, owner);
    expect(some.projects).toEqual([{ id: P1, name: 'Alpha' }]);
    const none = toAuditEntry(inv(a, [P_GONE]), lookups, owner);
    expect(none.projects).toEqual([]);
    expect(JSON.stringify(none)).not.toContain(P_GONE);
  });

  it('a viewer who cannot read the project sees no project name', () => {
    const noVisible = auditViewerOf({
      userId: 'x',
      grants: [grant('v', { type: 'project', projectId: P1 }, ['assignment:read'])],
    });
    const out = toAuditEntry(inv('invitation.created', [P1]), lookups, noVisible);
    expect(out.projects).toEqual([]);
    expect(out.target.label).toBe('invitee@example.com');
  });

  it('non-invitation rows carry no projects even when tagged', () => {
    for (const action of ['assignment.granted', 'project_member.removed', 'GET x.y']) {
      const out = toAuditEntry(row({ action, projectIds: [P1] }), lookups, owner);
      expect(out.projects).toEqual([]);
    }
  });

  it('emailFor and seesProject follow the viewer access', () => {
    expect(owner.emailFor([])).toBe(true);
    expect(p1Admin.emailFor([])).toBe(false);
    expect(p1Admin.emailFor([P1])).toBe(true);
    expect(p1Admin.emailFor([P1, P2])).toBe(false);
    expect(p1Admin.seesProject(P1)).toBe(true);
    expect(p1Admin.seesProject(P2)).toBe(false);
    expect(auditViewerOf(adminOf(P1, P2)).emailFor([P1, P2])).toBe(true);
  });
});
