import type { CSSProperties, ReactNode } from 'react';
import styles from './SidePanel.module.css';

export interface KeyValueProps {
  items: { term: string; value: ReactNode }[];
  termWidth?: number;
}

export function KeyValue({ items, termWidth = 96 }: KeyValueProps) {
  return (
    <dl className={styles.kv} style={{ '--kv-term': `${termWidth}px` } as CSSProperties}>
      {items.map((it) => (
        <div key={it.term} style={{ display: 'contents' }}>
          <dt>{it.term}</dt>
          <dd>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
