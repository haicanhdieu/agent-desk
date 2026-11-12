import type { ReactNode } from 'react';
import styles from './Chips.module.css';

export interface InlineStatusProps {
  tone: 'ok' | 'warn' | 'fail' | 'idle' | 'muted';
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
