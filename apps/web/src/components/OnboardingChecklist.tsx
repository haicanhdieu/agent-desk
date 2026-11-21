import { Banner, Button, Icon, Skeleton, StatusIcon } from '@/ds';
import type { ChecklistStep } from '@/mocks/types';
import { SurfaceCard } from './SurfaceCard';
import styles from './OnboardingChecklist.module.css';

export type OnboardingChecklistState =
  | { kind: 'loading' }
  | { kind: 'error'; requestId?: string; onRetry: () => void }
  | { kind: 'ready'; steps: ChecklistStep[] };

const SKELETON_ROWS = 4;

/** The first-run checklist card on the Projects page: four setup steps, done or still to do. */
export function OnboardingChecklist({ state }: { state: OnboardingChecklistState }) {
  return (
    <SurfaceCard>
      <div className={styles.card}>
        <h2 className={styles.title}>Get started</h2>
        <Body state={state} />
      </div>
    </SurfaceCard>
  );
}

function Body({ state }: { state: OnboardingChecklistState }) {
  if (state.kind === 'loading') {
    return (
      <div className={styles.skeletons} aria-busy="true">
        <span role="status" className="sr-only">
          Loading checklist
        </span>
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <Skeleton key={i} variant="block" height={18} />
        ))}
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <Banner
        tone="err"
        icon={<Icon name="warning" />}
        title="Internal server error"
        live="assertive"
        centered
        actions={
          <Button size="sm" icon="refresh" onClick={state.onRetry}>
            Retry
          </Button>
        }
      >
        {state.requestId ? `Request ID: ${state.requestId}` : undefined}
      </Banner>
    );
  }
  return (
    <ul className={styles.list}>
      {state.steps.map((step) => (
        <li key={step.key} className={styles.row}>
          <StatusIcon status={step.done ? 'succeeded' : 'queued'} title={step.done ? 'Done' : 'Not done'} />
          <span className={styles.label}>{step.label}</span>
          {step.done ? (
            <span className={styles.done}>Done</span>
          ) : (
            <Button size="sm" href={step.href}>
              Start
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
