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
  stepLabel: string;
  title: string;
  intro: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
  footer: { back?: string; skip?: string; next: { label: string; href: string } };
}

export function SetupLayout({ user, projectName, steps, current, stepLabel, title, intro, children, aside, footer }: SetupLayoutProps) {
  return (
    <>
      <TopBar variant="global" user={user} />
      <div className={styles.setup}>
        <aside className={styles.setupLeft} aria-label="Setup progress">
          <div className={styles.setupHead}>
            <span className={styles.setupKicker}>New project</span>
            <b className={styles.setupName}>{projectName}</b>
          </div>
          <Stepper steps={steps} current={current} />
          <p className={styles.saved}>Progress is saved. You can leave and resume from the project list.</p>
        </aside>
        <main className={styles.setupMain}>
          <div className={styles.setupCol}>
            <div className={styles.setupTitle}>
              <span className={styles.stepOf}>{stepLabel}</span>
              <h1>{title}</h1>
              <p className={styles.intro}>{intro}</p>
            </div>
            {children}
            <div className={styles.setupFoot}>
              {footer.back && <Button variant="ghost" icon="chevron-left" href={footer.back}>Back</Button>}
              <span className={styles.spacer} />
              {footer.skip && <Button variant="ghost" href={footer.skip}>Skip</Button>}
              <Button variant="primary" href={footer.next.href}>{footer.next.label}</Button>
            </div>
          </div>
          {aside && <aside className={styles.setupAside}>{aside}</aside>}
        </main>
      </div>
    </>
  );
}
