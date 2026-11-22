import { AppLink } from '@/ds';
import styles from './Chrome.module.css';

export interface BrandProps {
  withName?: boolean;
  size?: 20 | 26 | 36;
  href?: string;
}

/** Served from public/ (the same file is the favicon), so it needs no import and works in Storybook through staticDirs. */
const LOGO_SRC = '/agent-desk-icon.svg';

export function Brand({ withName = true, size = 20, href }: BrandProps) {
  // Decorative when the text beside it names the product; otherwise it is the only name there is.
  const glyph = <img src={LOGO_SRC} width={size} height={size} alt={withName ? '' : 'Agent Desk'} />;
  if (!href) {
    return (
      <span className={styles.brand}>
        {glyph}
        {withName && 'Agent Desk'}
      </span>
    );
  }
  return (
    <AppLink href={href} className={styles.brand} aria-label="Agent Desk, all projects">
      {glyph}
      {withName && 'Agent Desk'}
    </AppLink>
  );
}
