import { AppLink, Icon } from '@/ds';
import styles from './Chrome.module.css';

export interface OrgNavProps {
  active?: 'projects' | 'settings';
  projectsHref: string;
  /** The Settings tab shows only when this is given. */
  settingsHref?: string;
}

/** Projects / Settings tabs of the org-level top bar. */
export function OrgNav({ active, projectsHref, settingsHref }: OrgNavProps) {
  return (
    <nav className={styles.tabs} aria-label="Organization sections">
      <AppLink
        href={projectsHref}
        className={active === 'projects' ? styles.on : undefined}
        aria-current={active === 'projects' ? 'page' : undefined}
      >
        <Icon name="grid" size={15} />
        Projects
      </AppLink>
      {settingsHref !== undefined && (
        <AppLink
          href={settingsHref}
          className={active === 'settings' ? styles.on : undefined}
          aria-current={active === 'settings' ? 'page' : undefined}
        >
          <Icon name="sliders" size={15} />
          Org settings
        </AppLink>
      )}
    </nav>
  );
}
