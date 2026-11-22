import type { GrantPlatformAdminRequest, Page, PageQuery, PlatformAdminDto } from '@agentdesk/contracts';
import { slicePage } from '@agentdesk/contracts';
import { platformAdminFixtures } from '../dto/access';
import { mockDb } from './db';
import { Problem, notFound, withStatus, type WithStatus } from './http';

let admins: PlatformAdminDto[] = structuredClone(platformAdminFixtures);
mockDb.onReset(() => {
  admins = structuredClone(platformAdminFixtures);
});

export function listPlatformAdmins(q: PageQuery): Page<PlatformAdminDto> {
  return slicePage(admins, q);
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
  if (existing) return withStatus(existing, 200);
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
  };
  admins = [entry, ...admins];
  return entry;
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
  return null;
}
