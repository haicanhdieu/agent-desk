import type { PlatformAdminDto, PlatformOrgDto } from '@agentdesk/contracts';
import type { PlatformAdminRowView, PlatformOrgRowView } from '@/mocks';
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
