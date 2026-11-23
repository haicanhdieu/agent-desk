import type { ReactNode } from 'react';
import type { OrgSettingsTabKey } from '@/mocks/types';
import { SubNav } from './SubNav';
import styles from './OrgSettingsLayout.module.css';

export interface OrgSettingsLayoutProps {
  /** Href per visible tab. A tab that is absent is not shown. */
  tabs: Partial<Record<OrgSettingsTabKey, string>>;
  active: OrgSettingsTabKey | null;
  children: ReactNode;
}

const ORDER: { key: OrgSettingsTabKey; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'members', label: 'Members' },
  { key: 'invitations', label: 'Invitations' },
  { key: 'audit', label: 'Audit log' },
];

/** The Settings area: a fixed-width side menu and the scrolling page next to it. */
export function OrgSettingsLayout({ tabs, active, children }: OrgSettingsLayoutProps) {
  const items = ORDER.flatMap(({ key, label }) => {
    const href = tabs[key];
    return href === undefined ? [] : [{ label, href, active: active === key }];
  });
  return (
    <div className={styles.body}>
      <SubNav aria-label="Organization settings" groups={[{ heading: 'Organization', items }]} />
      <div className={styles.main}>{children}</div>
    </div>
  );
}
