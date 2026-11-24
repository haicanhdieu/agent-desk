import { queryOptions } from '@tanstack/react-query';
import { holdsAnywhere, type Access, type AccessDto, type PlatformSessionDto } from '@agentdesk/contracts';
import { api } from '../api';
import { accessKeys } from './keys';

/** The signed-in user's grants across orgs, keyed outside `['org', slug]` like the session. */
export const sessionAccessQuery = queryOptions({
  queryKey: accessKeys.session(),
  queryFn: (): Promise<AccessDto> => api.me.access(),
});

/** Whether the signed-in user is a platform admin (`GET /api/me/platform`); it works with no org or a suspended one. */
export const platformAdminQuery = queryOptions({
  queryKey: accessKeys.platform(),
  queryFn: (): Promise<PlatformSessionDto> => api.me.platform(),
});

/** The user's grants in one org (the request is pinned to the org in the URL). */
export const orgAccessQuery = (org: string) =>
  queryOptions({
    queryKey: accessKeys.org(org),
    queryFn: (): Promise<AccessDto> => api.me.access(),
  });

/** DTO to the grant shape `can()` reads. The DTO has no role id; the role key stands in (neither helper reads it). */
export function toAccess(dto: AccessDto): Access {
  return {
    userId: dto.userId,
    grants: dto.assignments.map((a) => ({
      roleId: a.roleKey,
      roleKey: a.roleKey,
      scope: a.scope,
      lines: a.permissions,
    })),
  };
}

/** Whether the invite controls show: invite rights at the org or on some project. */
export function canInvite(access: Access): boolean {
  return holdsAnywhere(access, 'assignment:create');
}
