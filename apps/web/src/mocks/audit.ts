import { AUDIT_MOCK_NOW } from './dto/audit';
import type { AuditRowView } from './types';

// Audit rows for the stories, newest first. Times are relative to dto/audit.ts AUDIT_MOCK_NOW (22 Nov 2026, 11:00 UTC).
const p = (text: string, strong = false) => ({ text, strong });
const NOW = Date.parse(AUDIT_MOCK_NOW);
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');
/** The exact time shown in the time title, derived from `iso` (UTC) so the two never drift. */
const exactOf = (isoTime: string) => {
  const d = new Date(isoTime);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
};

let seq = 0;
const sentence = (
  minutesAgo: number,
  label: string,
  parts: ReturnType<typeof p>[],
  who: AuditRowView['who'] = { label: 'Alice Doe', tag: null },
): AuditRowView => ({
  id: `b5100000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  when: { label, exact: exactOf(iso(minutesAgo)), iso: iso(minutesAgo) },
  who,
  what: { kind: 'sentence', parts, title: parts.map((x) => x.text).join('') },
});

export const auditRows: AuditRowView[] = [
  sentence(2, '2 min ago', [
    p('Alice Doe', true),
    p(' changed '),
    p('Cleo Martin', true),
    p("'s role from Admin to Member"),
  ]),
  sentence(30, '30 min ago', [
    p('Alice Doe', true),
    p(' changed '),
    p('Ben Okafor', true),
    p("'s role from Admin to Owner"),
  ]),
  sentence(60, '1 hour ago', [
    p('Alice Doe', true),
    p(' changed the organization URL from '),
    p('/o/harbor', true),
    p(' to '),
    p('/o/harbor-labs', true),
  ]),
  sentence(180, '3 hours ago', [
    p('Alice Doe', true),
    p(' changed the organization name from '),
    p('Harbor', true),
    p(' to '),
    p('Harbor Labs', true),
  ]),
  sentence(1500, 'yesterday', [
    p('Alice Doe', true),
    p(' removed '),
    p('Dana Wu', true),
    p(' from the organization (was Member)'),
  ]),
  sentence(14500, '12 Nov', [
    p('Alice Doe', true),
    p(' invited '),
    p('sam.reyes@contractor.io', true),
    p(' as Viewer'),
  ]),
  {
    id: `b5100000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    when: { label: '12 Nov', exact: exactOf(iso(14600)), iso: iso(14600) },
    who: { label: 'Alice Doe', tag: null },
    what: { kind: 'raw', key: 'POST orgs.create', target: null },
  },
  sentence(
    14700,
    '12 Nov',
    [p('Pat Platform', true), p(' changed '), p('Priya Raman', true), p("'s role from No role to Owner")],
    { label: 'Pat Platform', tag: 'platform' },
  ),
  sentence(
    14800,
    '12 Nov',
    [p('Someone', true), p(' changed '), p('Cleo Martin', true), p("'s role from Viewer to Member")],
    { label: 'Deleted user', tag: 'deleted' },
  ),
  sentence(
    14900,
    '12 Nov',
    [
      p('Priya Raman', true),
      p(' invited '),
      p(`<b>${'long-invitee-'.repeat(8)}</b>@example.com`, true),
      p(' as Member'),
    ],
    { label: 'Priya Raman', tag: null },
  ),
];

/** `n` role-change rows, newest first, for the paged stories. */
export function pagedAuditRows(n: number): AuditRowView[] {
  return Array.from({ length: n }, (_, i) => {
    const parts = [p('Alice Doe', true), p(' changed '), p(`Member ${n - i}`, true), p("'s role from Member to Admin")];
    return {
      id: `b5200000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      when: { label: `${i + 1} min ago`, exact: exactOf(iso(i + 1)), iso: iso(i + 1) },
      who: { label: 'Alice Doe', tag: null },
      what: { kind: 'sentence' as const, parts, title: parts.map((x) => x.text).join('') },
    };
  });
}

const entry = (
  day: number,
  hour: number,
  minute: number,
  who: AuditRowView['who'],
  what: AuditRowView['what'],
): AuditRowView => {
  const iso = new Date(Date.UTC(2026, 10, day, hour, minute)).toISOString();
  return {
    id: `b5300000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    when: { label: `${day} Nov`, exact: exactOf(iso), iso },
    who,
    what,
  };
};
const said = (parts: ReturnType<typeof p>[]): AuditRowView['what'] => ({
  kind: 'sentence',
  parts,
  title: parts.map((x) => x.text).join(''),
});

/** The five entries on page 2 of 2 in the approved OrgAuditPaged board (25 in total), newest first. */
export const pagedAuditLastPage: AuditRowView[] = [
  entry(
    12,
    9,
    15,
    { label: 'Kim Hale', tag: null },
    said([p('Kim Hale', true), p(' resent the invitation for '), p('mira.chen@example.com', true)]),
  ),
  entry(
    11,
    18,
    20,
    { label: 'Mira Chen', tag: null },
    said([p('Mira Chen', true), p(' accepted an invitation as Member')]),
  ),
  entry(11, 12, 0, { label: 'ari-k', tag: null }, said([p('ari-k', true), p(' declined an invitation')])),
  entry(10, 10, 2, { label: 'Kim Hale', tag: null }, { kind: 'raw', key: 'PUT desk.agent.put', target: null }),
  entry(
    10,
    9,
    41,
    { label: 'Morgan Avery', tag: 'platform' },
    said([p('Morgan Avery', true), p(' invited '), p('kim.hale@harborlabs.dev', true), p(' as Owner')]),
  ),
];
