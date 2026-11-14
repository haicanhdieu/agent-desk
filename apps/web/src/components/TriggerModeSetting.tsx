import { useId } from 'react';
import { SegmentedControl } from '@/ds';
import { connectionCopy as c, pollIntervals } from '@/mocks/connection';
import type { PollInterval, TriggerMode } from '@/mocks/types';
import styles from './Composites.module.css';

export interface TriggerModeSettingProps {
  mode: TriggerMode;
  interval: PollInterval;
  onChange?(next: { mode: TriggerMode; interval: PollInterval }): void;
  /** Shown under the control, e.g. when saving the change failed. */
  error?: string;
}

/** Project settings control: Webhook / Polling, plus the interval while polling. */
export function TriggerModeSetting({ mode, interval, onChange, error }: TriggerModeSettingProps) {
  const errorId = useId();
  const errorAria = error ? { 'aria-describedby': errorId, 'aria-invalid': true as const } : {};
  return (
    <div className={styles.triggerMode}>
      <SegmentedControl
        aria-label={c.triggerModeTerm}
        {...errorAria}
        value={mode}
        options={(['webhook', 'polling'] as const).map((m) => ({ value: m, label: c.modes[m].title }))}
        onChange={(m) => onChange?.({ mode: m, interval })}
      />
      {mode === 'polling' && (
        <SegmentedControl
          aria-label={c.intervalLabel}
          {...errorAria}
          value={interval}
          options={pollIntervals.map((i) => ({ value: i, label: i }))}
          onChange={(i) => onChange?.({ mode, interval: i })}
        />
      )}
      <span className={styles.triggerHelp}>{c.triggerModeHelp}</span>
      {error && (
        <span id={errorId} className={styles.triggerError}>
          {error}
        </span>
      )}
    </div>
  );
}
