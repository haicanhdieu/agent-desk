import type {
  PlatformAdminDto,
  PlatformAuditAction,
  PlatformAuditEntryDto,
  PlatformOrgDetailDto,
  PlatformOrgDto,
} from '@agentdesk/contracts';
import type { PlatformAdminRowView, PlatformOrgOverviewView, PlatformOrgRowView } from '@/mocks';
import type { AuditRowView, AuditTextPart } from '@/mocks/types';
import { formatFullDate } from '../invitations/dates';
import { relativeTime } from '../relativeTime';

/**
 * One row of the Platform admins table. "You" is the entry whose account is the signed-in user; an entry with no
 * account yet (`userId` null) is a seeded email that has never signed in. `timeZone` is optional so tests can pin it.
 */
export function toPlatformAdminRow(
  dto: PlatformAdminDto,
  sessionUserId: string,
  now: Date,
  timeZone?: string,
): PlatformAdminRowView {
  return {
    id: dto.id,
    email: dto.email,
    name: dto.name,
    handle: dto.handle,
    addedAt: { label: relativeTime(dto.grantedAt, now), title: formatFullDate(dto.grantedAt, timeZone) },
    addedBy: dto.grantedBy?.name ?? null,
    you: dto.userId !== null && dto.userId === sessionUserId,
    neverSignedIn: dto.userId === null,
    lastWorkingAdmin: dto.lastWorkingAdmin,
  };
}

/**
 * One row of the Organizations directory. No owner or no run yet stay null: the row says "No owner yet" and
 * "No activity yet". `timeZone` is optional so tests can pin it.
 */
export function toPlatformOrgRow(dto: PlatformOrgDto, now: Date, timeZone?: string): PlatformOrgRowView {
  return {
    id: dto.id,
    name: dto.name,
    slug: dto.slug,
    href: `/platform/orgs/${dto.id}`,
    owner: dto.owner?.name ?? null,
    members: dto.memberCount,
    projects: dto.projectCount,
    lastActivity:
      dto.lastActivityAt === null
        ? null
        : { label: relativeTime(dto.lastActivityAt, now), title: formatFullDate(dto.lastActivityAt, timeZone) },
    status: dto.status,
    created: { label: relativeTime(dto.createdAt, now), title: formatFullDate(dto.createdAt, timeZone) },
  };
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "21 Nov 2026", in UTC so the same instant reads the same for every admin. */
const utcDay = (iso: string): string => DAY_FORMAT.format(new Date(iso));

/**
 * The Overview facts and, for a suspended org, the warning Banner (since, by whom, reason). No owner, no activity or an
 * actor that is gone stay null: the screen says "No owner yet" and "No activity yet" and shows no name.
 */
export function toPlatformOrgOverview(dto: PlatformOrgDetailDto, now: Date): PlatformOrgOverviewView {
  return {
    facts: {
      slug: dto.slug,
      owner: dto.owner?.name ?? null,
      members: dto.memberCount,
      projects: dto.projectCount,
      lastActivity: dto.lastActivityAt === null ? null : relativeTime(dto.lastActivityAt, now),
      created: utcDay(dto.createdAt),
      status: dto.status,
    },
    suspension:
      dto.suspension === null
        ? null
        : { since: utcDay(dto.suspension.at), by: dto.suspension.by?.name ?? null, reason: dto.suspension.reason },
  };
}

/** The Action select's labels, one per `PlatformAuditAction` (the type makes a missing one a compile error). */
export const PLATFORM_AUDIT_ACTION_LABELS: Record<PlatformAuditAction, string> = {
  'platform_admin.granted': 'Platform admin added',
  'platform_admin.revoked': 'Platform admin revoked',
  'org.created': 'Organization created',
  'org.updated': 'Organization updated',
  'org.suspended': 'Organization suspended',
  'org.reactivated': 'Organization reactivated',
  'assignment.granted': 'Assignment added',
  'assignment.revoked': 'Assignment removed',
  'invitation.created': 'Invitation created',
  'invitation.resent': 'Invitation resent',
  'invitation.revoked': 'Invitation revoked',
};

const plain = (text: string): AuditTextPart => ({ text, strong: false });
const strong = (text: string): AuditTextPart => ({ text, strong: true });
const mono = (text: string): AuditTextPart => ({ text, strong: false, mono: true });
const capitalised = (key: string): string => key.charAt(0).toUpperCase() + key.slice(1);

/** The words after the actor, from the entry's action, target, org and changes. Text only, never HTML. */
function platformAuditTail(dto: PlatformAuditEntryDto): AuditTextPart[] {
  const target = dto.target.label ?? 'someone';
  // A gone org falls back to the name the row targeted (org rows), then a plain phrase.
  const orgName = dto.org?.name ?? (dto.target.type === 'org' ? dto.target.label : null);
  const org = orgName === null ? plain('a deleted organization') : strong(orgName);
  const change = (field: 'role' | 'name' | 'slug') => dto.changes.find((c) => c.field === field);
  const role = change('role');
  switch (dto.action) {
    case 'org.created':
      return [plain(' created '), org];
    case 'org.suspended':
      return [plain(' suspended '), org];
    case 'org.reactivated':
      return [plain(' reactivated '), org];
    case 'org.updated': {
      const name = change('name');
      const slug = change('slug');
      const nameClause = name ? [plain(' from '), plain(name.from ?? ''), plain(' to '), plain(name.to ?? '')] : [];
      const slugClause = slug
        ? [plain(' from '), mono(`/o/${slug.from ?? ''}`), plain(' to '), mono(`/o/${slug.to ?? ''}`)]
        : [];
      if (name && slug)
        return [plain(' changed the name of '), org, ...nameClause, plain(' and the URL'), ...slugClause];
      if (name) return [plain(' changed the name of '), org, ...nameClause];
      if (slug) return [plain(' changed the URL of '), org, ...slugClause];
      return [plain(' updated '), org];
    }
    case 'platform_admin.granted':
      return [plain(' added '), strong(target), plain(' as a platform admin')];
    case 'platform_admin.revoked':
      return [plain(' revoked platform access for '), strong(target)];
    case 'assignment.granted':
      return [plain(' gave '), strong(target), plain(` the ${capitalised(role?.to ?? 'a')} role in `), org];
    case 'assignment.revoked':
      return [plain(' removed '), strong(target), plain(`'s ${capitalised(role?.from ?? 'a')} role in `), org];
    case 'invitation.created':
      return [
        plain(' invited '),
        strong(target),
        plain(' to '),
        org,
        plain(role?.to ? ` as ${capitalised(role.to)}` : ''),
      ];
    case 'invitation.resent':
      return [plain(' resent the invitation for '), strong(target), plain(' to '), org];
    case 'invitation.revoked':
      return [plain(' revoked the invitation for '), strong(target), plain(' to '), org];
  }
}

/**
 * One row of the platform Audit log: the actor leads the sentence (bold, "Deleted user" when gone), the org is bold,
 * edit URLs are mono, and only suspend and reactivate rows carry the reason as a note. `now` drives the relative time.
 */
export function toPlatformAuditRow(dto: PlatformAuditEntryDto, now: Date, timeZone?: string): AuditRowView {
  const actor = dto.actor?.name ?? 'Deleted user';
  const parts = [strong(actor), ...platformAuditTail(dto)].filter((p) => p.text !== '');
  const hasNote = (dto.action === 'org.suspended' || dto.action === 'org.reactivated') && dto.reason !== null;
  return {
    id: dto.id,
    when: { label: relativeTime(dto.at, now), exact: formatFullDate(dto.at, timeZone), iso: dto.at },
    who: { label: actor, tag: dto.actor === null ? 'deleted' : null },
    what: { kind: 'sentence', parts, title: parts.map((p) => p.text).join('') },
    ...(hasNote && { note: `Reason: ${dto.reason}` }),
  };
}
