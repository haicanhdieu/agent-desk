import type { PageCrumb, PageState } from '@/components/pageTitle';

export type PlatformOrgCrumb =
  | { state: 'none' }
  | { state: 'loading' }
  | { state: 'notFound' }
  | { state: 'ready'; id: string; name: string }
  | { state: 'error'; id: string };

const ORG_SECTION: Record<string, string> = {
  projects: 'Projects',
  members: 'Members',
  invitations: 'Invitations',
};

const ORGS_CRUMB: PageCrumb = { label: 'Organizations', href: '/platform/orgs' };

/** The top bar's page crumbs, tab and fixed state for a platform page, from its path and the org it shows. */
export function platformCrumbs(
  pathname: string,
  org: PlatformOrgCrumb,
): { crumbs: PageCrumb[]; state?: PageState; tab: 'orgs' | 'admins' | 'audit' } {
  const parts = pathname.split('/').filter(Boolean).slice(1); // after "platform"
  if (parts[0] === 'admins') return { crumbs: [{ label: 'Platform admins' }], tab: 'admins' };
  if (parts[0] === 'audit') return { crumbs: [{ label: 'Audit log' }], tab: 'audit' };
  if (parts[0] !== 'orgs' || parts.length === 1) return { crumbs: [{ label: 'Organizations' }], tab: 'orgs' };
  if (parts[1] === 'new') return { crumbs: [ORGS_CRUMB, { label: 'Create organization' }], tab: 'orgs' };
  if (org.state === 'notFound') {
    return { crumbs: [ORGS_CRUMB, { label: 'Not found' }], state: 'notFound', tab: 'orgs' };
  }
  const section = parts[2] === undefined ? undefined : (ORG_SECTION[parts[2]] ?? parts[2]);
  const base = `/platform/orgs/${encodeURIComponent(parts[1] ?? '')}`;
  const name: PageCrumb =
    org.state === 'loading'
      ? { label: '', loading: true, what: 'organization' }
      : org.state === 'ready'
        ? { label: org.name }
        : { label: 'Organization' };
  const crumbs: PageCrumb[] = [ORGS_CRUMB, section ? { ...name, href: name.loading ? undefined : base } : name];
  if (section) crumbs.push({ label: section });
  return { crumbs, tab: 'orgs' };
}
