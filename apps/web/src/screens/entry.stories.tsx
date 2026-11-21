import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { AppShell, RouteSkeleton, TopBar, type OrgSwitchProps } from '@/components';
import { checklistSteps, pagedProjects, projects, user } from '@/mocks';
import type { Actor, OrgOption, Project } from '@/mocks/types';
import { SignIn as SignInScreen, SignInNoInvitationError } from './SignIn';
import { ProjectsEmpty as ProjectsEmptyScreen } from './ProjectsEmpty';
import { Projects as ProjectsScreen } from './Projects';
import { viewport } from './viewports';
import styles from './Screens.module.css';

const noop = () => undefined;

const harbor: OrgOption = { id: 'org-harbor', slug: 'harbor-labs', name: 'Harbor Labs' };
const northwind: OrgOption = { id: 'org-northwind', slug: 'northwind', name: 'Northwind Analytics' };
const riverside: OrgOption = {
  id: 'org-riverside',
  slug: 'riverside',
  name: 'Riverside Municipal Water and Power Utilities Digital Services',
};
const links = { orgHref: (o: OrgOption) => `/o/${o.slug}/projects`, createHref: '/orgs/new' };
const orgOf = (current: OrgOption | null, orgs: OrgOption[], platformAdmin = false): OrgSwitchProps => ({
  current,
  orgs,
  platformAdmin,
  ...links,
});
const loneHarbor = orgOf(harbor, [harbor]);
const loneNorthwind = orgOf(northwind, [northwind]);

const sam: Actor = { login: 'sam-reyes', initials: 'SR' };
const opsAdmin: Actor = { login: 'ops-admin', initials: 'OA' };

/** A new org's one project, no runs yet. */
const forecast: Project = {
  ...projects[0],
  id: 'forecast-service',
  org: 'northwind',
  name: 'forecast-service',
  repo: 'northwind/forecast-service',
  needsYou: 0,
  running: 0,
  queued: 0,
  lastRun: 'None',
};

const invitations = (count: number) => ({ count, href: '#' });
const ready = (steps: typeof checklistSteps.none) => ({ kind: 'ready', steps }) as const;

const meta = {
  title: 'Screens/Entry',
  parameters: { layout: 'fullscreen' },
  globals: viewport(1440, 900),
  decorators: [
    (S) => (
      <AppShell height={900} topBar={null}>
        <S />
      </AppShell>
    ),
  ],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const openSwitch: Story['play'] = async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole('button', { name: /^Switch organization/ }));
};

export const SignIn: Story = {
  name: 'Sign in',
  render: () => <SignInScreen signInHref="#" />,
};
export const ProjectsEmpty: Story = {
  name: 'Projects, empty',
  render: () => <ProjectsEmptyScreen user={user} createHref="#" org={loneHarbor} invitationsHref="#" />,
};
export const Projects: Story = {
  name: 'Projects',
  render: () => <ProjectsScreen user={user} projects={projects} newHref="#" org={loneHarbor} invitationsHref="#" />,
};

/** Page 2 of 2 of 26 projects: "Showing 21–26 of 26". */
export const ProjectsPaged: Story = {
  name: 'Projects, page 2 of 2',
  render: () => (
    <ProjectsScreen
      user={user}
      projects={pagedProjects(26).slice(20)}
      newHref="#"
      org={loneHarbor}
      invitationsHref="#"
      pagination={{
        page: 2,
        pageSize: 20,
        total: 26,
        onPageChange: () => undefined,
        onPageSizeChange: () => undefined,
      }}
    />
  ),
};

/** An owner of a new org: one project, no runs, the checklist half done. */
export const ProjectsChecklist: Story = {
  name: 'Projects, first-run checklist',
  render: () => (
    <ProjectsScreen
      user={user}
      projects={[forecast]}
      newHref="#"
      org={loneNorthwind}
      invitationsHref="#"
      checklist={ready(checklistSteps.partial)}
    />
  ),
};

/** Every step done: the card is gone, and the pending-invitations banner shows. */
export const ProjectsChecklistDone: Story = {
  name: 'Projects, checklist gone, invitations banner',
  render: () => (
    <ProjectsScreen
      user={user}
      projects={projects}
      newHref="#"
      org={orgOf(harbor, [harbor, northwind])}
      invitationsHref="#"
      invitationsBanner={invitations(2)}
    />
  ),
};

export const ProjectsChecklistError: Story = {
  name: 'Projects, checklist failed to load',
  render: () => (
    <ProjectsScreen
      user={user}
      projects={[forecast]}
      newHref="#"
      org={loneNorthwind}
      invitationsHref="#"
      checklist={{ kind: 'error', requestId: 'req_01JD7Q3M8V2K', onRetry: noop }}
    />
  ),
};

export const ProjectsChecklistLoading: Story = {
  name: 'Projects, checklist loading',
  render: () => (
    <ProjectsScreen
      user={user}
      projects={[forecast]}
      newHref="#"
      org={loneNorthwind}
      invitationsHref="#"
      checklist={{ kind: 'loading' }}
    />
  ),
};

export const ProjectsEmptyChecklist: Story = {
  name: 'Projects, empty, live checklist',
  render: () => (
    <ProjectsEmptyScreen
      user={user}
      createHref="#"
      org={loneNorthwind}
      invitationsHref="#"
      checklist={ready(checklistSteps.none)}
    />
  ),
};

export const ProjectsEmptyNoCreate: Story = {
  name: 'Projects, empty, no create rights',
  render: () => <ProjectsEmptyScreen user={sam} createHref="#" org={loneHarbor} canCreate={false} />,
};

/** A member of one org: no switcher menu, no Invitations, no New project. */
export const ProjectsMember: Story = {
  name: 'Projects, member',
  render: () => (
    <ProjectsScreen
      user={sam}
      projects={projects}
      newHref="#"
      org={loneHarbor}
      canCreate={false}
      invitationsBanner={invitations(1)}
    />
  ),
};

/** A member with no role in the org: the access message, with the switcher still usable. */
export const ProjectsNoAccess: Story = {
  name: 'Projects, no access',
  render: () => (
    <>
      <TopBar variant="global" user={sam} org={orgOf(northwind, [northwind, harbor])} />
      <main className={styles.emptyNotice}>
        <div className={styles.emptyNoticeCol}>
          <h1>You don&apos;t have access</h1>
          <p className="muted">Ask an owner of this organization to give you access.</p>
        </div>
      </main>
    </>
  ),
};

export const ProjectsOrgSwitchAdmin: Story = {
  name: 'Projects, platform admin, switcher open',
  render: () => (
    <ProjectsScreen
      user={opsAdmin}
      projects={projects}
      newHref="#"
      org={orgOf(harbor, [harbor], true)}
      invitationsHref="#"
    />
  ),
  play: openSwitch,
};

export const ProjectsOrgSwitchOpen: Story = {
  name: 'Projects, switcher open, several orgs',
  render: () => (
    <ProjectsScreen
      user={user}
      projects={projects}
      newHref="#"
      org={orgOf(harbor, [harbor, northwind, riverside])}
      invitationsHref="#"
    />
  ),
  play: openSwitch,
};

/** The new org is in the top bar while its projects load. */
export const ProjectsSwitching: Story = {
  name: 'Projects, switching org',
  render: () => (
    <>
      <TopBar variant="global" user={user} org={orgOf(northwind, [harbor, northwind])} />
      <main className={styles.listMain}>
        <RouteSkeleton />
      </main>
    </>
  ),
};

export const SignInNoInvitation: Story = {
  name: 'Sign in, no invitation',
  render: () => <SignInScreen signInHref="#" error={<SignInNoInvitationError />} />,
};
