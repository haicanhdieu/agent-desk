import type { ReactNode } from 'react';
import { StepNumber } from '@/ds';
import styles from './Entry.module.css';

/** Numbered vertical list; each item is the free-form body next to its StepNumber. */
export function StepList({ items }: { items: ReactNode[] }) {
  return (
    <ol className={styles.stepList}>
      {items.map((body, i) => (
        <li key={i} className={styles.stepItem}>
          <div><StepNumber n={i + 1} /></div>
          <div className={styles.stepBody}>{body}</div>
        </li>
      ))}
    </ol>
  );
}

/** One wrapping inline row inside a StepList item. */
export function StepLine({ children }: { children: ReactNode }) {
  return <span className={styles.stepLine}>{children}</span>;
}
