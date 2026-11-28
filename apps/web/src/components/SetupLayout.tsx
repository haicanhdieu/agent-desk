import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BELOW_DESKTOP, Button, useMediaQuery } from '@/ds';
import { ShellContext } from './shellContext';
import { Stepper, type StepperProps } from './Stepper';
import styles from './Composites.module.css';

export interface SetupLayoutProps {
  projectName: string;
  /** Where "Exit setup" goes; the org's Projects page by default. */
  exitHref?: string;
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
    /** A second button before `next` (Continue anyway). */
    also?: { label: string; onClick(): void; disabled?: boolean };
    /** A line under the footer. */
    note?: ReactNode;
    next: { label: string; href?: string; onClick?(): void; disabled?: boolean; pending?: boolean };
  };
}

export function SetupLayout({
  projectName,
  exitHref,
  steps,
  current,
  ready,
  stepLabel,
  title,
  intro,
  header,
  children,
  aside,
  footer,
}: SetupLayoutProps) {
  const shell = useContext(ShellContext);
  // Under the shell the progress goes into the shell's menu slot; without a provider it stays in place.
  const owned = shell !== null;
  const below = useMediaQuery(BELOW_DESKTOP);
  const exit = (
    <Button variant="ghost" href={exitHref ?? '/projects'}>
      Exit setup
    </Button>
  );
  const progress = (
    <aside className={owned ? styles.setupLeftSlot : styles.setupLeft} aria-label="Setup progress">
      <div className={styles.setupHead}>
        <span className={styles.setupKicker}>New project</span>
        <b className={styles.setupName}>{projectName}</b>
      </div>
      <Stepper steps={steps} current={current} ready={ready} />
      <p className={styles.saved}>Progress is saved. You can leave and resume from the project list.</p>
      {owned && !below && <div className={styles.setupExit}>{exit}</div>}
    </aside>
  );
  const headerRow = owned && below;
  return (
    <>
      {shell?.wizardSlot && createPortal(progress, shell.wizardSlot)}
      <div className={styles.setup}>
        {!owned && progress}
        <main className={styles.setupMain}>
          <div className={styles.setupCol}>
            {headerRow && (
              <div className={styles.setupRow}>
                {stepLabel && <span className={styles.stepOf}>{stepLabel}</span>}
                <span className={styles.spacer} />
                {exit}
              </div>
            )}
            {header ?? (
              <div className={styles.setupTitle}>
                {!headerRow && <span className={styles.stepOf}>{stepLabel}</span>}
                <h1>{title}</h1>
                <p className={styles.intro}>{intro}</p>
              </div>
            )}
            {children}
            {footer && (
              <div className={styles.setupFoot}>
                {footer.back && (
                  <Button variant="ghost" icon="chevron-left" href={footer.back}>
                    Back
                  </Button>
                )}
                <span className={styles.spacer} />
                {footer.onSkip ? (
                  <Button variant="ghost" onClick={footer.onSkip} disabled={footer.next.pending}>
                    Skip
                  </Button>
                ) : (
                  footer.skip && (
                    <Button variant="ghost" href={footer.skip}>
                      Skip
                    </Button>
                  )
                )}
                {footer.also && (
                  <Button onClick={footer.also.onClick} disabled={footer.also.disabled || footer.next.pending}>
                    {footer.also.label}
                  </Button>
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
                  <Button variant="primary" href={footer.next.href ?? '#'} disabled={footer.next.disabled}>
                    {footer.next.label}
                  </Button>
                )}
              </div>
            )}
            {footer?.note && <p className={styles.footNote}>{footer.note}</p>}
          </div>
          {aside && <aside className={styles.setupAside}>{aside}</aside>}
        </main>
      </div>
    </>
  );
}
