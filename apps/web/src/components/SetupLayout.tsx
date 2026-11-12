import type { ReactNode } from 'react';
import { Button } from '@/ds';
import type { Actor } from '@/mocks/types';
import { TopBar } from './TopBar';
import { Stepper, type StepperProps } from './Stepper';
import styles from './Composites.module.css';

export interface SetupLayoutProps {
  user: Actor;
  projectName: string;
  steps: StepperProps['steps'];
  current: number;
  /** Final stepper step after all are done (SetupReady). */
  ready?: string;
  stepLabel?: string;
  title?: string;
  intro?: ReactNode;
  /** Replaces the stepLabel/title/intro block. */
  header?: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
  /**
   * Back and Skip are links unless `onSkip` is given. `next` is a link with `href`, or a button with `onClick` when the
   * step saves first; `pending` disables it while the save runs.
   */
  footer?: {
    back?: string;
    skip?: string;
    onSkip?(): void;
    next: { label: string; href?: string; onClick?(): void; disabled?: boolean; pending?: boolean };
  };
}

export function SetupLayout({ user, projectName, steps, current, ready, stepLabel, title, intro, header, children, aside, footer }: SetupLayoutProps) {
  return (
    <>
      <TopBar variant="global" user={user} />
      <div className={styles.setup}>
        <aside className={styles.setupLeft} aria-label="Setup progress">
          <div className={styles.setupHead}>
            <span className={styles.setupKicker}>New project</span>
            <b className={styles.setupName}>{projectName}</b>
          </div>
          <Stepper steps={steps} current={current} ready={ready} />
          <p className={styles.saved}>Progress is saved. You can leave and resume from the project list.</p>
        </aside>
        <main className={styles.setupMain}>
          <div className={styles.setupCol}>
            {header ?? (
              <div className={styles.setupTitle}>
                <span className={styles.stepOf}>{stepLabel}</span>
                <h1>{title}</h1>
                <p className={styles.intro}>{intro}</p>
              </div>
            )}
            {children}
            {footer && (
            <div className={styles.setupFoot}>
              {footer.back && <Button variant="ghost" icon="chevron-left" href={footer.back}>Back</Button>}
              <span className={styles.spacer} />
              {footer.onSkip ? (
                <Button variant="ghost" onClick={footer.onSkip} disabled={footer.next.pending}>Skip</Button>
              ) : (
                footer.skip && <Button variant="ghost" href={footer.skip}>Skip</Button>
              )}
              {footer.next.onClick ? (
                <Button
                  variant="primary"
                  onClick={footer.next.onClick}
                  disabled={footer.next.disabled || footer.next.pending}
                  aria-busy={footer.next.pending || undefined}
                >
                  {footer.next.label}
                </Button>
              ) : (
                <Button variant="primary" href={footer.next.href ?? '#'} disabled={footer.next.disabled}>{footer.next.label}</Button>
              )}
            </div>
            )}
          </div>
          {aside && <aside className={styles.setupAside}>{aside}</aside>}
        </main>
      </div>
    </>
  );
}
