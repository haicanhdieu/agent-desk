import type { AuditEntryDto } from '@agentdesk/contracts';
import { formatFullDate } from '@/features/invitations/dates';
import { relativeTime } from '@/features/relativeTime';
import type { AuditRowView, AuditTextPart } from '@/mocks/types';

const plain = (text: string): AuditTextPart => ({ text, strong: false });
const strong = (text: string): AuditTextPart => ({ text, strong: true });
const NO_ROLE = 'No role';

type Change = AuditEntryDto['changes'][number];
const changeOf = (dto: AuditEntryDto, field: Change['field']) => dto.changes.find((c) => c.field === field);

/** The words after the actor for a known action, or null when the entry shows as its raw key. Text only, never HTML. */
function tail(dto: AuditEntryDto): AuditTextPart[] | null {
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
      return [plain(' invited '), strong(label ?? 'someone'), ...(role?.to ? [plain(` as ${role.to}`)] : [])];
    case 'invitation.resent':
      return label === null ? [plain(' resent an invitation')] : [plain(' resent the invitation for '), strong(label)];
    case 'invitation.revoked':
      return label === null
        ? [plain(' revoked an invitation')]
        : [plain(' revoked the invitation for '), strong(label)];
    case 'invitation.accepted':
      return [plain(` accepted an invitation${role?.to ? ` as ${role.to}` : ''}`)];
    case 'invitation.declined':
      return [plain(' declined an invitation')];
    default:
      return null;
  }
}

/** One Audit table row. `now` drives the relative time; `timeZone` is optional so tests can pin it. */
export function toAuditRow(dto: AuditEntryDto, now: Date, timeZone?: string): AuditRowView {
  const when = { label: relativeTime(dto.at, now), exact: formatFullDate(dto.at, timeZone), iso: dto.at };
  const who: AuditRowView['who'] = {
    label: dto.actor?.name ?? 'Deleted user',
    tag: dto.actor === null ? 'deleted' : dto.actorKind === 'platform_admin' ? 'platform' : null,
  };
  const rest = tail(dto);
  if (rest === null) {
    // Another entry's label never appears here, and an invitee email only in the sentences above.
    const target = dto.target.type === 'invitation' ? null : dto.target.label;
    return { id: dto.id, when, who, what: { kind: 'raw', key: dto.action, target } };
  }
  const parts = [strong(dto.actor?.name ?? 'Someone'), ...rest];
  return { id: dto.id, when, who, what: { kind: 'sentence', parts, title: parts.map((p) => p.text).join('') } };
}
