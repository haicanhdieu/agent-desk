import { can, holdsAnywhere, inScope, type Access, type Permission, type RouteAccess } from '@agentdesk/contracts';
import type { ResolvedTarget } from './target-resolver';

export type PreTarget = 'allow' | 'forbidden' | 'needs-target';

export const FORBIDDEN_DETAIL = 'Not allowed for your role here';

/**
 * What the guard can decide before any id is looked up (a missing, foreign or malformed id must get the same answer as a
 * valid one, so nothing about a target leaks). `self` allows; `org-admin` needs any listed permission held somewhere;
 * `project-list` needs it held somewhere; `org` needs it held somewhere and granted at org scope; `project` needs it
 * held somewhere and then a target lookup. Platform routes are decided before access loads and never reach this.
 */
export function preTargetDecision(entry: Exclude<RouteAccess, { scope: 'platform' }>, access: Access): PreTarget {
  switch (entry.scope) {
    case 'self':
      return 'allow';
    case 'org-admin':
      return entry.anyOf.some((p) => holdsAnywhere(access, p)) ? 'allow' : 'forbidden';
    case 'project-list':
      return holdsAnywhere(access, entry.permission) ? 'allow' : 'forbidden';
    case 'org':
      return holdsAnywhere(access, entry.permission) && can(access, entry.permission) ? 'allow' : 'forbidden';
    case 'project':
      return holdsAnywhere(access, entry.permission) ? 'needs-target' : 'forbidden';
  }
}

/**
 * The decision once the target is resolved (the caller already holds the permission somewhere). A target that did not
 * resolve, or whose project no grant of the caller covers, is `not-found`: other orgs and out-of-scope projects look
 * the same as missing ones. A visible project where `can` is false (including someone else's run, or an ownerless one,
 * for an `own` line) is `forbidden`.
 */
export function targetDecision(
  entry: { permission: Permission },
  access: Access,
  target: ResolvedTarget | null,
): 'allow' | 'forbidden' | 'not-found' {
  if (target === null || !inScope(access, target.projectId)) return 'not-found';
  return can(access, entry.permission, target) ? 'allow' : 'forbidden';
}
