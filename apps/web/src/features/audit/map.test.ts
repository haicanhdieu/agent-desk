import { describe, expect, it } from 'vitest';
import type { AuditEntryDto } from '@agentdesk/contracts';
import { toAuditRow } from './map';

const NOW = new Date('2026-11-22T11:00:00.000Z');
const TZ = 'UTC';
const ALICE = { userId: 'u-alice', name: 'Alice Doe', handle: 'alice' };

const entry = (over: Partial<AuditEntryDto>): AuditEntryDto => ({
  id: 'b5000000-0000-4000-8000-000000000001',
  at: '2026-11-22T10:58:00.000Z',
  actor: ALICE,
  actorKind: 'member',
  action: 'member.role_changed',
  target: { type: null, id: null, label: null },
  changes: [],
  ...over,
});
const user = (label: string | null) => ({ type: 'user', id: 'u-b', label });
const invitation = (label: string | null) => ({ type: 'invitation', id: 'i-1', label });
const change = (field: 'role' | 'name' | 'slug', from: string | null, to: string | null) => ({ field, from, to });
const sentence = (row: ReturnType<typeof toAuditRow>) => {
  if (row.what.kind !== 'sentence') throw new Error('not a sentence row');
  return row.what;
};

describe('toAuditRow: when (BR-20)', () => {
  it.each([
    ['2 min ago', '2026-11-22T10:58:00.000Z', '2 min ago', '22 Nov 2026, 10:58'],
    ['yesterday', '2026-11-21T09:00:00.000Z', 'yesterday', '21 Nov 2026, 09:00'],
    ['a date after two days', '2026-11-12T08:30:00.000Z', '12 Nov', '12 Nov 2026, 08:30'],
  ])('TC-20.7 %s', (_n, at, label, exact) => {
    expect(toAuditRow(entry({ at }), NOW, TZ).when).toEqual({ label, exact, iso: at });
  });
});

describe('toAuditRow: who (BR-20)', () => {
  it.each([
    ['a member shows the name', { actor: ALICE, actorKind: 'member' as const }, { label: 'Alice Doe', tag: null }],
    [
      'TC-20.4 a gone actor shows Deleted user',
      { actor: null, actorKind: null },
      { label: 'Deleted user', tag: 'deleted' },
    ],
    [
      'TC-20.5 a platform admin carries the tag',
      { actor: { userId: 'u-p', name: 'Pat Platform', handle: 'pat' }, actorKind: 'platform_admin' as const },
      { label: 'Pat Platform', tag: 'platform' },
    ],
  ])('%s', (_n, over, who) => {
    expect(toAuditRow(entry(over), NOW, TZ).who).toEqual(who);
  });
});

describe('toAuditRow: what, known actions (BR-21 to BR-23)', () => {
  it.each([
    [
      'TC-21.1 role change',
      entry({ target: user('Ben Okafor'), changes: [change('role', 'Admin', 'Owner')] }),
      [
        ['Alice Doe', true],
        [' changed ', false],
        ['Ben Okafor', true],
        ["'s role from Admin to Owner", false],
      ],
    ],
    [
      'role change from no role',
      entry({ target: user('Ben Okafor'), changes: [change('role', null, 'Owner')] }),
      [
        ['Alice Doe', true],
        [' changed ', false],
        ['Ben Okafor', true],
        ["'s role from No role to Owner", false],
      ],
    ],
    [
      'TC-22.2 slug change',
      entry({ action: 'org.updated', changes: [change('slug', 'harbor', 'harbor-labs')] }),
      [
        ['Alice Doe', true],
        [' changed the organization URL from ', false],
        ['/o/harbor', true],
        [' to ', false],
        ['/o/harbor-labs', true],
      ],
    ],
    [
      'TC-22.1 name change',
      entry({ action: 'org.updated', changes: [change('name', 'Harbor', 'Harbor Labs')] }),
      [
        ['Alice Doe', true],
        [' changed the organization name from ', false],
        ['Harbor', true],
        [' to ', false],
        ['Harbor Labs', true],
      ],
    ],
    [
      'BR-22 name and slug in one entry',
      entry({
        action: 'org.updated',
        changes: [change('name', 'Harbor', 'Harbor Labs'), change('slug', 'harbor', 'harbor-labs')],
      }),
      [
        ['Alice Doe', true],
        [' changed the organization name from ', false],
        ['Harbor', true],
        [' to ', false],
        ['Harbor Labs', true],
        [' and the URL from ', false],
        ['/o/harbor', true],
        [' to ', false],
        ['/o/harbor-labs', true],
      ],
    ],
    [
      'TC-21.4 removal with the old role',
      entry({ action: 'member.removed', target: user('Dana Wu'), changes: [change('role', 'Member', null)] }),
      [
        ['Alice Doe', true],
        [' removed ', false],
        ['Dana Wu', true],
        [' from the organization (was Member)', false],
      ],
    ],
    [
      'removal without a role',
      entry({ action: 'member.removed', target: user('Dana Wu'), changes: [change('role', null, null)] }),
      [
        ['Alice Doe', true],
        [' removed ', false],
        ['Dana Wu', true],
        [' from the organization', false],
      ],
    ],
    [
      'TC-23.1 invitation created',
      entry({
        action: 'invitation.created',
        target: invitation('sam@example.test'),
        changes: [change('role', null, 'Viewer')],
      }),
      [
        ['Alice Doe', true],
        [' invited ', false],
        ['sam@example.test', true],
        [' as Viewer', false],
      ],
    ],
    [
      'TC-23.2 invitation resent',
      entry({ action: 'invitation.resent', target: invitation('sam@example.test') }),
      [
        ['Alice Doe', true],
        [' resent the invitation for ', false],
        ['sam@example.test', true],
      ],
    ],
    [
      'TC-23.3 invitation revoked',
      entry({ action: 'invitation.revoked', target: invitation('sam@example.test') }),
      [
        ['Alice Doe', true],
        [' revoked the invitation for ', false],
        ['sam@example.test', true],
      ],
    ],
    [
      'TC-23.4 invitation accepted shows no email even when a label arrives',
      entry({
        action: 'invitation.accepted',
        target: invitation('sam@example.test'),
        changes: [change('role', null, 'Member')],
      }),
      [
        ['Alice Doe', true],
        [' accepted an invitation as Member', false],
      ],
    ],
    [
      'TC-23.5 invitation declined shows no email',
      entry({ action: 'invitation.declined', target: invitation('sam@example.test') }),
      [
        ['Alice Doe', true],
        [' declined an invitation', false],
      ],
    ],
    [
      'a gone actor reads as Someone',
      entry({
        actor: null,
        actorKind: null,
        target: user('Cleo Martin'),
        changes: [change('role', 'Viewer', 'Member')],
      }),
      [
        ['Someone', true],
        [' changed ', false],
        ['Cleo Martin', true],
        ["'s role from Viewer to Member", false],
      ],
    ],
  ])('%s', (_n, dto, parts) => {
    const what = sentence(toAuditRow(dto, NOW, TZ));
    expect(what.parts.map((p) => [p.text, p.strong])).toEqual(parts);
    expect(what.title).toBe(parts.map(([t]) => t).join(''));
  });

  it('keeps HTML in a name or an email as plain text', () => {
    const what = sentence(
      toAuditRow(entry({ action: 'invitation.created', target: invitation('<b>x</b>@example.com') }), NOW, TZ),
    );
    expect(what.parts.map((p) => p.text)).toContain('<b>x</b>@example.com');
  });
});

describe('toAuditRow: what, raw rows (TC-20.7)', () => {
  it.each([
    ['a generic request row', entry({ action: 'POST orgs.create' }), 'POST orgs.create', null],
    [
      'assignment.granted',
      entry({ action: 'assignment.granted', target: user('Ben Okafor') }),
      'assignment.granted',
      'Ben Okafor',
    ],
    ['assignment.revoked', entry({ action: 'assignment.revoked' }), 'assignment.revoked', null],
    [
      'invitation.expired',
      entry({ action: 'invitation.expired', target: invitation('sam@example.test') }),
      'invitation.expired',
      null,
    ],
    ['org.created', entry({ action: 'org.created' }), 'org.created', null],
    ['org.updated without a change', entry({ action: 'org.updated' }), 'org.updated', null],
    [
      'member.role_changed without a role change',
      entry({ action: 'member.role_changed', target: user('Ben Okafor') }),
      'member.role_changed',
      'Ben Okafor',
    ],
  ])('%s shows the key', (_n, dto, key, target) => {
    expect(toAuditRow(dto, NOW, TZ).what).toEqual({ kind: 'raw', key, target });
  });
});

describe('toAuditRow: platform suspend and reactivate (BR-43)', () => {
  const PLATFORM = { userId: 'u-ada', name: 'Ada Admin', handle: 'ada' };
  it.each([
    ['org.suspended', ' suspended the organization'],
    ['org.reactivated', ' reactivated the organization'],
  ] as const)('%s reads "<actor>%s" with the Platform admin tag and no reason', (action, tail) => {
    const row = toAuditRow(
      entry({
        action,
        actor: PLATFORM,
        actorKind: 'platform_admin',
        changes: [{ field: 'status', from: 'active', to: 'suspended' }],
      }),
      NOW,
      TZ,
    );
    expect(row.who.tag).toBe('platform');
    const what = sentence(row);
    expect(what.title).toBe(`Ada Admin${tail}`);
    expect(what.parts).toEqual([
      { text: 'Ada Admin', strong: true },
      { text: tail, strong: false },
    ]);
  });
});
