import { StepNumber } from '@/ds';
import styles from './Composites.module.css';

export interface StepperProps {
  steps: { label: string; detail?: string; optional?: boolean }[];
  /** Zero-based index of the current step. Steps before it are done. */
  current: number;
  /** Final, non-numbered step shown highlighted after all steps are done ("Ready to trigger"). Not marked as the current step. */
  ready?: string;
}

export function Stepper({ steps, current, ready }: StepperProps) {
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
      {ready && (
        <li className={[styles.step, styles.on].join(' ')}>
          <StepNumber state="ready" />
          <div className={styles.stepText}>
            <span className={styles.stepLabel}>{ready}</span>
          </div>
        </li>
      )}
    </ol>
  );
}
