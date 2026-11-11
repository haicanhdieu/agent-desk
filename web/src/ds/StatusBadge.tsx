import type { ReactNode } from 'react';
import { StatusIcon } from './StatusIcon';
import { statusTokens, type RunStatus } from './tokens';
import styles from './Chips.module.css';

export interface StatusBadgeProps {
  status: RunStatus;
  variant?: 'text' | 'pill';
  size?: 12 | 14 | 16;
  children?: ReactNode;
}

export function StatusBadge({ status, variant = 'text', size = 14, children }: StatusBadgeProps) {
  const token = statusTokens[status] ?? statusTokens.queued;
  const cls = [styles.st, styles[`st-${status}`] ?? styles['st-queued'], variant === 'pill' && styles['st-pill']]
    .filter(Boolean).join(' ');
  return (
    <span className={cls} title={`status: ${status}`}>
      <StatusIcon status={status} size={size} />
      {children ?? token.label}
    </span>
  );
}
