import { CountBadge, Icon, InlineStatus } from '@/ds';
import styles from './Chrome.module.css';

export interface ProjectSwitchProps {
  org: string;
  project: string;
  onClick?(): void;
}

export function ProjectSwitch({ org, project, onClick }: ProjectSwitchProps) {
  return (
    <button type="button" className={styles.switch} aria-label={`Switch project, currently ${project}`} onClick={onClick}>
      <span className={styles.org}>{org} /</span>
      <span className={styles.name} title={project}>{project}</span>
      <Icon name="chevron-down" />
    </button>
  );
}

export interface ProjectMenuProps {
  items: {
    name: string;
    needsYou: number;
    /** Short connection warning, e.g. "webhooks" (silent webhook) or "polling" (polling failed). */
    warning?: string;
    /** idle (amber) for a silent webhook, fail (red) for a polling error. */
    warningTone?: 'idle' | 'err';
    current?: boolean;
    href: string;
  }[];
}

export function ProjectMenu({ items }: ProjectMenuProps) {
  return (
    <div className={styles.menu}>
      {items.map((it) => (
        <a
          key={it.name}
          href={it.href}
          className={`${styles.menuItem} ${it.current ? styles.current : ''}`}
          aria-current={it.current ? 'true' : undefined}
        >
          <span className={styles.menuName} title={it.name}>{it.name}</span>
          <span className={styles.grow} />
          {it.warning ? (
            <InlineStatus tone={it.warningTone ?? 'idle'} icon={<Icon name="warning" size={12} />}>{it.warning}</InlineStatus>
          ) : it.needsYou > 0 ? (
            <CountBadge count={it.needsYou} />
          ) : (
            <span className={styles.menuZero}>0</span>
          )}
        </a>
      ))}
    </div>
  );
}
