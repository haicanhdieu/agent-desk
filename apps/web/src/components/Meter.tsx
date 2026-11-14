import styles from './SidePanel.module.css';

export interface MeterProps {
  value: number;
  max: number;
  tone?: 'run' | 'late';
  'aria-label': string;
}

export function Meter({ value, max, tone = 'run', 'aria-label': label }: MeterProps) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 0;
  const safeValue = Number.isFinite(value) ? value : 0;
  const now = Math.min(Math.max(safeValue, 0), safeMax);
  const pct = safeMax === 0 ? 0 : (now / safeMax) * 100;
  return (
    <div
      className={[styles.meter, tone === 'late' && styles.late].filter(Boolean).join(' ')}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={now}
    >
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}
