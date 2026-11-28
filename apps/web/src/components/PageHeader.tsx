import type { ReactNode } from 'react';
import { Skeleton } from '@/ds';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** Rendered after the title row. */
  banner?: ReactNode;
  loading?: boolean;
}

/** Page header: one focusable h1, optional meta line and actions, optional banner below. Never shrinks in a flex column. */
export function PageHeader({ title, meta, actions, banner, loading }: PageHeaderProps) {
  if (loading) {
    return (
      <header className={styles.header} aria-busy="true">
        <div className={styles.row}>
          <div className={styles.title}>
            <Skeleton variant="block" width={200} height={22} />
            <Skeleton variant="block" width={120} height={14} />
          </div>
        </div>
      </header>
    );
  }
  return (
    <header className={styles.header}>
      <div className={styles.row}>
        <div className={styles.title}>
          <h1 className={styles.h1} tabIndex={-1}>
            {title}
          </h1>
          {meta !== undefined && <div className={styles.meta}>{meta}</div>}
        </div>
        {actions !== undefined && (
          <div className={styles.actions} data-page-header-actions>
            {actions}
          </div>
        )}
      </div>
      {banner}
    </header>
  );
}
