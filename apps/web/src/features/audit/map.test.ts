import { describe, expect, it } from 'vitest';
import type { AuditEntryDto } from '@agentdesk/contracts';
import { projectsPhrase, toAuditRow } from './map';

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
  projects: [],
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

const proj = (name: string, n = 1) => ({ id: `b6000000-0000-4000-8000-${String(n).padStart(12, '0')}`, name });
const named = (...names: string[]) => names.map((name, i) => proj(name, i + 1));
const text = (row: ReturnType<typeof toAuditRow>) =>
  sentence(row)
    .parts.map((p) => p.text)
    .join('');
const EMAIL = 'sam@example.test';

describe('projectsPhrase (BR-27)', () => {
  it('is null without projects', () => {
    expect(projectsPhrase([])).toBeNull();
  });
  it.each([
    [['a'], 'a'],
    [['a', 'b'], 'a, b'],
    [['a', 'b', 'c'], 'a, b, c'],
    [['a', 'b', 'c', 'd'], 'a, b, c and 1 more'],
    [['a', 'b', 'c', 'd', 'e'], 'a, b, c and 2 more'],
  ])('%j reads %s and the title lists every name', (names, shown) => {
    expect(projectsPhrase(names.map((name) => ({ name })))).toEqual({ text: shown, title: names.join(', ') });
  });
});

describe('toAuditRow: invitation sentences name their projects (BR-27)', () => {
  const cases = (label: string | null, projects: ReturnType<typeof named>) => ({
    created: entry({
      action: 'invitation.created',
      target: invitation(label),
      changes: [change('role', null, 'Viewer')],
      projects,
    }),
    resent: entry({ action: 'invitation.resent', target: invitation(label), projects }),
    revoked: entry({ action: 'invitation.revoked', target: invitation(label), projects }),
    accepted: entry({
      action: 'invitation.accepted',
      target: invitation(label),
      changes: [change('role', null, 'Member')],
      projects,
    }),
    declined: entry({ action: 'invitation.declined', target: invitation(label), projects }),
    expired: entry({ action: 'invitation.expired', target: invitation(label), projects }),
  });

  it.each([
    ['one', ['api'], 'api'],
    ['two', ['api', 'web'], 'api, web'],
    ['five', ['a', 'b', 'c', 'd', 'e'], 'a, b, c and 2 more'],
  ])('with the email and %s projects', (_n, names, shown) => {
    const c = cases(EMAIL, named(...names));
    expect(text(toAuditRow(c.created, NOW, TZ))).toBe(`Alice Doe invited ${EMAIL} as Viewer to ${shown}`);
    expect(text(toAuditRow(c.resent, NOW, TZ))).toBe(`Alice Doe resent the invitation for ${EMAIL} to ${shown}`);
    expect(text(toAuditRow(c.revoked, NOW, TZ))).toBe(`Alice Doe revoked the invitation for ${EMAIL} to ${shown}`);
    expect(text(toAuditRow(c.accepted, NOW, TZ))).toBe(`Alice Doe accepted an invitation as Member to ${shown}`);
    expect(text(toAuditRow(c.declined, NOW, TZ))).toBe(`Alice Doe declined an invitation to ${shown}`);
    expect(text(toAuditRow(c.expired, NOW, TZ))).toBe(`The invitation for ${EMAIL} to ${shown} expired`);
  });

  it('without the email', () => {
    const c = cases(null, named('api', 'web'));
    expect(text(toAuditRow(c.created, NOW, TZ))).toBe('Alice Doe invited someone as Viewer to api, web');
    expect(text(toAuditRow(c.resent, NOW, TZ))).toBe('Alice Doe resent an invitation to api, web');
    expect(text(toAuditRow(c.revoked, NOW, TZ))).toBe('Alice Doe revoked an invitation to api, web');
    expect(text(toAuditRow(c.expired, NOW, TZ))).toBe('An invitation to api, web expired');
  });

  it("an org-scope invitation keeps today's sentences with no ' to ...'", () => {
    const c = cases(EMAIL, []);
    expect(text(toAuditRow(c.created, NOW, TZ))).toBe(`Alice Doe invited ${EMAIL} as Viewer`);
    expect(text(toAuditRow(c.accepted, NOW, TZ))).toBe('Alice Doe accepted an invitation as Member');
    expect(text(toAuditRow(c.declined, NOW, TZ))).toBe('Alice Doe declined an invitation');
  });

  it('Review Focus 5: a project invitation whose projects are all gone renders without " to ..."', () => {
    expect(text(toAuditRow(cases(EMAIL, []).resent, NOW, TZ))).toBe(`Alice Doe resent the invitation for ${EMAIL}`);
  });

  it('expired without projects states the fact only', () => {
    expect(text(toAuditRow(cases(EMAIL, []).expired, NOW, TZ))).toBe(`The invitation for ${EMAIL} expired`);
    expect(text(toAuditRow(cases(null, []).expired, NOW, TZ))).toBe('An invitation expired');
  });

  it('the title of an "and N more" row lists every visible name', () => {
    const row = toAuditRow(cases(EMAIL, named('a', 'b', 'c', 'd', 'e')).created, NOW, TZ);
    expect(sentence(row).title).toBe(`Alice Doe invited ${EMAIL} as Viewer to a, b, c, d, e`);
  });

  it('the title keeps replacement patterns in project names literal', () => {
    const names = ['Q$&A', 'b$$', "c$'", 'd', 'e'];
    const row = toAuditRow(cases(EMAIL, named(...names)).created, NOW, TZ);
    expect(sentence(row).title).toBe(`Alice Doe invited ${EMAIL} as Viewer to ${names.join(', ')}`);
  });

  it('project names with markup stay text parts', () => {
    const row = toAuditRow(cases(EMAIL, named('<b>x</b>')).declined, NOW, TZ);
    expect(sentence(row).parts.at(-1)).toEqual({ text: '<b>x</b>', strong: true });
  });
});

describe('toAuditRow: project scope sentences', () => {
  const granted = entry({
    action: 'assignment.granted',
    target: user('Mira Chen'),
    changes: [change('role', null, 'Member')],
  });
  it('project scope: assignment.granted with a role reads "added ... to this project as ..."', () => {
    expect(text(toAuditRow(granted, NOW, TZ, 'project'))).toBe('Alice Doe added Mira Chen to this project as Member');
  });
  it('project scope: assignment.granted without a role change shows the raw key', () => {
    const dto = entry({ action: 'assignment.granted', target: user('Mira Chen') });
    expect(toAuditRow(dto, NOW, TZ, 'project').what).toEqual({
      kind: 'raw',
      key: 'assignment.granted',
      target: 'Mira Chen',
    });
  });
  it('org scope: assignment.granted stays the raw key', () => {
    expect(toAuditRow(granted, NOW, TZ).what).toEqual({ kind: 'raw', key: 'assignment.granted', target: 'Mira Chen' });
  });
  it('project_member.role_changed', () => {
    const dto = entry({
      action: 'project_member.role_changed',
      target: user('Cleo Martin'),
      changes: [change('role', 'Member', 'Admin')],
    });
    expect(text(toAuditRow(dto, NOW, TZ, 'project'))).toBe(
      "Alice Doe changed Cleo Martin's project role from Member to Admin",
    );
  });
  it('project_member.removed', () => {
    const dto = entry({
      action: 'project_member.removed',
      target: user('Dana Wu'),
      changes: [change('role', 'Viewer', null)],
    });
    expect(text(toAuditRow(dto, NOW, TZ, 'project'))).toBe('Alice Doe removed Dana Wu from this project (was Viewer)');
  });
});
