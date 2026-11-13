import { StatusIcon, type RunStatus } from '@/ds';
import styles from './WorkspaceSetup.module.css';

export type SetupPhaseState = 'done' | 'failed' | 'active' | 'pending';

export interface SetupPhase {
  label: string;
  state: SetupPhaseState;
  detail?: string;
}

const icon: Record<SetupPhaseState, { status: RunStatus; title: string }> = {
  done: { status: 'succeeded', title: 'Done' },
  failed: { status: 'failed', title: 'Failed' },
  active: { status: 'running', title: 'In progress' },
  pending: { status: 'queued', title: 'Not started' },
};

/** One-line checklist of a setup test or run: clone, plugins, setup, shell. */
export function SetupPhases({ phases }: { phases: SetupPhase[] }) {
  return (
    <ul className={styles.phases} aria-label="Setup phases">
      {phases.map((p) => (
        <li key={p.label} className={styles.phase}>
          <StatusIcon status={icon[p.state].status} size={12} title={icon[p.state].title} />
          <span className={styles.phaseLabel}>{p.label}</span>
          {p.detail && <span className={styles.phaseDetail}>{p.detail}</span>}
        </li>
      ))}
    </ul>
  );
}
