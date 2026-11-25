import { useEffect, useId, useRef } from 'react';
import { RadioCard } from '@/ds';
import { ProviderMark } from './ProviderMark';
import styles from './ProviderPicker.module.css';

export interface ProviderPickerOption {
  /** The provider's id: its kind for a runnable one, its catalogue id for a Coming soon one. */
  kind: string;
  label: string;
  /** The logo key of the capability table. */
  logo: string;
  /** false = Coming soon: a chip, never a radio. */
  available: boolean;
}

export interface ProviderPickerProps {
  options: ProviderPickerOption[];
  value: string | null;
  onChange(kind: string): void;
  /** The choice is fixed (Edit pane): the radios are disabled. */
  readOnly?: boolean;
  error?: string;
  /** Focus the first card on mount (the Add pane). */
  autoFocus?: boolean;
  /** The group's name. Default "Provider" (the wizard says "Agent"). */
  legend?: string;
}

/** Radio cards for the providers a person can pick, then the Coming soon ones as plain chips. Names come from props. */
export function ProviderPicker({
  options,
  value,
  onChange,
  readOnly,
  error,
  autoFocus,
  legend = 'Provider',
}: ProviderPickerProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const comingId = `${id}-soon`;
  const root = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    if (autoFocus) root.current?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus();
  }, [autoFocus]);
  const runnable = options.filter((o) => o.available);
  const soon = options.filter((o) => !o.available);
  return (
    <fieldset
      ref={root}
      className={styles.picker}
      aria-describedby={error ? errorId : undefined}
      aria-invalid={error ? true : undefined}
    >
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.cards}>
        {runnable.map((o) => (
          <RadioCard
            key={o.kind}
            type="radio"
            name={`${id}-provider`}
            checked={value === o.kind}
            disabled={readOnly}
            onChange={() => onChange(o.kind)}
            title={
              <span className={styles.name}>
                <ProviderMark kind={o.logo} label={o.label} size="md" />
                {o.label}
              </span>
            }
          />
        ))}
      </div>
      {error && (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      )}
      {soon.length > 0 && (
        <div className={styles.soon}>
          <span id={comingId} className={styles.soonLabel}>
            Coming soon
          </span>
          <ul className={styles.chips} aria-labelledby={comingId}>
            {soon.map((o) => (
              <li key={o.kind}>
                <span role="img" aria-label={`${o.label}, coming soon`} className={styles.chip}>
                  <ProviderMark kind={o.logo} label={o.label} size="sm" tint="muted" />
                  <span aria-hidden="true">{o.label}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </fieldset>
  );
}
