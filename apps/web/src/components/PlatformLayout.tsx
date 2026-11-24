import type { ReactNode } from 'react';
import { AppLink, Skeleton } from '@/ds';
import chrome from './Chrome.module.css';
import styles from './PlatformLayout.module.css';

export type PlatformOrgGroup =
  | { state: 'loading' }
  | {
      state: 'ready' | 'error';
      name: string;
      links: { overview: string; projects?: string; members?: string; invitations?: string };
    };

export interface PlatformLayoutProps {
  active?: 'overview' | 'projects' | 'members' | 'invitations';
  /** Absent: no side menu (directory, admins, audit, not found, create). */
  org?: PlatformOrgGroup;
  children: ReactNode;
}

function OrgGroup({ org, active }: { org: PlatformOrgGroup; active: PlatformLayoutProps['active'] }) {
  if (org.state === 'loading') {
    return (
      <div data-org-group className={styles.orgGroup}>
        <span role="status" aria-label="Loading organization" className={styles.nameRow}>
          <Skeleton variant="block" width="70%" height={16} />
        </span>
        <span role="status" aria-label="Loading organization" className={styles.itemsRow}>
          <Skeleton variant="block" width="100%" height="100%" />
        </span>
      </div>
    );
  }
  const items = [
    { key: 'overview', label: 'Overview', href: org.links.overview },
    { key: 'projects', label: 'Projects', href: org.links.projects },
    { key: 'members', label: 'Members', href: org.links.members },
    { key: 'invitations', label: 'Invitations', href: org.links.invitations },
  ];
  return (
    <div data-org-group className={styles.orgGroup}>
      <AppLink href={org.links.overview} className={styles.nameRow} title={org.name}>
        <span className={styles.orgName}>{org.name}</span>
      </AppLink>
      <div className={styles.itemsRow}>
        {items.map((it) =>
          it.href === undefined ? null : (
            <AppLink
              key={it.key}
              href={it.href}
              className={active === it.key ? chrome.on : undefined}
              aria-current={active === it.key ? 'page' : undefined}
            >
              {it.label}
            </AppLink>
          ),
        )}
      </div>
    </div>
  );
}

/** The platform area: the page, with a fixed-width side menu only inside one org. */
export function PlatformLayout({ active, org, children }: PlatformLayoutProps) {
  return (
    <div className={styles.body}>
      {org && (
        <nav className={chrome.subnav} aria-label="Platform admin">
          <OrgGroup org={org} active={active} />
        </nav>
      )}
      <div className={styles.main}>{children}</div>
    </div>
  );
}
