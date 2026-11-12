import type { CSSProperties } from 'react';
import styles from './Skeleton.module.css';

export interface SkeletonProps {
  variant: 'block' | 'text';
  /** Text variant only: number of lines (the last is shorter). */
  lines?: number;
  width?: number | string;
  height?: number | string;
}

/** Loading placeholder. Decorative: the surrounding region should carry `aria-busy` or a status message. */
export function Skeleton({ variant, lines = 1, width, height }: SkeletonProps) {
  const style: CSSProperties = { width, height };
  if (variant === 'block') {
    return <span className={styles.sk} style={style} aria-hidden="true" />;
  }
  return (
    <span className={styles.text} style={{ width }} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} data-skeleton-line className={`${styles.sk} ${styles.line}`} style={{ height }} />
      ))}
    </span>
  );
}
