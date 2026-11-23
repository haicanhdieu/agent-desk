import type { ReactNode } from 'react';
import { SubNav } from './SubNav';
import styles from './PlatformLayout.module.css';

export interface PlatformLayoutProps {
  active: 'orgs' | 'admins' | 'audit' | 'overview' | 'projects' | 'members' | 'invitations';
  links: { orgs: string; admins: string; audit: string };
  /** Present inside an org: group "<org name>"; an absent link hides its item. */
  org?: { name: string; links: { overview: string; projects?: string; members?: string; invitations?: string } };
  children: ReactNode;
}

/** The platform area: a fixed-width side menu and the scrolling page next to it. */
export function PlatformLayout({ active, links, org, children }: PlatformLayoutProps) {
  const groups: Parameters<typeof SubNav>[0]['groups'] = [
    {
      items: [
        { label: 'Organizations', href: links.orgs, active: active === 'orgs' },
        { label: 'Platform admins', href: links.admins, active: active === 'admins' },
        { label: 'Audit log', href: links.audit, active: active === 'audit' },
      ],
    },
  ];
  if (org) {
    const orgItems = [
      { key: 'overview', label: 'Overview', href: org.links.overview },
      { key: 'projects', label: 'Projects', href: org.links.projects },
      { key: 'members', label: 'Members', href: org.links.members },
      { key: 'invitations', label: 'Invitations', href: org.links.invitations },
    ].flatMap((it) => (it.href === undefined ? [] : [{ label: it.label, href: it.href, active: active === it.key }]));
    groups.push(
      {
        content: (
          <span className={styles.orgName} title={org.name}>
            {org.name}
          </span>
        ),
      },
      { items: orgItems },
    );
  }
  return (
    <div className={styles.body}>
      <SubNav aria-label="Platform admin" groups={groups} />
      <div className={styles.main}>{children}</div>
    </div>
  );
}
