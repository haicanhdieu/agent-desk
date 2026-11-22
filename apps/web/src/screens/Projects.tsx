import { Button } from '@/ds';
import {
  DataTable,
  OnboardingChecklist,
  Pagination,
  ProjectRow,
  TopBar,
  type OnboardingChecklistState,
  type OrgSwitchProps,
  type PaginationProps,
} from '@/components';
import type { Actor, Project } from '@/mocks/types';
import { InvitationsBanner, type InvitationsBannerProps } from './InvitationsBanner';
import { ProjectsEmpty } from './ProjectsEmpty';
import styles from './Screens.module.css';

export interface ProjectsProps {
  user: Actor;
  projects: Project[];
  newHref: string;
  /** Where a project row links (its runs). Defaults to the prototype's `/runs`. */
  projectHref?: (project: Project) => string;
  /** Where a row's More menu Settings goes (the project's settings); a row without an href has no Settings item. */
  settingsHref?: (project: Project) => string | undefined;
  /** Where a row's "Switch to polling" goes (the project's settings); a row without an href has no such button. */
  switchToPollingHref?: (project: Project) => string | undefined;
  /** The paging control under the table; its `busy` marks the table aria-busy. */
  pagination?: PaginationProps;
  /** The org switcher in the top bar. */
  org?: OrgSwitchProps;
  /** The first-run checklist card between the page head and the table. */
  checklist?: OnboardingChecklistState;
  /** The pending-invitations strip above the page head. */
  invitationsBanner?: InvitationsBannerProps;
  /** The org's Invitations page; the header button shows only when given. */
  invitationsHref?: string;
  /** Whether the viewer may create projects (default false: fail closed); hides "New project" without it. */
  canCreate?: boolean;
}

const columns = [
  { key: 'project', header: 'Project' },
  { key: 'github', header: 'GitHub' },
  { key: 'needs', header: 'Needs you' },
  { key: 'running', header: 'Running' },
  { key: 'queued', header: 'Queued' },
  { key: 'last', header: 'Last run' },
  { key: 'more', header: <span className="sr-only">Actions</span> },
];

export function Projects({
  user,
  projects,
  newHref,
  projectHref = () => '/runs',
  settingsHref,
  switchToPollingHref,
  pagination,
  org,
  checklist,
  invitationsBanner,
  invitationsHref,
  canCreate = false,
}: ProjectsProps) {
  if (projects.length === 0)
    return (
      <ProjectsEmpty
        user={user}
        createHref={newHref}
        org={org}
        checklist={checklist}
        invitationsBanner={invitationsBanner}
        invitationsHref={invitationsHref}
        canCreate={canCreate}
      />
    );
  return (
    <>
      <TopBar variant="global" user={user} org={org} />
      <main className={styles.listMain}>
        {invitationsBanner && <InvitationsBanner {...invitationsBanner} />}
        <div className={styles.listHead}>
          <h1>Projects</h1>
          {(invitationsHref || canCreate) && (
            <div className={styles.listActions}>
              {invitationsHref && <Button href={invitationsHref}>Invitations</Button>}
              {canCreate && (
                <Button variant="primary" icon="plus" href={newHref}>
                  New project
                </Button>
              )}
            </div>
          )}
        </div>
        <p className={`muted ${styles.listIntro}`}>
          After sign-in you land on the runs of the project you used last. This list is one click away on the logo.
        </p>
        {checklist && <OnboardingChecklist state={checklist} />}
        <DataTable columns={columns} busy={pagination?.busy}>
          {projects.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              href={projectHref(p)}
              settingsHref={settingsHref?.(p)}
              switchToPollingHref={switchToPollingHref?.(p)}
            />
          ))}
        </DataTable>
        {pagination && <Pagination {...pagination} />}
      </main>
    </>
  );
}
