import styles from './Terminal.module.css';

export type ConnectionState = 'live' | 'reconnecting' | 'none' | 'ended';

export interface ConnectionIndicatorProps {
  state: ConnectionState;
  label: string;
}

/** Dot plus text; state is never colour-only. */
export function ConnectionIndicator({ state, label }: ConnectionIndicatorProps) {
  return (
    <span className={`${styles.conn} ${styles[state]}`}>
      <i aria-hidden="true" />
      {label}
    </span>
  );
}
