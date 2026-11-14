import type { ReactNode } from 'react';
import { AppLink } from '@/ds';
import styles from './RunList.module.css';

export interface FilterChipProps {
  label: string;
  count?: number;
  icon?: ReactNode;
  on: boolean;
  onClick?: () => void;
  /** Renders the chip as a link (e.g. a `?filter=` URL); the selected chip is the current page. */
  href?: string;
}

export function FilterChip({ label, count, icon, on, onClick, href }: FilterChipProps) {
  const className = [styles.fchip, on && styles.on].filter(Boolean).join(' ');
  const content = (
    <>
      {icon}
      {label}
      {count !== undefined && <b>{count}</b>}
    </>
  );
  if (href !== undefined) {
    return (
      <AppLink href={href} className={className} aria-current={on ? 'page' : undefined} onClick={onClick}>
        {content}
      </AppLink>
    );
  }
  return (
    <button type="button" className={className} aria-pressed={on} onClick={onClick}>
      {content}
    </button>
  );
}

export function FilterChips({ 'aria-label': ariaLabel, children }: { 'aria-label': string; children: ReactNode }) {
  return (
    <div role="group" aria-label={ariaLabel} className={styles.filters}>
      {children}
    </div>
  );
}
