import type { ReactNode } from 'react';
import { Button, Icon, type IconName } from '@/ds';
import styles from './Terminal.module.css';

export interface TerminalBarProps {
  views: { id: string; label: string; icon: IconName; soon?: string }[];
  activeView: string;
  connection: ReactNode;
  size?: string;
  onViewChange?(id: string): void;
  onFind?(): void;
  onCopyAll?(): void;
}

export function TerminalBar({ views, activeView, connection, size, onViewChange, onFind, onCopyAll }: TerminalBarProps) {
  return (
    <div className={styles.termbar}>
      <div className={styles.tabs} role="tablist" aria-label="Run view">
        {views.map((v) => {
          const on = v.id === activeView && !v.soon;
          return (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={on}
              aria-disabled={v.soon ? true : undefined}
              disabled={!!v.soon}
              className={[styles.vtab, on && styles.on, v.soon && styles.soon].filter(Boolean).join(' ')}
              onClick={() => onViewChange?.(v.id)}
            >
              <Icon name={v.icon} size={14} />
              {v.label}
              {v.soon && <> <span className={styles.soonTag}>{v.soon}</span></>}
            </button>
          );
        })}
      </div>
      <span className={styles.grow} />
      {connection}
      <span className={styles.sep} aria-hidden="true" />
      {size && <span className={styles.size}>{size}</span>}
      <Button variant="ghost" size="sm" icon="search" aria-label="Search scrollback" onClick={onFind}>Find</Button>
      <Button variant="ghost" size="sm" icon="copy" onClick={onCopyAll}>Copy all</Button>
    </div>
  );
}
