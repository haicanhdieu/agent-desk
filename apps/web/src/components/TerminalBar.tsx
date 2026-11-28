import { useRef, type KeyboardEvent, type ReactNode } from 'react';
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
  /** The result of the last Copy all, shown in the button until it resets. */
  copyStatus?: 'copied' | 'failed';
  /** Show Find and Copy all (default true); the Transcript bar hides them. */
  tools?: boolean;
}

export function TerminalBar({
  views,
  activeView,
  connection,
  size,
  onViewChange,
  onFind,
  onCopyAll,
  copyStatus,
  tools = true,
}: TerminalBarProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const usable = views.filter((v) => !v.soon);
  const found = usable.findIndex((v) => v.id === activeView);
  const current = found === -1 ? 0 : found;

  const move = (i: number) => {
    const n = usable.length;
    const next = usable[((i % n) + n) % n];
    onViewChange?.(next.id);
    refs.current.get(next.id)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (usable.length === 0) return;
    const keys: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      Home: 0,
      End: usable.length - 1,
    };
    if (!(e.key in keys)) return;
    e.preventDefault();
    move(keys[e.key]);
  };

  return (
    <div className={styles.termbar}>
      <div className={styles.tabs} role="tablist" aria-label="Run view" onKeyDown={onKeyDown}>
        {views.map((v) => {
          const on = v.id === activeView && !v.soon;
          return (
            <button
              key={v.id}
              ref={(el) => {
                if (el) refs.current.set(v.id, el);
                else refs.current.delete(v.id);
              }}
              type="button"
              role="tab"
              aria-selected={on}
              aria-disabled={v.soon ? true : undefined}
              disabled={!!v.soon}
              tabIndex={v.id === usable[current]?.id ? 0 : -1}
              className={[styles.vtab, on && styles.on, v.soon && styles.soon].filter(Boolean).join(' ')}
              onClick={() => onViewChange?.(v.id)}
            >
              <Icon name={v.icon} size={14} />
              {v.label}
              {v.soon && (
                <>
                  {' '}
                  <span className={styles.soonTag}>{v.soon}</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      <span className={styles.grow} />
      {connection}
      <span className={styles.sep} aria-hidden="true" />
      {size && <span className={styles.size}>{size}</span>}
      {tools && (
        <>
          <Button variant="ghost" size="sm" icon="search" aria-label="Find in scrollback" onClick={onFind}>
            Find
          </Button>
          <Button variant="ghost" size="sm" icon={copyStatus === 'copied' ? 'check' : 'copy'} onClick={onCopyAll}>
            {copyStatus === 'copied' ? 'Copied' : copyStatus === 'failed' ? 'Copy failed' : 'Copy all'}
          </Button>
        </>
      )}
    </div>
  );
}
