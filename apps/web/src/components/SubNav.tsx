import { useId, type ReactNode } from 'react';
import { AppLink, CountBadge, Icon, Skeleton, type IconName } from '@/ds';
import styles from './Chrome.module.css';

export interface SubNavItem {
  label: string;
  href: string;
  icon?: IconName;
  active?: boolean | 'parent';
  badge?: number;
}

export interface SubNavGroup {
  heading?: string;
  items?: SubNavItem[];
  content?: ReactNode;
}

export interface SubNavProps {
  'aria-label': string;
  groups: SubNavGroup[];
  state?: 'ready' | 'loading' | 'error';
  onRetry?(): void;
  back?: { label: string; href: string };
  header?: ReactNode;
  footer?: ReactNode;
  collapsed?: boolean;
  /** Absent: no collapse button (the wizard). */
  onToggleCollapsed?(): void;
  /** Drawer: "Close menu" in place of "Collapse menu". */
  onClose?(): void;
}

function currentOf(active: SubNavItem['active']) {
  if (active === 'parent') return 'true' as const;
  return active ? ('page' as const) : undefined;
}

function Group({ group }: { group: SubNavGroup }) {
  const headingId = useId();
  return (
    <>
      {group.heading && (
        <div className={styles.grpH} id={headingId}>
          {group.heading}
        </div>
      )}
      {group.items && group.items.length > 0 && (
        <ul className={styles.subnavList} aria-labelledby={group.heading ? headingId : undefined}>
          {group.items.map((it) => (
            <li key={it.href}>
              <AppLink href={it.href} className={it.active ? styles.on : undefined} aria-current={currentOf(it.active)}>
                {it.icon && <Icon name={it.icon} size={15} />}
                <span className={styles.subnavLabel}>{it.label}</span>
                <CountBadge count={it.badge} label="needs you" />
              </AppLink>
            </li>
          ))}
        </ul>
      )}
      {group.content && <div className={styles.grpBody}>{group.content}</div>}
    </>
  );
}

export function SubNav({
  'aria-label': ariaLabel,
  groups,
  state = 'ready',
  onRetry,
  back,
  header,
  footer,
  collapsed = false,
  onToggleCollapsed,
  onClose,
}: SubNavProps) {
  const toggle = onClose
    ? { label: 'Close menu', onClick: onClose, icon: 'x' as const, expanded: undefined }
    : onToggleCollapsed
      ? {
          label: collapsed ? 'Expand menu' : 'Collapse menu',
          onClick: onToggleCollapsed,
          icon: collapsed ? ('chevron-right' as const) : ('chevron-left' as const),
          expanded: !collapsed,
        }
      : null;
  return (
    <nav className={`${styles.subnav} ${collapsed ? styles.subnavCollapsed : ''}`} aria-label={ariaLabel}>
      {(back || toggle) && (
        <div className={styles.subnavTop}>
          {!collapsed && back && (
            <AppLink href={back.href} className={styles.subnavBack}>
              <Icon name="chevron-left" size={14} />
              <span className={styles.subnavLabel}>{back.label}</span>
            </AppLink>
          )}
          {toggle && (
            <button
              key="toggle"
              type="button"
              className={styles.subnavToggle}
              aria-label={toggle.label}
              aria-expanded={toggle.expanded}
              onClick={toggle.onClick}
            >
              <Icon name={toggle.icon} size={14} />
            </button>
          )}
        </div>
      )}
      {!collapsed && (
        <>
          {header}
          {state === 'loading' ? (
            <div role="status" className={styles.subnavLoading}>
              <span className={styles.srOnly}>Loading menu</span>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} variant="block" height={28} />
              ))}
            </div>
          ) : (
            <>
              {groups.map((g, i) => (
                <Group key={g.heading ?? i} group={g} />
              ))}
              {state === 'error' && (
                <div className={styles.subnavError}>
                  <span>Could not load the menu.</span>
                  <button type="button" className={styles.subnavRetry} onClick={onRetry}>
                    Retry
                  </button>
                </div>
              )}
            </>
          )}
          {footer && <div className={styles.subnavFooter}>{footer}</div>}
        </>
      )}
    </nav>
  );
}
