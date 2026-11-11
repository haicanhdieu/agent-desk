import { StepNumber } from '@/ds';
import styles from './Entry.module.css';

export interface StepCardGridProps {
  steps: { title: string; body: string }[];
}

/** Joined row of numbered cards, e.g. the four setup steps on the empty projects page. */
export function StepCardGrid({ steps }: StepCardGridProps) {
  return (
    <ol className={styles.cards}>
      {steps.map((s, i) => (
        <li key={s.title} className={styles.card}>
          <StepNumber n={i + 1} />
          <b className={styles.cardTitle}>{s.title}</b>
          <span className={styles.cardBody}>{s.body}</span>
        </li>
      ))}
    </ol>
  );
}
