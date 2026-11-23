import type { PlatformAdminDto } from '@agentdesk/contracts';
import type { PlatformAdminRowView } from '@/mocks';
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
