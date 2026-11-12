import { Fragment, type ReactNode } from 'react';
import { AppLink, Icon, type IconName } from '@/ds';
import styles from './Chrome.module.css';

export interface SubNavProps {
  'aria-label': string;
  groups: {
    heading?: string;
    items?: { label: string; href: string; icon?: IconName; active?: boolean }[];
    content?: ReactNode;
  }[];
}

export function SubNav({ 'aria-label': ariaLabel, groups }: SubNavProps) {
  return (
    <nav className={styles.subnav} aria-label={ariaLabel}>
      {groups.map((g, i) => (
        <Fragment key={g.heading ?? i}>
          {g.heading && <div className={styles.grpH}>{g.heading}</div>}
          {g.items?.map((it) => (
            <AppLink
              key={it.href}
              href={it.href}
              className={it.active ? styles.on : undefined}
              aria-current={it.active ? 'page' : undefined}
            >
              {it.icon && <Icon name={it.icon} size={15} />}
              {it.label}
            </AppLink>
          ))}
          {g.content && <div className={styles.grpBody}>{g.content}</div>}
        </Fragment>
      ))}
    </nav>
  );
}
