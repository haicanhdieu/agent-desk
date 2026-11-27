import { Button } from '@/ds';
import {
  OnboardingChecklist,
  PageHeader,
  StepCardGrid,
  TopBar,
  useShellOwnsChrome,
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
  /** Whether the viewer may create projects (default false: fail closed); without it the page only explains who does. */
  canCreate?: boolean;
}

const createLead =
  'A project connects one GitHub repository. Setup takes about five minutes, and you finish ready to trigger a run from an issue comment.';

const steps = [
  { title: 'Connect a repo', body: 'Install the GitHub App on one repository.' },
  { title: 'Add an agent', body: 'Choose the agent you work with and add its credential.' },
  { title: 'Add skills', body: 'Start from templates or use skills already in the repo.' },
  { title: 'Add a rule', body: 'Map a comment like /code-build to a skill.' },
];

export function ProjectsEmpty({
  user,
  createHref,
  org,
  checklist,
  invitationsBanner,
  canCreate = false,
}: ProjectsEmptyProps) {
  const owned = useShellOwnsChrome();
  const bar = !owned && (
    <TopBar variant="global" crumbs={[{ label: 'Projects' }]} user={user} org={org} tabs="org" active="projects" />
  );
  if (!canCreate) {
    return (
      <>
        {bar}
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
  const body = (
    <>
      {checklist ? <OnboardingChecklist state={checklist} /> : <StepCardGrid steps={steps} />}
      <div className={styles.emptyActions}>
        <Button variant="primary" size="lg" icon="plus" href={createHref}>
          Create project
        </Button>
        <span className={`faint ${styles.emptyNote}`}>
          You can delete a project at any time. Nothing is written to the repo until you save a skill.
        </span>
      </div>
    </>
  );
  if (owned) {
    return (
      <main className={styles.shellMain}>
        <PageHeader
          title="Create your first project"
          meta={<span className="muted">{createLead}</span>}
          banner={invitationsBanner && <InvitationsBanner {...invitationsBanner} />}
        />
        {body}
      </main>
    );
  }
  return (
    <>
      {bar}
      <main className={styles.emptyMain}>
        <div className={styles.emptyCol}>
          {invitationsBanner && <InvitationsBanner {...invitationsBanner} />}
          <div className={styles.emptyHead}>
            <h1>Create your first project</h1>
            <p className="muted">{createLead}</p>
          </div>
          {body}
        </div>
      </main>
    </>
  );
}
