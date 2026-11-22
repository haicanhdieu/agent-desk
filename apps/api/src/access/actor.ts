import type { Access } from '@agentdesk/contracts';

/** Who acts on a request: a tenant member with role grants, or a platform admin (a `platform_admins` entry matching the verified session email, no grants). */
export type Actor = { kind: 'member'; access: Access } | { kind: 'platform_admin'; userId: string };

export function actorUserId(actor: Actor): string {
  return actor.kind === 'member' ? actor.access.userId : actor.userId;
}
