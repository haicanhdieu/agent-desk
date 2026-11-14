import { Button } from '@/ds';
import { StepCardGrid, TopBar } from '@/components';
import type { Actor } from '@/mocks/types';
import styles from './Screens.module.css';

export interface ProjectsEmptyProps {
  user: Actor;
  createHref: string;
}

const steps = [
  { title: 'Connect a repo', body: 'Install the GitHub App on one repository.' },
  { title: 'Add Claude', body: 'Paste an API key or Claude Code token.' },
  { title: 'Add skills', body: 'Start from templates or use skills already in the repo.' },
  { title: 'Add a rule', body: 'Map a comment like /code-build to a skill.' },
];

export function ProjectsEmpty({ user, createHref }: ProjectsEmptyProps) {
  return (
    <>
      <TopBar variant="global" user={user} />
      <main className={styles.emptyMain}>
        <div className={styles.emptyCol}>
          <div className={styles.emptyHead}>
            <h1>Create your first project</h1>
            <p className="muted">
              A project connects one GitHub repository. Setup takes about five minutes, and you finish ready to trigger
              a run from an issue comment.
            </p>
          </div>
          <StepCardGrid steps={steps} />
          <div className={styles.emptyActions}>
            <Button variant="primary" size="lg" icon="plus" href={createHref}>
              Create project
            </Button>
            <span className={`faint ${styles.emptyNote}`}>
              You can delete a project at any time. Nothing is written to the repo until you save a skill.
            </span>
          </div>
        </div>
      </main>
    </>
  );
}
