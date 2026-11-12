import { Icon } from '@/ds';
import styles from './Chrome.module.css';

export interface BrandProps {
  withName?: boolean;
  size?: 20 | 26 | 36;
  href?: string;
}

export function Brand({ withName = true, size = 20, href }: BrandProps) {
  const glyph = <Icon name="brand" size={size} strokeWidth={size >= 36 ? 1.4 : 1.6} />;
  if (!href) {
    return <span className={styles.brand}>{glyph}{withName && 'Agent Desk'}</span>;
  }
  return (
    <a href={href} className={styles.brand} aria-label="Agent Desk, all projects">
      {glyph}
      {withName && 'Agent Desk'}
    </a>
  );
}
