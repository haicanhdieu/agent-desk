import { useRef, type KeyboardEvent } from 'react';
import styles from './Form.module.css';

export interface SegmentedControlProps<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange(v: T): void;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export function SegmentedControl<T extends string>({ value, options, onChange, ...aria }: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const found = options.findIndex((o) => o.value === value);
  const current = found === -1 ? 0 : found;

  const move = (i: number) => {
    const n = options.length;
    const next = ((i % n) + n) % n;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (options.length === 0) return;
    const keys: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowDown: current + 1,
      ArrowLeft: current - 1,
      ArrowUp: current - 1,
      Home: 0,
      End: options.length - 1,
    };
    if (!(e.key in keys)) return;
    e.preventDefault();
    move(keys[e.key]);
  };

  return (
    <div role="radiogroup" className={styles.seg} onKeyDown={onKeyDown} {...aria}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={i === found}
          tabIndex={i === current ? 0 : -1}
          className={i === found ? styles.on : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
