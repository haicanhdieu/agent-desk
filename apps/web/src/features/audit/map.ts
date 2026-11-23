import type { AuditEntryDto } from '@agentdesk/contracts';
import { formatFullDate } from '@/features/invitations/dates';
import { relativeTime } from '@/features/relativeTime';
import type { AuditRowView, AuditTextPart } from '@/mocks/types';

const plain = (text: string): AuditTextPart => ({ text, strong: false });
const strong = (text: string): AuditTextPart => ({ text, strong: true });
const NO_ROLE = 'No role';

type Change = AuditEntryDto['changes'][number];
const changeOf = (dto: AuditEntryDto, field: Change['field']) => dto.changes.find((c) => c.field === field);

const SHOWN_PROJECTS = 3;

/** The visible project names of an invitation sentence: at most 3, then "and N more"; `title` keeps every name. */
export function projectsPhrase(projects: { name: string }[]): { text: string; title: string } | null {
  if (projects.length === 0) return null;
  const names = projects.map((p) => p.name);
  const text =
    names.length > SHOWN_PROJECTS
      ? `${names.slice(0, SHOWN_PROJECTS).join(', ')} and ${names.length - SHOWN_PROJECTS} more`
      : names.join(', ');
  return { text, title: names.join(', ') };
}

const projectsTail = (dto: AuditEntryDto): AuditTextPart[] => {
  const phrase = projectsPhrase(dto.projects);
  return phrase ? [plain(' to '), strong(phrase.text)] : [];
};

/** The whole sentence of an expired invitation: the Who column carries the actor, so no actor leads it. */
function expiredParts(dto: AuditEntryDto): AuditTextPart[] {
  const label = dto.target.label;
  return [
    plain(label === null ? 'An invitation' : 'The invitation for '),
    ...(label === null ? [] : [strong(label)]),
    ...projectsTail(dto),
    plain(' expired'),
  ];
}

/** The words after the actor for a known action, or null when the entry shows as its raw key. Text only, never HTML. */
function tail(dto: AuditEntryDto, scope: 'org' | 'project'): AuditTextPart[] | null {
  const label = dto.target.label;
  const role = changeOf(dto, 'role');
  switch (dto.action) {
    case 'member.role_changed':
      // No role change in the DTO: show the raw key rather than state a change that was never recorded.
      if (!role) return null;
      return [
        plain(' changed '),
        strong(label ?? 'a member'),
        plain(`'s role from ${role?.from ?? NO_ROLE} to ${role?.to ?? NO_ROLE}`),
      ];
    case 'assignment.granted':
      // Only the project log words a grant; the org log keeps the raw key.
      if (scope !== 'project' || !role?.to) return null;
      return [plain(' added '), strong(label ?? 'a member'), plain(` to this project as ${role.to}`)];
    case 'project_member.role_changed':
      if (!role) return null;
      return [
        plain(' changed '),
        strong(label ?? 'a member'),
        plain(`'s project role from ${role.from ?? NO_ROLE} to ${role.to ?? NO_ROLE}`),
      ];
    case 'project_member.removed':
      return [
        plain(' removed '),
        strong(label ?? 'a member'),
        plain(` from this project${role?.from ? ` (was ${role.from})` : ''}`),
      ];
    case 'member.removed':
      return [
        plain(' removed '),
        strong(label ?? 'a member'),
        plain(` from the organization${role?.from ? ` (was ${role.from})` : ''}`),
      ];
    case 'org.updated': {
      const changes = [
        { field: 'name' as const, what: 'name', show: (v: string) => v },
        { field: 'slug' as const, what: 'URL', show: (v: string) => `/o/${v}` },
      ].flatMap(({ field, what, show }) => {
        const c = changeOf(dto, field);
        if (!c || c.from === null || c.to === null) return [];
        return [{ what, from: show(c.from), to: show(c.to) }];
      });
      // One entry can hold both: "changed the organization name from A to B and the URL from /o/a to /o/b".
      const clauses = changes.map(({ what, from, to }, n) => [
        plain(n === 0 ? ` changed the organization ${what} from ` : ` and the ${what} from `),
        strong(from),
        plain(' to '),
        strong(to),
      ]);
      return clauses.length > 0 ? clauses.flat() : null;
    }
    // Platform admin actions on the org itself: the reason lives in the platform detail, never in this log.
    case 'org.suspended':
      return [plain(' suspended the organization')];
    case 'org.reactivated':
      return [plain(' reactivated the organization')];
    // The invitee's email arrives as the label of invitation entries, and only of these.
    case 'invitation.created':
      return [
        plain(' invited '),
        strong(label ?? 'someone'),
        ...(role?.to ? [plain(` as ${role.to}`)] : []),
        ...projectsTail(dto),
      ];
    case 'invitation.resent':
      return [
        ...(label === null ? [plain(' resent an invitation')] : [plain(' resent the invitation for '), strong(label)]),
        ...projectsTail(dto),
      ];
    case 'invitation.revoked':
      return [
        ...(label === null
          ? [plain(' revoked an invitation')]
          : [plain(' revoked the invitation for '), strong(label)]),
        ...projectsTail(dto),
      ];
    case 'invitation.accepted':
      return [plain(` accepted an invitation${role?.to ? ` as ${role.to}` : ''}`), ...projectsTail(dto)];
    case 'invitation.declined':
      return [plain(' declined an invitation'), ...projectsTail(dto)];
    default:
      return null;
  }
}

/** The cell title: the sentence with the full visible project list where the shown one says "and N more". */
function titleOf(dto: AuditEntryDto, parts: AuditTextPart[]): string {
  const phrase = projectsPhrase(dto.projects);
  const sentence = parts.map((p) => p.text).join('');
  return phrase && phrase.text !== phrase.title ? sentence.replace(phrase.text, () => phrase.title) : sentence;
}

/** One Audit table row. `now` drives the relative time; `timeZone` is optional so tests can pin it. */
export function toAuditRow(
  dto: AuditEntryDto,
  now: Date,
  timeZone?: string,
  scope: 'org' | 'project' = 'org',
): AuditRowView {
  const when = { label: relativeTime(dto.at, now), exact: formatFullDate(dto.at, timeZone), iso: dto.at };
  const who: AuditRowView['who'] = {
    label: dto.actor?.name ?? 'Deleted user',
    tag: dto.actor === null ? 'deleted' : dto.actorKind === 'platform_admin' ? 'platform' : null,
  };
  if (dto.action === 'invitation.expired') {
    const parts = expiredParts(dto);
    return { id: dto.id, when, who, what: { kind: 'sentence', parts, title: titleOf(dto, parts) } };
  }
  const rest = tail(dto, scope);
  if (rest === null) {
    // Another entry's label never appears here, and an invitee email only in the sentences above.
    const target = dto.target.type === 'invitation' ? null : dto.target.label;
    return { id: dto.id, when, who, what: { kind: 'raw', key: dto.action, target } };
  }
  const parts = [strong(dto.actor?.name ?? 'Someone'), ...rest];
  return { id: dto.id, when, who, what: { kind: 'sentence', parts, title: titleOf(dto, parts) } };
}
