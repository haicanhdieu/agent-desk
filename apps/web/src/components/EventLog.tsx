import type { ReactNode } from 'react';
import styles from './Terminal.module.css';

export interface EventLogProps {
  events: { at: string; text: ReactNode }[];
  timeWidth?: number;
}

export function EventLog({ events, timeWidth = 62 }: EventLogProps) {
  return (
    <div className={styles.events}>
      {events.map((e, i) => (
        <div key={i} className={styles.event}>
          <span className={styles.eventAt} style={{ width: timeWidth }}>
            {e.at}
          </span>
          <span>{e.text}</span>
        </div>
      ))}
    </div>
  );
}
