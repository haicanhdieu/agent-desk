import type { ReactNode } from 'react';
import styles from './RunList.module.css';

export interface EmptyStateProps {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}

export function EmptyState({ title, body, action, children }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <h3>{title}</h3>
      {body && <p className={styles.emptyBody}>{body}</p>}
      {children}
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  );
}
