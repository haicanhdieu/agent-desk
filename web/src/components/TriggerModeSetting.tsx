import { SegmentedControl } from '@/ds';
import { connectionCopy as c, pollIntervals } from '@/mocks/connection';
import type { PollInterval, TriggerMode } from '@/mocks/types';
import styles from './Composites.module.css';

export interface TriggerModeSettingProps {
  mode: TriggerMode;
  interval: PollInterval;
  onChange?(next: { mode: TriggerMode; interval: PollInterval }): void;
}

/** Project settings control: Webhook / Polling, plus the interval while polling. */
export function TriggerModeSetting({ mode, interval, onChange }: TriggerModeSettingProps) {
  return (
    <div className={styles.triggerMode}>
      <SegmentedControl
        aria-label={c.triggerModeTerm}
        value={mode}
        options={(['webhook', 'polling'] as const).map((m) => ({ value: m, label: c.modes[m].title }))}
        onChange={(m) => onChange?.({ mode: m, interval })}
      />
      {mode === 'polling' && (
        <SegmentedControl
          aria-label={c.intervalLabel}
          value={interval}
          options={pollIntervals.map((i) => ({ value: i, label: i }))}
          onChange={(i) => onChange?.({ mode, interval: i })}
        />
      )}
      <span className={styles.triggerHelp}>{c.triggerModeHelp}</span>
    </div>
  );
}
