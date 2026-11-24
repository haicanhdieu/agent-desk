import { AppLink, Icon } from '@/ds';
import styles from './Chrome.module.css';

export interface PlatformNavProps {
  active?: 'orgs' | 'admins' | 'audit';
  links: { orgs: string; admins: string; audit: string };
}

/** Organizations / Platform admins / Audit log tabs of the platform top bar. */
export function PlatformNav({ active, links }: PlatformNavProps) {
  const tab = (key: 'orgs' | 'admins' | 'audit', icon: 'grid' | 'lock' | 'clock', label: string) => (
    <AppLink
      href={links[key]}
      className={active === key ? styles.on : undefined}
      aria-current={active === key ? 'page' : undefined}
    >
      <Icon name={icon} size={15} />
      {label}
    </AppLink>
  );
  return (
    <nav className={styles.tabs} aria-label="Platform sections">
      {tab('orgs', 'grid', 'Organizations')}
      {tab('admins', 'lock', 'Platform admins')}
      {tab('audit', 'clock', 'Audit log')}
    </nav>
  );
}
