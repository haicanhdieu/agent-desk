import type { ReactNode } from 'react';
import { IconButton } from '@/ds';
import styles from './SidePanel.module.css';

export function SidePanel({ 'aria-label': label = 'Run context', children }: { 'aria-label'?: string; children: ReactNode }) {
  return <aside className={styles.side} aria-label={label}>{children}</aside>;
}

export interface SideRailProps { onExpand?: () => void; items: { icon: ReactNode; title: string }[] }

export function SideRail({ onExpand, items }: SideRailProps) {
  return (
    <aside className={styles.rail} aria-label="Run context, collapsed">
      <IconButton icon="chevron-left" aria-label="Expand context panel (])" onClick={onExpand} />
      {items.map((it) => (
        <span key={it.title} className={styles.railItem} role="img" aria-label={it.title} title={it.title}>{it.icon}</span>
      ))}
    </aside>
  );
}
