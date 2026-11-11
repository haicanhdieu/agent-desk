import type { ReactNode } from 'react';
import styles from './RunList.module.css';

export interface FilterChipProps {
  label: string;
  count?: number;
  icon?: ReactNode;
  on: boolean;
  onClick: () => void;
}

export function FilterChip({ label, count, icon, on, onClick }: FilterChipProps) {
  return (
    <button type="button" className={[styles.fchip, on && styles.on].filter(Boolean).join(' ')} aria-pressed={on} onClick={onClick}>
      {icon}
      {label}
      {count !== undefined && <b>{count}</b>}
    </button>
  );
}

export function FilterChips({ 'aria-label': ariaLabel, children }: { 'aria-label': string; children: ReactNode }) {
  return <div role="group" aria-label={ariaLabel} className={styles.filters}>{children}</div>;
}
