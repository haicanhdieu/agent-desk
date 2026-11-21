import { Button } from '@/ds';
import {
  OnboardingChecklist,
  StepCardGrid,
  TopBar,
  type OnboardingChecklistState,
  type OrgSwitchProps,
} from '@/components';
import type { Actor } from '@/mocks/types';
import { InvitationsBanner, type InvitationsBannerProps } from './InvitationsBanner';
import styles from './Screens.module.css';

export interface ProjectsEmptyProps {
  user: Actor;
  createHref: string;
  /** The org switcher in the top bar. */
  org?: OrgSwitchProps;
  /** The first-run checklist; it replaces the static step cards. */
  checklist?: OnboardingChecklistState;
  invitationsBanner?: InvitationsBannerProps;
  /** The org's Invitations page; the button shows only when given. */
  invitationsHref?: string;
  /** Whether the viewer may create projects (default true); without it the page only explains who does. */
  canCreate?: boolean;
}

const steps = [
  { title: 'Connect a repo', body: 'Install the GitHub App on one repository.' },
  { title: 'Add Claude', body: 'Paste an API key or Claude Code token.' },
  { title: 'Add skills', body: 'Start from templates or use skills already in the repo.' },
  { title: 'Add a rule', body: 'Map a comment like /code-build to a skill.' },
];

export function ProjectsEmpty({
  user,
  createHref,
  org,
  checklist,
  invitationsBanner,
  invitationsHref,
  canCreate = true,
}: ProjectsEmptyProps) {
  if (!canCreate) {
    return (
      <>
        <TopBar variant="global" user={user} org={org} />
        <main className={styles.emptyNotice}>
          <div className={styles.emptyNoticeCol}>
            {invitationsBanner && <InvitationsBanner {...invitationsBanner} />}
            <h1>No projects yet</h1>
            <p className="muted">An owner or admin of this organization creates projects.</p>
          </div>
        </main>
      </>
    );
  }
  return (
    <>
      <TopBar variant="global" user={user} org={org} />
      <main className={styles.emptyMain}>
        <div className={styles.emptyCol}>
          {invitationsBanner && <InvitationsBanner {...invitationsBanner} />}
          <div className={styles.emptyHead}>
            <h1>Create your first project</h1>
            <p className="muted">
              A project connects one GitHub repository. Setup takes about five minutes, and you finish ready to trigger
              a run from an issue comment.
            </p>
          </div>
          {checklist ? <OnboardingChecklist state={checklist} /> : <StepCardGrid steps={steps} />}
          <div className={styles.emptyActions}>
            <Button variant="primary" size="lg" icon="plus" href={createHref}>
              Create project
            </Button>
            {invitationsHref && (
              <Button size="lg" href={invitationsHref}>
                Invitations
              </Button>
            )}
            <span className={`faint ${styles.emptyNote}`}>
              You can delete a project at any time. Nothing is written to the repo until you save a skill.
            </span>
          </div>
        </div>
      </main>
    </>
  );
}
