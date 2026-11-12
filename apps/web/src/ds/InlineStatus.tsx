import type { ReactNode } from 'react';
import type { StatusTone } from './tokens';
import styles from './Chips.module.css';

export interface InlineStatusProps {
  tone: StatusTone;
  icon?: ReactNode;
  children: ReactNode;
}

export function InlineStatus({ tone, icon, children }: InlineStatusProps) {
  return (
    <span className={`${styles['inline-status']} ${styles[tone]}`}>
      {icon}
      <span>{children}</span>
    </span>
  );
}
