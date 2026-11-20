import type { ReactNode } from 'react';
import styles from './RunList.module.css';

export interface EmptyStateProps {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  /** Heading level of the title; 3 under an h2 section, 2 right under the page's h1. */
  headingLevel?: 2 | 3;
}

export function EmptyState({ title, body, action, children, headingLevel = 3 }: EmptyStateProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className={styles.empty}>
      <Heading>{title}</Heading>
      {body && <p className={styles.emptyBody}>{body}</p>}
      {children}
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  );
}
