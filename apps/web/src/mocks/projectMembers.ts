import { exactOf, iso, p, projectsSuffix, sentenceIn } from './audit';
import type { AuditRowView, MemberPickerOption, ProjectMemberRowView, RoleCardOption } from './types';

// Project space views for the stories: Members, the Add picker, role cards and the project Audit log (invoicer-api).
const row = (
  userId: string,
  name: string,
  handle: string | null,
  roles: string,
  you = false,
): ProjectMemberRowView => ({
  userId,
  name,
  handle,
  you,
  roles,
});

export const projectMemberRows: ProjectMemberRowView[] = [
  row('user-alice', 'Lee Park', 'lee', 'Admin', true),
  row('user-tenant-4', 'Cleo Martin', 'cleo', 'Member'),
  row('user-tenant-5', 'Dana Wu', 'dana', 'Viewer'),
  row('user-tenant-3', 'Ben Okafor', 'ben', 'Member, Viewer'),
  row('user-tenant-7', 'Noor Haddad', null, 'Viewer'),
  row('user-tenant-8', `Alexandria ${'Montgomery-Featherstonehaugh '.repeat(3)}`.trim(), 'alexandria', 'Member'),
];

export const pagedProjectMemberRows: ProjectMemberRowView[] = [
  row('user-alice', 'Lee Park', 'lee', 'Admin', true),
  ...Array.from({ length: 24 }, (_, i) =>
    row(
      `user-paged-${i + 1}`,
      `Member ${String(i + 1).padStart(2, '0')}`,
      `member${i + 1}`,
      i % 3 === 0 ? 'Viewer' : 'Member',
    ),
  ),
];

export const memberPickerOptions: MemberPickerOption[] = [
  { userId: 'user-candidate-1', name: 'Mira Chen', handle: 'mira' },
  { userId: 'user-candidate-2', name: 'Kim Hale', handle: 'kim' },
  { userId: 'user-candidate-3', name: 'Noor Haddad', handle: null },
  { userId: 'user-candidate-4', name: 'Priya Raman', handle: 'priya' },
  { userId: 'user-candidate-5', name: 'Eli Ford', handle: 'eli' },
];

export const manyPickerOptions: MemberPickerOption[] = Array.from({ length: 200 }, (_, i) => ({
  userId: `user-many-${i + 1}`,
  name: `Person ${String(i + 1).padStart(3, '0')}`,
  handle: i % 17 === 5 ? null : `person${i + 1}`,
}));

const uuid = (n: number) => `b1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const projectRoleCards: RoleCardOption[] = [
  {
    roleId: uuid(2),
    key: 'admin',
    name: 'Admin',
    description: "Manage this project's members, agent, rules, skills and setup.",
  },
  { roleId: uuid(3), key: 'member', name: 'Member', description: 'See runs, start runs and act on their own runs.' },
  { roleId: uuid(4), key: 'viewer', name: 'Viewer', description: 'See this project and its runs.' },
];

const sentence = sentenceIn('b5500000');
const LEE: AuditRowView['who'] = { label: 'Lee Park', tag: null };
const KIM: AuditRowView['who'] = { label: 'Kim Hale', tag: null };
const FIVE = ['billing-jobs', 'docs-site', 'invoicer-api', 'invoicer-web', 'storefront'];
const many = projectsSuffix(FIVE);
const pair = projectsSuffix(['invoicer-api', 'invoicer-web']);
const one = projectsSuffix(['invoicer-api']);

/** The project Audit log of invoicer-api, newest first (times relative to AUDIT_MOCK_NOW). */
export const projectAuditRows: AuditRowView[] = [
  sentence(
    3,
    '3 min ago',
    [p('Lee Park', true), p(' added '), p('Mira Chen', true), p(' to this project as Member')],
    LEE,
  ),
  sentence(
    25,
    '25 min ago',
    [p('Lee Park', true), p(' changed '), p('Cleo Martin', true), p("'s project role from Member to Admin")],
    LEE,
  ),
  sentence(
    70,
    '1 hour ago',
    [p('Lee Park', true), p(' removed '), p('Dana Wu', true), p(' from this project (was Viewer)')],
    LEE,
  ),
  sentence(
    150,
    '2 hours ago',
    [p('Kim Hale', true), p(' invited '), p('sam.reyes@contractor.io', true), p(' as Viewer'), ...pair.parts],
    KIM,
  ),
  sentence(
    240,
    '4 hours ago',
    [p('Kim Hale', true), p(' invited '), p('wide.access@contractor.io', true), p(' as Member'), ...many.parts],
    KIM,
    `Kim Hale invited wide.access@contractor.io as Member${many.full}`,
  ),
  {
    id: 'b5500000-0000-4000-8000-000000000900',
    when: { label: '15 hours ago', exact: exactOf(iso(900)), iso: iso(900) },
    who: KIM,
    what: { kind: 'raw', key: 'PUT desk.agent.put', target: null },
  },
  sentence(
    1200,
    'yesterday',
    [p('Someone', true), p(' changed '), p('Cleo Martin', true), p("'s project role from Viewer to Member")],
    { label: 'Deleted user', tag: 'deleted' },
  ),
];

/** Invitation entries for a viewer who does not administer every listed project: no email, visible projects only. */
export const projectAuditRowsNoEmail: AuditRowView[] = [
  sentence(
    300,
    '5 hours ago',
    [p('Kim Hale', true), p(' invited '), p('someone', true), p(' as Viewer'), ...one.parts],
    KIM,
  ),
  sentence(360, '6 hours ago', [p('Kim Hale', true), p(' resent an invitation'), ...one.parts], KIM),
];

/** Expired invitations: the writer's actor, with and without the email. */
export const projectAuditRowsExpired: AuditRowView[] = [
  sentence(
    420,
    '7 hours ago',
    [p('The invitation for '), p('sam.reyes@contractor.io', true), ...one.parts, p(' expired')],
    KIM,
  ),
  sentence(600, '10 hours ago', [p('An invitation'), ...one.parts, p(' expired')], KIM),
];
