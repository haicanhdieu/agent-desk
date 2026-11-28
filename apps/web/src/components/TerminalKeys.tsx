import type { PointerEvent, MouseEvent } from 'react';
import { Button, Icon } from '@/ds';
import type { IconName } from '@/ds';
import styles from './TerminalKeys.module.css';

export type TerminalKey = 'esc' | 'tab' | 'left' | 'up' | 'down' | 'right' | 'ctrl-c' | 'enter';

export interface TerminalKeysProps {
  onKey(key: TerminalKey): void;
}

const KEYS: Array<{ key: TerminalKey; label: string; icon?: IconName }> = [
  { key: 'esc', label: 'Esc' },
  { key: 'tab', label: 'Tab' },
  { key: 'left', label: 'Left arrow', icon: 'chevron-left' },
  { key: 'up', label: 'Up arrow', icon: 'chevron-up' },
  { key: 'down', label: 'Down arrow', icon: 'chevron-down' },
  { key: 'right', label: 'Right arrow', icon: 'chevron-right' },
  { key: 'ctrl-c', label: 'Ctrl-C' },
  { key: 'enter', label: 'Enter' },
];

// Keep focus where it is (the terminal) when a key button is pressed.
const keepFocus = (e: PointerEvent | MouseEvent) => e.preventDefault();

/** Special keys a phone keyboard lacks, sent to the terminal. Wraps instead of shrinking or scrolling. */
export function TerminalKeys({ onKey }: TerminalKeysProps) {
  return (
    <div role="group" aria-label="Terminal keys" className={styles.keys}>
      {KEYS.map(({ key, label, icon }) =>
        icon ? (
          <Button
            key={key}
            size="sm"
            aria-label={label}
            title={label}
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={() => onKey(key)}
          >
            <Icon name={icon} size={14} />
          </Button>
        ) : (
          <Button key={key} size="sm" onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={() => onKey(key)}>
            {label}
          </Button>
        ),
      )}
    </div>
  );
}
