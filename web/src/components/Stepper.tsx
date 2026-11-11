import { StepNumber } from '@/ds';
import styles from './Composites.module.css';

export interface StepperProps {
  steps: { label: string; detail?: string; optional?: boolean }[];
  /** Zero-based index of the current step. Steps before it are done. */
  current: number;
}

export function Stepper({ steps, current }: StepperProps) {
  return (
    <ol className={styles.steps}>
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li
            key={s.label}
            className={[styles.step, state === 'current' && styles.on].filter(Boolean).join(' ')}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <StepNumber n={i + 1} state={state} />
            <div className={styles.stepText}>
              <span className={styles.stepLabel}>
                {s.label}
                {s.optional && <span className={styles.tag}>optional</span>}
              </span>
              {state === 'done' && s.detail && <span className={styles.detail}>{s.detail}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
