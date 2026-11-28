/** Which side menu a page shows. */
export type MenuScope = 'org' | 'project' | 'platform' | 'platformOrg' | 'personal';

/** The menu item a page marks as current. Set per route, never matched from the address or search params. */
export type MenuItemKey =
  | 'projects'
  | 'members'
  | 'invitations'
  | 'audit'
  | 'general'
  | 'runs'
  | 'rules'
  | 'skills'
  | 'setup'
  | 'agent'
  | 'projectMembers'
  | 'projectAudit'
  | 'platformOrgs'
  | 'platformAdmins'
  | 'platformAudit'
  | 'orgOverview'
  | 'orgProjects'
  | 'orgMembers'
  | 'orgInvitations';

/** What a route declares about the shell around it (its `staticData.chrome`). */
export interface RouteChrome {
  mode: 'standard' | 'wizard' | 'none';
  scope?: MenuScope;
  item?: MenuItemKey;
  /** The item is the page's parent (run detail), not the page itself. */
  parent?: boolean;
  crumb?: string;
  fill?: boolean;
  startCollapsed?: boolean;
}

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    chrome?: RouteChrome;
  }
}
