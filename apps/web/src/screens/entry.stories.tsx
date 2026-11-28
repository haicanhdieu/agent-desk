import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState, type ReactNode } from 'react';
import { userEvent, waitFor, within } from 'storybook/test';
import { EmptyState, NO_PAGE_CRUMBS, RouteLoadError, RouteSkeleton, type OrgSwitchProps } from '@/components';
import { Button } from '@/ds';
import { checklistSteps, pagedProjects, projects, user } from '@/mocks';
import type { Actor, OrgOption, Project } from '@/mocks/types';
import { SignIn as SignInScreen, SignInNoInvitationError } from './SignIn';
import { ProjectsEmpty as ProjectsEmptyBase, type ProjectsEmptyProps } from './ProjectsEmpty';
import { Projects as ProjectsBase, type ProjectsProps } from './Projects';
import { OrgSuspended as OrgSuspendedScreen } from './OrgSuspended';
import { OrgShellFrame } from './orgShellFrame';
import { ProjectShellFrame } from './projectShellFrame';
import { ShellFrame } from './shellFrame';
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
const links = { orgHref: (o: OrgOption) => `/o/${o.slug}/projects`, createHref: '/platform/orgs/new' };
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

/** The Projects pages of the older boards: the page in the organization shell, with the person and org of the bar. */
const projectsFrame = (user: Actor, org: OrgSwitchProps, page: ReactNode) => (
  <OrgShellFrame viewer="owner" page="projects" user={user} org={org} crumbs={[{ label: 'Projects' }]}>
    {page}
  </OrgShellFrame>
);
const ProjectsScreen = ({ user, org, ...props }: ProjectsProps & { user: Actor; org: OrgSwitchProps }) =>
  projectsFrame(user, org, <ProjectsBase {...props} />);
const ProjectsEmptyScreen = ({ user, org, ...props }: ProjectsEmptyProps & { user: Actor; org: OrgSwitchProps }) =>
  projectsFrame(user, org, <ProjectsEmptyBase {...props} />);

const invitations = (count: number) => ({ count, href: '#' });
const ready = (steps: typeof checklistSteps.none) => ({ kind: 'ready', steps }) as const;

const meta = {
  title: 'Screens/Entry',
  parameters: { layout: 'fullscreen' },
  globals: viewport(1440, 900),
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const openSwitch: Story['play'] = async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole('button', { name: /^Switch scope/ }));
};

export const SignIn: Story = {
  name: 'Sign in',
  render: () => <SignInScreen signInHref="#" />,
};
export const ProjectsEmpty: Story = {
  name: 'Projects, empty',
  render: () => <ProjectsEmptyScreen user={user} createHref="#" org={loneHarbor} canCreate />,
};
export const Projects: Story = {
  name: 'Projects',
  render: () => (
    <ProjectsScreen
      user={user}
      projects={projects}
      newHref="#"
      org={loneHarbor}
      canCreate
      settingsHref={() => '#settings'}
    />
  ),
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
      canCreate
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
      canCreate
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
      canCreate
      invitationsBanner={invitations(2)}
    />
  ),
};

/** An owner or admin: Projects tab active, Settings tab in the bar, no Settings or Invitations button in the head. */
export const ProjectsChecklistDoneSettings: Story = {
  name: 'Projects, owner, Settings tab',
  render: () => (
    <ProjectsScreen
      user={user}
      projects={projects}
      newHref="#"
      org={orgOf(harbor, [harbor, northwind])}
      canCreate
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
      canCreate
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
      canCreate
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
      canCreate
      checklist={ready(checklistSteps.none)}
    />
  ),
};

export const ProjectsEmptyChecklistSettings: Story = {
  name: 'Projects, empty, owner, Settings tab',
  render: () => (
    <ProjectsEmptyScreen
      user={user}
      createHref="#"
      org={loneNorthwind}
      canCreate
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
  render: () =>
    projectsFrame(
      sam,
      orgOf(northwind, [northwind, harbor]),
      <main className={styles.emptyNotice}>
        <div className={styles.emptyNoticeCol}>
          <h1>You don&apos;t have access</h1>
          <p className="muted">Ask an owner of this organization to give you access.</p>
        </div>
      </main>,
    ),
};

export const ProjectsOrgSwitchAdmin: Story = {
  name: 'Projects, platform admin, switcher open',
  render: () => (
    <ProjectsScreen user={opsAdmin} projects={projects} newHref="#" org={orgOf(harbor, [harbor], true)} canCreate />
  ),
  play: openSwitch,
};

export const ProjectsOrgSwitchAdminPlatform: Story = {
  name: 'Projects, platform admin, switcher open with Platform admin above Create organization',
  render: () => (
    <ProjectsScreen
      user={opsAdmin}
      projects={projects}
      newHref="#"
      org={{ ...orgOf(harbor, [harbor], true), platformHref: '/platform/orgs' }}
      canCreate
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
      canCreate
    />
  ),
  play: openSwitch,
};

/** The new org is in the top bar while its projects load. */
export const ProjectsSwitching: Story = {
  name: 'Projects, switching org',
  render: () =>
    projectsFrame(
      user,
      orgOf(northwind, [harbor, northwind]),
      <main className={styles.shellMain}>
        <RouteSkeleton />
      </main>,
    ),
};

export const SignInNoInvitation: Story = {
  name: 'Sign in, no invitation',
  render: () => <SignInScreen signInHref="#" error={<SignInNoInvitationError />} />,
};

export const SignInProofOfConcept: Story = {
  name: 'Sign in, shortened footer',
  render: () => <SignInScreen signInHref="#" />,
};

/** A member of a suspended org: the top bar keeps the org name and the switcher, with no Projects or Settings tabs. */
const suspendedOrg = { ...harbor, suspended: true };
const suspendedOrgs: OrgOption[] = [suspendedOrg, northwind, riverside];
const suspended = (user: Actor, org: OrgSwitchProps) => (
  <ShellFrame topBar={{ user, crumbs: NO_PAGE_CRUMBS, org }}>
    <OrgSuspendedScreen orgName={harbor.name} />
  </ShellFrame>
);

export const OrgSuspended: Story = {
  name: 'Organization suspended, fixed message for every member, no reason',
  render: () => suspended(user, orgOf(suspendedOrg, suspendedOrgs)),
};

export const OrgSuspendedSwitcher: Story = {
  name: 'Organization suspended, switcher open: the suspended org is marked, other orgs open',
  render: () => suspended(user, orgOf(suspendedOrg, suspendedOrgs)),
  play: openSwitch,
};

export const OrgSuspendedPlatformAdmin: Story = {
  name: 'Organization suspended, a platform admin still has Platform admin in the switcher',
  render: () => suspended(opsAdmin, { ...orgOf(suspendedOrg, [suspendedOrg], true), platformHref: '/platform/orgs' }),
  play: openSwitch,
};

// The organization screens in the one shell: the page draws only its header and body, the shell draws the bar and the
// "Organization menu".
const projectsCrumbs = [{ label: 'Projects' }];
const severalOrgs = orgOf(harbor, [harbor, northwind, riverside]);
const shellStory = (story: Story): Story => ({ ...story, parameters: { ...story.parameters, shell: true } });
const projectsPage = (o: { canCreate?: boolean; resume?: boolean } = {}) => (
  <ProjectsBase
    projects={projects}
    newHref="#"
    canCreate={o.canCreate ?? true}
    settingsHref={() => '#settings'}
    switchToPollingHref={() => '#polling'}
    {...(o.resume && { resumeHref: (p: Project) => (p.id === projects[0]?.id ? '#resume' : undefined) })}
  />
);

export const ProjectsSideMenu: Story = shellStory({
  name: 'Projects, organization menu (owner)',
  render: () => (
    <OrgShellFrame viewer="owner" page="projects" org={severalOrgs} crumbs={projectsCrumbs}>
      {projectsPage()}
    </OrgShellFrame>
  ),
});
export const ProjectsMemberSideMenu: Story = shellStory({
  name: 'Projects, organization menu (member or viewer)',
  render: () => (
    <OrgShellFrame viewer="member" page="projects" user={sam} crumbs={projectsCrumbs}>
      {projectsPage({ canCreate: false })}
    </OrgShellFrame>
  ),
});
export const ProjectsSideMenuPlatformAdmin: Story = shellStory({
  name: 'Projects, menu with Manage in Platform (platform admin)',
  render: () => (
    <OrgShellFrame
      viewer="platformAdmin"
      page="projects"
      user={opsAdmin}
      org={{ ...orgOf(harbor, [harbor], true), platformHref: '/platform/orgs' }}
      crumbs={projectsCrumbs}
    >
      {projectsPage()}
    </OrgShellFrame>
  ),
});
export const ProjectsSideOneOrg: Story = shellStory({
  name: 'One organization: plain organization name',
  render: () => (
    <OrgShellFrame viewer="owner" page="projects" org={loneHarbor} crumbs={projectsCrumbs}>
      {projectsPage()}
    </OrgShellFrame>
  ),
});
export const ProjectsSideSwitcherOpen: Story = shellStory({
  name: 'Organization switcher open',
  render: () => (
    <OrgShellFrame viewer="owner" page="projects" org={severalOrgs} crumbs={projectsCrumbs}>
      {projectsPage()}
    </OrgShellFrame>
  ),
  play: openSwitch,
});
/** The org list is still loading: the content waits, the menu holds only Projects, the switcher says "Organization". */
export const ProjectsSideSwitcherLoading: Story = shellStory({
  name: 'Organization switcher, list loading',
  render: () => (
    <OrgShellFrame
      viewer="member"
      page="projects"
      org={{ ...severalOrgs, current: null, orgs: [], list: { status: 'loading' } }}
      crumbs={projectsCrumbs}
    >
      <main className={styles.shellMain} aria-busy="true">
        <RouteSkeleton />
      </main>
    </OrgShellFrame>
  ),
  play: openSwitch,
});
export const ProjectsSideSwitcherError: Story = shellStory({
  name: 'Organization switcher, list could not load',
  render: () => (
    <OrgShellFrame
      viewer="error"
      page="projects"
      org={{ ...severalOrgs, current: null, orgs: [], list: { status: 'error', onRetry: noop } }}
      crumbs={projectsCrumbs}
    >
      <main className={styles.shellMain}>
        <RouteLoadError title="Internal server error" onRetry={noop} />
      </main>
    </OrgShellFrame>
  ),
  play: openSwitch,
});

/** Opened while the list loads, then the list arrives with one org: the switcher stays a button until it is closed. */
function HeldOneOrg() {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 50);
    return () => clearTimeout(t);
  }, []);
  const org: OrgSwitchProps = loaded
    ? loneHarbor
    : { ...loneHarbor, current: null, orgs: [], list: { status: 'loading' } };
  return (
    <OrgShellFrame viewer="member" page="projects" org={org} user={sam} crumbs={projectsCrumbs}>
      {projectsPage({ canCreate: false })}
    </OrgShellFrame>
  );
}
export const ProjectsSideSwitcherOneOrgHeld: Story = shellStory({
  name: 'Organization switcher held open with one organization',
  render: () => <HeldOneOrg />,
  play: async (ctx) => {
    await openSwitch(ctx);
    await waitFor(() => within(ctx.canvasElement).getByRole('link', { name: /Harbor Labs/ }));
  },
});
export const ProjectsSideAccountMenu: Story = shellStory({
  name: 'Account menu with My invitations',
  render: () => (
    <OrgShellFrame viewer="owner" page="projects" org={severalOrgs} crumbs={projectsCrumbs}>
      {projectsPage()}
    </OrgShellFrame>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /^Account menu for/ }));
  },
});
export const ProjectsResumeSetup: Story = shellStory({
  name: 'Projects, a row with Resume setup',
  render: () => (
    <OrgShellFrame viewer="owner" page="projects" org={severalOrgs} crumbs={projectsCrumbs}>
      {projectsPage({ resume: true })}
    </OrgShellFrame>
  ),
});

// Route states in the one shell: the route's own main holds the skeleton, the banner or the message; the menu is the
// deepest scope in the URL the person can open, and none when the URL names none.
const runsCrumbs = [{ label: 'Runs' }];
const inProject = (page: ReactNode) => (
  <ProjectShellFrame page="runs" crumbs={runsCrumbs}>
    <main className={styles.shellMain}>{page}</main>
  </ProjectShellFrame>
);
const noMenuShell = (page: ReactNode, org: OrgSwitchProps = severalOrgs) => (
  <ShellFrame topBar={{ user, crumbs: NO_PAGE_CRUMBS, org }}>
    <main className={styles.shellMain}>{page}</main>
  </ShellFrame>
);
const crash = (
  <EmptyState
    headingLevel={1}
    title="Something went wrong"
    body="An unexpected error stopped this page. Reload to try again."
    action={<Button icon="refresh">Reload</Button>}
  >
    <p>
      Request ID: <code>req_01JD7Q3M8V2K</code>
    </p>
  </EmptyState>
);

export const RouteLoadingSideMenu: Story = shellStory({
  name: 'Page loading with the project menu',
  render: () => inProject(<RouteSkeleton />),
});
export const RouteErrorSideMenu: Story = shellStory({
  name: 'Server error with the project menu',
  render: () => inProject(<RouteLoadError title="Internal server error" requestId="req_01JD7Q3M8V2K" onRetry={noop} />),
});
export const RouteErrorCrashSideMenu: Story = shellStory({
  name: 'Crash with the project menu',
  render: () => inProject(crash),
});
export const RouteErrorNoMenu: Story = shellStory({
  name: 'Server error with no menu',
  render: () =>
    noMenuShell(<RouteLoadError title="Internal server error" requestId="req_01JD7Q3M8V2K" onRetry={noop} />),
});
export const RouteErrorNotFoundNoMenu: Story = shellStory({
  name: 'Not found with no menu',
  render: () =>
    noMenuShell(
      <EmptyState
        headingLevel={1}
        title="Page not found"
        body="This page does not exist, or it belongs to an organization you are not in."
        action={
          <Button href="/" variant="primary">
            Go to projects
          </Button>
        }
      />,
    ),
});

const suspendedShell = (org: OrgSwitchProps) => (
  <ShellFrame topBar={{ user, crumbs: NO_PAGE_CRUMBS, org }}>
    <OrgSuspendedScreen orgName={harbor.name} />
  </ShellFrame>
);
export const OrgSuspendedNoMenu: Story = shellStory({
  name: 'Suspended organization: no menu, switcher kept',
  render: () => suspendedShell(orgOf(suspendedOrg, suspendedOrgs)),
});
export const OrgSuspendedPlainName: Story = shellStory({
  name: 'Suspended only organization: plain name',
  render: () => suspendedShell(orgOf(suspendedOrg, [suspendedOrg])),
});

// BR-65: the entry and error pages at 390x844 (phone boards).
const phoneStory = (story: Story): Story => ({ ...shellStory(story), globals: viewport(390, 844) });

export const SignInPhone: Story = phoneStory({
  name: 'Phone: sign in',
  render: () => <SignInScreen signInHref="#" />,
});
export const OrgSuspendedPhone: Story = phoneStory({
  name: 'Phone: organization suspended',
  render: () => suspendedShell(orgOf(suspendedOrg, suspendedOrgs)),
});
export const RouteErrorPhone: Story = phoneStory({
  name: 'Phone: page failed to load',
  render: () => inProject(<RouteLoadError title="Internal server error" requestId="req_01JD7Q3M8V2K" onRetry={noop} />),
});
