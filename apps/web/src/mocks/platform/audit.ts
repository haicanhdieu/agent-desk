// Platform audit log rows for the stories: every platform action, newest first. Dates are fixed UTC times, as in the
// approved PlatformAudit boards, so the labels never drift.
import { exactOf, p } from '../audit';
import type { AuditRowView } from '../types';

type Parts = ReturnType<typeof p>[];

const WHO = 'Morgan Avery';
const PRIYA = 'Priya Natarajan';
const LONG_ORG = 'Riverside Municipal Water and Power Utilities Digital Services';

let seq = 0;
const entry = (at: string, label: string, who: string | null, parts: Parts, note?: string): AuditRowView => {
  const iso = new Date(`${at}:00Z`).toISOString();
  return {
    id: `b5500000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    when: { label, exact: exactOf(iso), iso },
    who: who === null ? { label: 'Deleted user', tag: 'deleted' } : { label: who, tag: null },
    what: { kind: 'sentence', parts, title: parts.map((x) => x.text).join('') },
    ...(note === undefined ? {} : { note }),
  };
};
const by = (who: string | null) => p(who ?? 'Deleted user', true);

/** The eleven `PlatformAuditAction` labels for the Action select; the value is the action key. */
export const platformAuditActions: { value: string; label: string }[] = [
  { value: 'platform_admin.granted', label: 'Platform admin added' },
  { value: 'platform_admin.revoked', label: 'Platform admin revoked' },
  { value: 'org.created', label: 'Organization created' },
  { value: 'org.updated', label: 'Organization updated' },
  { value: 'org.suspended', label: 'Organization suspended' },
  { value: 'org.reactivated', label: 'Organization reactivated' },
  { value: 'assignment.granted', label: 'Assignment added' },
  { value: 'assignment.revoked', label: 'Assignment removed' },
  { value: 'invitation.created', label: 'Invitation created' },
  { value: 'invitation.resent', label: 'Invitation resent' },
  { value: 'invitation.revoked', label: 'Invitation revoked' },
];

export const platformAuditRows: AuditRowView[] = [
  entry('2026-11-22T10:58', '2 min ago', WHO, [by(WHO), p(' created '), p('Acme Rockets', true)]),
  entry(
    '2026-11-21T16:40',
    'yesterday',
    WHO,
    [by(WHO), p(' suspended '), p('Bluefin Health', true)],
    'Reason: Contract ended on 20 Nov; the customer asked us to pause access.',
  ),
  entry('2026-11-21T09:15', 'yesterday', PRIYA, [
    by(PRIYA),
    p(' revoked the invitation for '),
    p('tom.reed@bluefin.example', true),
    p(' to '),
    p('Bluefin Health', true),
  ]),
  entry('2026-11-20T14:02', '2 days ago', WHO, [
    by(WHO),
    p(' added '),
    p('priya.natarajan@agentdesk.example', true),
    p(' as a platform admin'),
  ]),
  entry(
    '2026-11-19T11:30',
    '19 Nov',
    PRIYA,
    [by(PRIYA), p(' reactivated '), p(LONG_ORG, true)],
    'Reason: Owner confirmed the new billing contact.',
  ),
  entry(
    '2026-11-18T17:05',
    '18 Nov',
    PRIYA,
    [by(PRIYA), p(' suspended '), p(LONG_ORG, true)],
    'Reason: Billing contact unreachable for 30 days.',
  ),
  entry('2026-11-18T10:12', '18 Nov', WHO, [
    by(WHO),
    p(' gave '),
    p('Ruth Okafor', true),
    p(' the Owner role in '),
    p('Bluefin Health', true),
  ]),
  entry('2026-11-18T10:05', '18 Nov', WHO, [
    by(WHO),
    p(' invited '),
    p('ruth.okafor@bluefin.example', true),
    p(' to '),
    p('Bluefin Health', true),
    p(' as Owner'),
  ]),
  entry('2026-11-18T10:01', '18 Nov', WHO, [
    by(WHO),
    p(' changed the name of '),
    p('Bluefin Health', true),
    p(' from Bluefin to Bluefin Health and the URL from /o/bluefin to /o/bluefin-health'),
  ]),
  entry('2026-11-18T09:58', '18 Nov', WHO, [by(WHO), p(' created '), p('Bluefin Health', true)]),
  entry('2026-11-15T13:20', '15 Nov', null, [
    by(null),
    p(' revoked platform access for '),
    p('sam.lee@agentdesk.example', true),
  ]),
];

const lastPage: AuditRowView[] = [
  entry('2026-11-14T10:20', '14 Nov', WHO, [
    by(WHO),
    p(' added '),
    p('omar.haddad@agentdesk.example', true),
    p(' as a platform admin'),
  ]),
  entry('2026-11-10T09:41', '10 Nov', WHO, [
    by(WHO),
    p(' invited '),
    p('kim.hale@harborlabs.dev', true),
    p(' to '),
    p('Harbor Labs', true),
    p(' as Owner'),
  ]),
  entry('2026-11-10T09:40', '10 Nov', WHO, [
    by(WHO),
    p(' resent the invitation for '),
    p('maria.chen@northwind.example', true),
    p(' to '),
    p('Northwind Analytics', true),
  ]),
  entry('2026-11-09T11:12', '9 Nov', WHO, [by(WHO), p(' created '), p(LONG_ORG, true)]),
  entry('2026-11-06T15:02', '6 Nov', WHO, [
    by(WHO),
    p(' removed '),
    p('Lee Park', true),
    p("'s Admin role on "),
    p('docs-site', true),
    p(' in '),
    p('Harbor Labs', true),
  ]),
];

/** 25 entries, newest first: 20 for page 1, then the five of page 2 shown in the approved PlatformAuditPaged board. */
export const pagedPlatformAuditRows: AuditRowView[] = [
  ...Array.from({ length: 20 }, (_, i) =>
    entry(
      `2026-11-${String(22 - Math.floor(i / 4)).padStart(2, '0')}T${String(18 - (i % 4) * 2).padStart(2, '0')}:00`,
      `${22 - Math.floor(i / 4)} Nov`,
      WHO,
      [by(WHO), p(' created '), p(`Organization ${String(20 - i).padStart(2, '0')}`, true)],
    ),
  ),
  ...lastPage,
];
