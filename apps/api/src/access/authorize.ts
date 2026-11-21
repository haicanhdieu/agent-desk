import { can, holdsAnywhere, type Access, type RouteAccess } from '@agentdesk/contracts';

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
