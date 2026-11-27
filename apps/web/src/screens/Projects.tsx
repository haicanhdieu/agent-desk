import { useState } from 'react';
import { Button, Dialog } from '@/ds';
import {
  DataTable,
  OnboardingChecklist,
  PageHeader,
  Pagination,
  ProjectRow,
  TopBar,
  useShellOwnsChrome,
  type OnboardingChecklistState,
  type OrgSwitchProps,
  type PaginationProps,
} from '@/components';
import type { Actor, Project } from '@/mocks/types';
import { deleteProjectBody } from './deleteProjectCopy';
import { InvitationsBanner, type InvitationsBannerProps } from './InvitationsBanner';
import { ProjectsEmpty } from './ProjectsEmpty';
import styles from './Screens.module.css';

export interface ProjectsProps {
  user: Actor;
  projects: Project[];
  newHref: string;
  /** Where a project row links (its runs). Defaults to the prototype's `/runs`. */
  projectHref?: (project: Project) => string;
  /** Where a row's "Agent & settings" action goes (the agent page); a row without an href has no such item. */
  settingsHref?: (project: Project) => string | undefined;
  /** Where a row's "Resume setup" button goes; a row without an href has no such button. */
  resumeHref?: (project: Project) => string | undefined;
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
  /** Whether the viewer may create projects (default false: fail closed); hides "New project" without it. */
  canCreate?: boolean;
  /** Deletes a project once the viewer confirmed; a row has no Delete project item without it (fail closed). */
  onDeleteProject?: (project: Project) => void;
}

const intro = 'After sign-in you land on this list. It is one click away on the logo.';

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
  resumeHref,
  switchToPollingHref,
  pagination,
  org,
  checklist,
  invitationsBanner,
  canCreate = false,
  onDeleteProject,
}: ProjectsProps) {
  const owned = useShellOwnsChrome();
  const [confirming, setConfirming] = useState<Project>();
  if (projects.length === 0)
    return (
      <ProjectsEmpty
        user={user}
        createHref={newHref}
        org={org}
        checklist={checklist}
        invitationsBanner={invitationsBanner}
        canCreate={canCreate}
      />
    );
  const newProject = canCreate ? (
    <Button variant="primary" icon="plus" href={newHref}>
      New project
    </Button>
  ) : undefined;
  return (
    <>
      {!owned && (
        <TopBar variant="global" crumbs={[{ label: 'Projects' }]} user={user} org={org} tabs="org" active="projects" />
      )}
      <main className={owned ? styles.shellMain : styles.listMain}>
        {owned ? (
          <PageHeader
            title="Projects"
            meta={<span className="muted">{intro}</span>}
            actions={newProject}
            banner={invitationsBanner && <InvitationsBanner {...invitationsBanner} />}
          />
        ) : (
          <>
            {invitationsBanner && <InvitationsBanner {...invitationsBanner} />}
            <div className={styles.listHead}>
              <h1>Projects</h1>
              {newProject && <div className={styles.listActions}>{newProject}</div>}
            </div>
            <p className={`muted ${styles.listIntro}`}>{intro}</p>
          </>
        )}
        {checklist && <OnboardingChecklist state={checklist} />}
        <DataTable columns={columns} busy={pagination?.busy}>
          {projects.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              href={projectHref(p)}
              settingsHref={settingsHref?.(p)}
              resumeHref={resumeHref?.(p)}
              switchToPollingHref={switchToPollingHref?.(p)}
              {...(onDeleteProject && { onDelete: () => setConfirming(p) })}
            />
          ))}
        </DataTable>
        {pagination && <Pagination {...pagination} />}
        <Dialog
          open={confirming !== undefined}
          title="Delete project"
          onClose={() => setConfirming(undefined)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirming(undefined)}>
                Cancel
              </Button>
              <Button
                variant="solid-danger"
                icon="trash"
                onClick={() => {
                  if (confirming) onDeleteProject?.(confirming);
                  setConfirming(undefined);
                }}
              >
                Delete project
              </Button>
            </>
          }
        >
          <p>
            Delete <b>{confirming?.name}</b>? {deleteProjectBody}
          </p>
        </Dialog>
      </main>
    </>
  );
}
