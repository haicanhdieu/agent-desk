import type { GrantPlatformAdminRequest, Page, PageQuery, PlatformAdminDto } from '@agentdesk/contracts';
import { slicePage } from '@agentdesk/contracts';
import { platformAdminFixtures } from '../dto/access';
import { mockDb } from './db';
import { Problem, notFound, withStatus, type WithStatus } from './http';

let admins: PlatformAdminDto[] = structuredClone(platformAdminFixtures);
mockDb.onReset(() => {
  admins = structuredClone(platformAdminFixtures);
});

/** Replaces the admin list (scenario seeding); a store reset puts the fixtures back. */
export function seedPlatformAdmins(entries: PlatformAdminDto[]): void {
  admins = structuredClone(entries);
}

/** The API's flag: true only on the one verified entry when it is the sole working admin (BR-16). */
export function withLastWorkingAdmin(
  entries: PlatformAdminDto[],
  verifiedEmails: ReadonlySet<string>,
): PlatformAdminDto[] {
  const working = entries.filter((a) => verifiedEmails.has(a.email)).length;
  return entries.map((a) => ({ ...a, lastWorkingAdmin: working === 1 && verifiedEmails.has(a.email) }));
}

/** An entry with an account is a verified one in the mock. */
const flagged = (entries: PlatformAdminDto[]): PlatformAdminDto[] =>
  withLastWorkingAdmin(entries, new Set(entries.filter((a) => a.userId !== null).map((a) => a.email)));

export function listPlatformAdmins(q: PageQuery): Page<PlatformAdminDto> {
  return slicePage(flagged(admins), q);
}

export function grantPlatformAdmin(body: GrantPlatformAdminRequest): WithStatus<PlatformAdminDto> | PlatformAdminDto {
  const existing = admins.find((a) => a.email === body.email);
  const account = mockDb.state.users.find((u) => u.email.toLowerCase() === body.email);
  // A seeded entry with a userId already has an account, even if the mock user list lacks it.
  if (!account && !existing?.userId) {
    throw new Problem({
      status: 404,
      title: 'No account has this email',
      type: 'not-found',
      errors: [{ pointer: '/email', detail: 'No account has this email yet.' }],
    });
  }
  // The API's order: 404 (no account), then 422 (unverified email), then the repeat check.
  if (account && !account.emailVerified) {
    throw new Problem({
      status: 422,
      title: 'Email not verified',
      type: 'validation',
      errors: [{ pointer: '/email', detail: 'The email of this account is not verified.' }],
    });
  }
  if (existing) return withStatus(flagged(admins).find((a) => a.id === existing.id) ?? existing, 200);
  if (!account) throw new Error('unreachable: account checked above');
  const actor = mockDb.currentUser();
  const entry: PlatformAdminDto = {
    id: mockDb.nextId(),
    email: body.email,
    userId: account.id,
    name: account.name,
    handle: account.handle,
    grantedAt: new Date().toISOString(),
    grantedBy: actor ? { name: actor.name, handle: actor.handle } : null,
    lastWorkingAdmin: false,
  };
  admins = [entry, ...admins];
  return flagged(admins).find((a) => a.id === entry.id) ?? entry;
}

export function revokePlatformAdmin(adminId: string): null {
  const target = admins.find((a) => a.id === adminId);
  if (!target) throw notFound('Platform admin');
  if (!admins.some((a) => a.id !== adminId && a.userId !== null)) {
    throw new Problem({
      status: 409,
      title: 'Last working platform admin',
      type: 'conflict',
      detail: 'Grant the role to another account before revoking this one.',
    });
  }
  admins = admins.filter((a) => a.id !== adminId);
  // The flag behind me.platform and me.access follows the row, as the API's does.
  const holder = mockDb.state.users.find((u) => u.email.toLowerCase() === target.email.toLowerCase());
  if (holder) holder.platformAdmin = false;
  return null;
}
