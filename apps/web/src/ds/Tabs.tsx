import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import styles from './Tabs.module.css';

const DEFAULT_PREFIX = 'tabs';

export interface TabsProps<T extends string> {
  tabs: { value: T; label: string }[];
  value: T;
  onChange(value: T): void;
  /** Accessible name of the tab list. */
  label: string;
  /** Shared with `TabPanel` so `aria-controls` and `aria-labelledby` resolve. */
  idPrefix?: string;
}

export function Tabs<T extends string>({ tabs, value, onChange, label, idPrefix = DEFAULT_PREFIX }: TabsProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const found = tabs.findIndex((t) => t.value === value);
  const current = found === -1 ? 0 : found;

  const move = (i: number) => {
    const n = tabs.length;
    const next = ((i % n) + n) % n;
    onChange(tabs[next].value);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (tabs.length === 0) return;
    const keys: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    if (!(e.key in keys)) return;
    e.preventDefault();
    move(keys[e.key]);
  };

  return (
    <div role="tablist" aria-label={label} className={styles.tabs} onKeyDown={onKeyDown}>
      {tabs.map((t, i) => (
        <button
          key={t.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${t.value}`}
          aria-selected={i === found}
          aria-controls={`${idPrefix}-panel-${t.value}`}
          tabIndex={i === current ? 0 : -1}
          className={i === found ? styles.on : undefined}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export interface TabPanelProps {
  value: string;
  active: string;
  idPrefix?: string;
  children: ReactNode;
}

/** Renders its children only while `value` is the active tab. */
export function TabPanel({ value, active, idPrefix = DEFAULT_PREFIX, children }: TabPanelProps) {
  if (value !== active) return null;
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${value}`} aria-labelledby={`${idPrefix}-tab-${value}`}>
      {children}
    </div>
  );
}
