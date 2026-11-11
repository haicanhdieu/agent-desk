import { StatusIcon, type RunStatus } from '@/ds';
import styles from './Terminal.module.css';

export interface StartupStep {
  label: string;
  detail?: string;
  at?: string;
  state: 'done' | 'active' | 'pending';
}

const glyph: Record<StartupStep['state'], RunStatus> = { done: 'succeeded', active: 'starting', pending: 'queued' };

export function StartupChecklist({ steps }: { steps: StartupStep[] }) {
  return (
    <ol className={styles.checklist}>
      {steps.map((s, i) => (
        <li key={i} className={styles.step}>
          <span className={styles.glyph}><StatusIcon status={glyph[s.state]} size={16} title={glyph[s.state]} /></span>
          <div className={styles.stepText}>
            <span className={s.state === 'pending' ? styles.pending : undefined}>{s.label}</span>
            {s.detail && <span className={styles.detail}>{s.detail}</span>}
          </div>
          <span className={styles.at}>{s.at}</span>
        </li>
      ))}
    </ol>
  );
}
