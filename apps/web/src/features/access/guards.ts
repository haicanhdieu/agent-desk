import { useQuery, type QueryClient } from '@tanstack/react-query';
import { can, type Access, type AccessTarget, type Permission } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { canInvite, orgAccessQuery, toAccess } from './queries';

// Route and screen guards over the session's grants. They only decide what the UI shows: the API is the authority
// (ADR-0036). Every guard fails closed: grants that are loading, missing or failed to load mean "not allowed".

const forbidden = (): ApiError =>
  new ApiError({ status: 403, type: 'forbidden', title: 'Forbidden', detail: 'Not allowed for your role here' });

/** The grants in `org`; any failure but a lost session is a refusal (the route shows Forbidden, nothing loads). */
async function grantsOf(queryClient: QueryClient, org: string): Promise<Access> {
  try {
    return toAccess(await queryClient.ensureQueryData(orgAccessQuery(org)));
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw e;
    throw forbidden();
  }
}

/**
 * For a route's `beforeLoad`: throws a 403 (the Forbidden page) unless the caller holds `permission`, at org scope or,
 * for a project-level permission, on `target.projectId`. It runs before any loader, so a refused route fetches nothing.
 */
export async function requirePermission(
  queryClient: QueryClient,
  org: string,
  permission: Permission,
  target: AccessTarget = {},
): Promise<void> {
  if (!can(await grantsOf(queryClient, org), permission, target)) throw forbidden();
}

/** For a route's `beforeLoad`: throws a 403 unless the caller may invite (invite rights at the org or on a project). */
export async function requireInvite(queryClient: QueryClient, org: string): Promise<void> {
  if (!canInvite(await grantsOf(queryClient, org))) throw forbidden();
}

/** The grants in `org`, or undefined while they load or when they failed to load (callers then deny). */
export function useAccess(org: string): Access | undefined {
  const { data } = useQuery(orgAccessQuery(org));
  return data === undefined ? undefined : toAccess(data);
}

/** Whether the caller holds `permission` for `target`; false while the grants load or when they failed. */
export function useCan(org: string, permission: Permission, target: AccessTarget = {}): boolean {
  const access = useAccess(org);
  return access !== undefined && can(access, permission, target);
}
