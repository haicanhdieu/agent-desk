import type { ReactNode } from 'react';
import styles from './Overlay.module.css';

export type BannerTone = 'warn' | 'err' | 'late' | 'ok' | 'off' | 'idle';

export interface BannerProps {
  tone: BannerTone;
  icon?: ReactNode;
  /** Overrides the tone's icon colour. */
  iconColor?: string;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  actionsPlacement?: 'end' | 'below';
  /** Square corners, bottom border only (attached to the top of the terminal). */
  flush?: boolean;
  /** 20px icon, 15px title (Failed / Timed out notices). */
  prominent?: boolean;
  /** Vertically centre icon, body and actions (single-line-ish banners with buttons). */
  centered?: boolean;
  /** Only for banners that appear while the page is open; static banners are not announced. */
  live?: 'polite' | 'assertive';
}

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(' ');

export function Banner({
  tone, icon, iconColor, title, children, actions, actionsPlacement = 'end', flush, prominent, centered, live,
}: BannerProps) {
  const role = live === 'assertive' ? 'alert' : live === 'polite' ? 'status' : undefined;
  const actionsNode = actions ? (
    <div className={cx(styles['b-actions'], actionsPlacement === 'below' && styles.below)}>{actions}</div>
  ) : null;
  return (
    <div
      className={cx(styles.banner, styles[tone], flush && styles.flush, prominent && styles.prominent, centered && styles.centered)}
      role={role}
    >
      {icon && (
        <span className={styles['b-ico']} style={iconColor ? { color: iconColor } : undefined}>
          {icon}
        </span>
      )}
      <div className={styles['b-body']}>
        {title && <div className={styles['b-title']}>{title}</div>}
        {children && <div className={styles['b-text']}>{children}</div>}
        {actionsPlacement === 'below' && actionsNode}
      </div>
      {actionsPlacement === 'end' && actionsNode}
    </div>
  );
}
