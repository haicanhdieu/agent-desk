import type { OrgSettingsTabKey } from '@/mocks/types';

export interface PageCrumb {
  label: string;
  href?: string;
  loading?: boolean;
  /** "organization", "project": skeleton aria-label "Loading <what>" */
  what?: string;
}
export type PageState = 'notFound' | 'forbidden';

const PRODUCT = 'Agent Desk';

export const NO_PAGE_CRUMBS: readonly PageCrumb[] = [];

export const ORG_SETTINGS_CRUMB: Record<OrgSettingsTabKey, string> = {
  general: 'General',
  members: 'Members',
  invitations: 'Invitations',
  audit: 'Audit log',
};

export const DESK_CRUMB: Record<'skills' | 'rules' | 'setup' | 'agent' | 'members' | 'audit', string> = {
  skills: 'Skills',
  rules: 'Routing rules',
  setup: 'Workspace setup',
  agent: 'Agent & settings',
  members: 'Members',
  audit: 'Audit log',
};

/** The document title: "<page> · <scope> · Agent Desk"; the not-found and forbidden states replace the page. */
export function pageTitle(input: { crumbs: readonly PageCrumb[]; scope?: string; state?: PageState }): string {
  if (input.state === 'notFound') return `Not found · ${PRODUCT}`;
  if (input.state === 'forbidden') return `You don't have access · ${PRODUCT}`;
  const last = input.crumbs[input.crumbs.length - 1];
  const page = last?.loading ? input.crumbs[input.crumbs.length - 2]?.label : last?.label;
  return [page, input.scope, PRODUCT].filter((part): part is string => Boolean(part)).join(' · ');
}
