// Organization detail views for the stories: what the platform org Overview shows.
import type { OrgStatusView } from './orgs';

export interface PlatformOrgOverviewView {
  facts: {
    slug: string;
    owner: string | null;
    members: number;
    projects: number;
    lastActivity: string | null;
    created: string;
    status: OrgStatusView;
  };
  suspension: { since: string; by: string | null; reason: string } | null;
}

export const activeOrgOverview: PlatformOrgOverviewView = {
  facts: {
    slug: 'acme',
    owner: 'Dana Whitfield',
    members: 12,
    projects: 4,
    lastActivity: '2 hours ago',
    created: '3 Mar 2026',
    status: 'active',
  },
  suspension: null,
};

export const suspendedOrgOverview: PlatformOrgOverviewView = {
  facts: { ...activeOrgOverview.facts, status: 'suspended' },
  suspension: { since: '21 Nov 2026', by: 'Sam Rivera', reason: 'Billing hold' },
};
