import type { ReactElement } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouteLoadError, RouteSkeleton, type PaginationProps } from '@/components';
import { checklistSteps, orgSwitchFixtures, projects, user } from '@/mocks';
import { SignIn, SignInNoInvitationError } from './SignIn';
import { ProjectsEmpty } from './ProjectsEmpty';
import { Projects } from './Projects';
import { OrgSuspended } from './OrgSuspended';
import { OrgShellFrame } from './orgShellFrame';
import { ShellFrame } from './shellFrame';
import { expectShellOwnedPage, headerActions } from '@/test/shellAssert';

describe('SignIn', () => {
  it('BR-76: says Proof of concept and nothing about a single user per project', () => {
    const { container } = render(<SignIn signInHref="/x" />);
    expect(screen.getByText('Proof of concept.')).toBeInTheDocument();
    expect(container).not.toHaveTextContent('Single user per project');
  });

  it('links "Sign in with GitHub" to signInHref', () => {
    render(<SignIn signInHref="/auth/github" />);
    expect(screen.getByRole('link', { name: 'Sign in with GitHub' })).toHaveAttribute('href', '/auth/github');
  });

  it('lists the four steps of one ticket, two runs, the 4th with the idle pill', () => {
    render(<SignIn signInHref="/x" />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(within(items[3]).getByTitle('status: idle')).toHaveTextContent('Needs you');
    expect(within(items[1]).getByTitle('status: running')).toBeInTheDocument();
  });
});

describe('ProjectsEmpty', () => {
  it('renders the four setup steps and a create link', () => {
    render(<ProjectsEmpty user={user} createHref="/new" canCreate />);
    expect(screen.getByRole('heading', { level: 1, name: 'Create your first project' })).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'Create project' })).toHaveAttribute('href', '/new');
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });
  it('names the agent step "Add an agent", for any provider', () => {
    render(<ProjectsEmpty user={user} createHref="/new" canCreate />);
    expect(screen.getByText('Add an agent')).toBeInTheDocument();
    expect(screen.getByText('Choose the agent you work with and add its credential.')).toBeInTheDocument();
    expect(screen.queryByText('Add Claude')).toBeNull();
  });
});

describe('Projects', () => {
  it('shows the empty-state content when there are no projects', () => {
    render(<Projects user={user} projects={[]} newHref="/new" canCreate />);
    expect(screen.getByText('Create your first project')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create project' })).toHaveAttribute('href', '/new');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('has one main landmark, an h1 and a New project link', () => {
    render(<Projects user={user} projects={projects} newHref="/new" canCreate />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New project' })).toHaveAttribute('href', '/new');
  });

  it('shows the "1 run" pill only when needsYou > 0, else None', () => {
    render(<Projects user={user} projects={projects} newHref="/new" />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('1 run')).toBeInTheDocument();
    expect(within(rows[0]).getByTitle('status: idle')).toBeInTheDocument();
    expect(within(rows[1]).getByText('None')).toBeInTheDocument();
    expect(within(rows[1]).queryByText('1 run')).not.toBeInTheDocument();
  });

  it('shows connection status text, with the succeeded glyph for Connected', () => {
    render(<Projects user={user} projects={projects} newHref="/new" />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Connected')).toBeInTheDocument();
    expect(within(rows[0]).getByTitle('status: succeeded')).toBeInTheDocument();
    expect(within(rows[2]).getByText('No webhooks for 2 days')).toBeInTheDocument();
  });

  it('colors only the Connected glyph, and the warning row with the idle tone', () => {
    render(<Projects user={user} projects={projects} newHref="/new" />);
    const rows = screen.getAllByRole('row').slice(1);
    const connected = within(rows[0]).getByText('Connected');
    expect(connected.closest('.ok')).toBeNull();
    expect(connected.closest('.inline-status')).toBeNull();
    expect(within(rows[0]).getByTitle('status: succeeded')).toBeInTheDocument();
    const warn = within(rows[2]).getByText('No webhooks for 2 days').closest('.inline-status');
    expect(warn).toHaveClass('idle');
  });

  it('shows polling status: ok with the succeeded glyph, failure with the failed glyph and err tone', () => {
    render(<Projects user={user} projects={projects} newHref="/new" />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[1]).getByText('Polling every 5 min')).toBeInTheDocument();
    expect(within(rows[1]).getByTitle('status: succeeded')).toBeInTheDocument();
    const failed = within(rows[3]).getByText('Polling failed: rate limited, retry in 5 min');
    expect(failed.closest('.inline-status')).toHaveClass('err');
    expect(within(rows[3]).getByTitle('status: failed')).toBeInTheDocument();
  });

  it('offers Switch to polling only on the silent-webhook row', () => {
    render(<Projects user={user} projects={projects} newHref="/new" switchToPollingHref={() => '/settings'} />);
    const links = screen.getAllByRole('link', { name: /^Switch to polling/ });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName('Switch to polling for docs-site');
    expect(links[0]).toHaveTextContent('Switch to polling');
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[2]).getByRole('link', { name: /Switch to polling/ })).toBe(links[0]);
  });

  it('truncates a very long repo name and keeps the full text in title', () => {
    const repo = `harbor-labs/${'a'.repeat(68)}`;
    expect(repo).toHaveLength(80);
    render(<Projects user={user} newHref="/new" projects={[{ ...projects[0], repo }]} />);
    const el = screen.getByText(repo);
    expect(el).toHaveAttribute('title', repo);
    expect(el).toHaveClass('repo');
  });

  it('gives each row a project link and a labelled More button', () => {
    render(<Projects user={user} projects={projects} newHref="/new" />);
    expect(screen.getByRole('link', { name: 'docs-site' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More for docs-site' })).toBeInTheDocument();
  });
});

describe('Projects pagination', () => {
  it('Projects draws the control under the table', () => {
    const pagination: PaginationProps = {
      page: 2,
      pageSize: 20,
      total: 26,
      onPageChange: () => undefined,
      onPageSizeChange: () => undefined,
    };
    render(<Projects user={user} projects={projects} newHref="/new" pagination={pagination} />);
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(screen.getByRole('table').compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav).toHaveTextContent('Showing 21–26 of 26');
  });
});

const orgLinks = { orgHref: (o: { slug: string }) => `/o/${o.slug}/projects`, createHref: '/orgs/new' };
const ready = { kind: 'ready', steps: checklistSteps.partial } as const;

describe('Projects onboarding', () => {
  it('says "You have 1 pending invitation." with a View link above the page head', () => {
    render(
      <Projects
        user={user}
        projects={projects}
        newHref="/new"
        invitationsBanner={{ count: 1, href: '/invitations' }}
      />,
    );
    const banner = screen.getByText('You have 1 pending invitation.');
    expect(
      within(banner.closest('[role="status"]') as HTMLElement).getByRole('link', { name: 'View' }),
    ).toHaveAttribute('href', '/invitations');
    const h1 = screen.getByRole('heading', { level: 1, name: 'Projects' });
    expect(banner.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says "You have 2 pending invitations." for a plural count', () => {
    render(
      <Projects
        user={user}
        projects={projects}
        newHref="/new"
        invitationsBanner={{ count: 2, href: '/invitations' }}
      />,
    );
    expect(screen.getByText('You have 2 pending invitations.')).toBeInTheDocument();
  });

  it('hides the banner when the count is 0', () => {
    render(
      <Projects
        user={user}
        projects={projects}
        newHref="/new"
        invitationsBanner={{ count: 0, href: '/invitations' }}
      />,
    );
    expect(screen.queryByText(/pending invitation/)).not.toBeInTheDocument();
  });

  it('shows no banner without invitationsBanner', () => {
    render(<Projects user={user} projects={projects} newHref="/new" />);
    expect(screen.queryByText(/pending invitation/)).not.toBeInTheDocument();
  });

  it('TC-49.1: the header has New project and no Settings or Invitations button', () => {
    render(<Projects user={user} projects={projects} newHref="/new" canCreate />);
    const main = screen.getByRole('main');
    expect(within(main).getByRole('link', { name: 'New project' })).toBeInTheDocument();
    expect(within(main).queryByRole('link', { name: /^(Org settings|Invitations)$/ })).not.toBeInTheDocument();
  });

  it('shows no New project and no Settings or Switch to polling without their hrefs', async () => {
    render(<Projects user={user} projects={projects} newHref="/new" />);
    expect(screen.queryByRole('link', { name: 'New project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Switch to polling/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'More for docs-site' }));
    expect(screen.getByRole('link', { name: 'Runs' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Agent & settings' })).not.toBeInTheDocument();
  });

  it('has no Delete project item without onDeleteProject (fail closed)', async () => {
    render(<Projects user={user} projects={projects} newHref="/new" />);
    await userEvent.click(screen.getByRole('button', { name: 'More for docs-site' }));
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
  });

  it('Delete project confirms first, then hands the project to onDeleteProject', async () => {
    const onDeleteProject = vi.fn();
    render(<Projects user={user} projects={projects} newHref="/new" onDeleteProject={onDeleteProject} />);
    await userEvent.click(screen.getByRole('button', { name: 'More for docs-site' }));
    const item = screen.getByRole('button', { name: 'Delete project' });
    expect(item).toHaveClass('danger');
    await userEvent.click(item);
    const dialog = screen.getByRole('dialog', { name: 'Delete project' });
    expect(dialog).toHaveTextContent('docs-site');
    expect(onDeleteProject).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete project' }));
    expect(onDeleteProject).toHaveBeenCalledTimes(1);
    expect(onDeleteProject.mock.calls[0]?.[0]).toMatchObject({ name: 'docs-site' });
    expect(screen.queryByRole('dialog', { name: 'Delete project' })).not.toBeInTheDocument();
  });

  it('BR-28: shows Agent & settings, not Settings, in the row menu when the row has a settings href', async () => {
    render(<Projects user={user} projects={projects} newHref="/new" settingsHref={() => '/settings'} />);
    await userEvent.click(screen.getByRole('button', { name: 'More for docs-site' }));
    expect(screen.getByRole('link', { name: 'Agent & settings' })).toHaveAttribute('href', '/settings');
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('shows Resume setup before More only for a row with a resume href', () => {
    render(
      <Projects
        user={user}
        projects={projects}
        newHref="/new"
        resumeHref={(p) => (p.name === 'docs-site' ? '/resume' : undefined)}
      />,
    );
    expect(screen.getByRole('link', { name: 'Resume setup for docs-site' })).toHaveAttribute('href', '/resume');
    expect(screen.getAllByRole('link', { name: /^Resume setup for/ })).toHaveLength(1);
  });

  it('BR-75: the intro reads the new sentence', () => {
    render(<Projects user={user} projects={projects} newHref="/new" />);
    expect(
      screen.getByText('After sign-in you land on this list. It is one click away on the logo.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/last used/i)).not.toBeInTheDocument();
  });

  it('a member view has no Invitations and no New project', () => {
    render(<Projects user={user} projects={projects} newHref="/new" canCreate={false} />);
    expect(screen.queryByRole('link', { name: 'Invitations' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New project' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
  });

  it('puts the checklist card between the page head and the table', () => {
    render(<Projects user={user} projects={projects} newHref="/new" checklist={ready} />);
    const card = screen.getByRole('heading', { level: 2, name: 'Get started' });
    const h1 = screen.getByRole('heading', { level: 1, name: 'Projects' });
    const table = screen.getByRole('table');
    expect(h1.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the org switcher in the top bar', () => {
    render(
      <Projects
        user={user}
        projects={projects}
        newHref="/new"
        org={{ ...orgSwitchFixtures.severalOrgs, ...orgLinks }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Switch scope, currently organization Acme' })).toBeInTheDocument();
  });
});

describe('ProjectsEmpty onboarding', () => {
  it('renders the checklist instead of the step cards', () => {
    render(<ProjectsEmpty user={user} createHref="/new" checklist={ready} canCreate />);
    expect(screen.getByRole('heading', { level: 2, name: 'Get started' })).toBeInTheDocument();
    expect(screen.queryByText('Connect a repo')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create project' })).toHaveAttribute('href', '/new');
  });

  it('TC-49.6: offers Create project and no Settings or Invitations button', () => {
    render(<ProjectsEmpty user={user} createHref="/new" canCreate />);
    expect(screen.getByRole('link', { name: 'Create project' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^(Org settings|Invitations)$/ })).not.toBeInTheDocument();
  });

  it('shows no Create project when canCreate is left out (fail closed)', () => {
    render(<ProjectsEmpty user={user} createHref="/new" />);
    expect(screen.queryByRole('link', { name: 'Create project' })).not.toBeInTheDocument();
  });

  it('without canCreate shows "No projects yet" and no Create project', () => {
    render(<ProjectsEmpty user={user} createHref="/new" canCreate={false} />);
    expect(screen.getByRole('heading', { level: 1, name: 'No projects yet' })).toBeInTheDocument();
    expect(screen.getByText('An owner or admin of this organization creates projects.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create project' })).not.toBeInTheDocument();
    expect(screen.queryByText('Connect a repo')).not.toBeInTheDocument();
  });

  it('shows the banner on the empty page too', () => {
    render(
      <Projects user={user} projects={[]} newHref="/new" invitationsBanner={{ count: 1, href: '/invitations' }} />,
    );
    expect(screen.getByText('You have 1 pending invitation.')).toBeInTheDocument();
  });
});

describe('SignInNoInvitationError', () => {
  it('announces why sign-in was refused', () => {
    render(<SignIn signInHref="/x" error={<SignInNoInvitationError />} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('No invitation found for your email');
    expect(alert).toHaveTextContent('Ask an owner or admin of your organization to invite you, then sign in again.');
  });
});

describe('org bar on Projects and ProjectsEmpty', () => {
  const harbor = { id: 'org-harbor', slug: 'harbor-labs', name: 'Harbor Labs' };
  const orgBar = (settingsHref?: string) => ({
    current: harbor,
    orgs: [harbor],
    platformAdmin: false,
    orgHref: (o: { slug: string }) => `/o/${o.slug}/projects`,
    createHref: '/orgs/new',
    projectsHref: '/o/harbor-labs/projects',
    settingsHref,
  });
  const cases: [string, (settingsHref?: string) => ReactElement][] = [
    ['Projects', (s) => <Projects user={user} projects={projects} newHref="/new" canCreate org={orgBar(s)} />],
    ['Projects without create', (s) => <Projects user={user} projects={projects} newHref="/new" org={orgBar(s)} />],
    ['ProjectsEmpty', (s) => <ProjectsEmpty user={user} createHref="/new" canCreate org={orgBar(s)} />],
    ['ProjectsEmpty without create', (s) => <ProjectsEmpty user={user} createHref="/new" org={orgBar(s)} />],
  ];

  it.each(cases)('%s: Main nav marks Projects current and shows Settings with settingsHref', (_n, make) => {
    render(make('/o/harbor-labs/settings'));
    const nav = screen.getByRole('navigation', { name: 'Organization sections' });
    expect(within(nav).getByRole('link', { name: /Projects/ })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: /Org settings/ })).toHaveAttribute('href', '/o/harbor-labs/settings');
  });

  it.each(cases)('%s: header has no Settings or Invitations button when the Settings tab is shown', (_n, make) => {
    render(make('/o/harbor-labs/settings'));
    const nav = screen.getByRole('navigation', { name: 'Organization sections' });
    const outsideNav = (role: 'link' | 'button', name: RegExp) =>
      screen.queryAllByRole(role, { name }).filter((el) => !nav.contains(el));
    expect(screen.queryByRole('link', { name: 'Invitations' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invitations' })).not.toBeInTheDocument();
    expect(outsideNav('link', /^Org settings$/)).toHaveLength(0);
    expect(outsideNav('button', /^Org settings$/)).toHaveLength(0);
  });

  it.each(cases)('%s: no Settings tab without settingsHref', (_n, make) => {
    render(make());
    const nav = screen.getByRole('navigation', { name: 'Organization sections' });
    expect(within(nav).getByRole('link', { name: /Projects/ })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).queryByRole('link', { name: /Org settings/ })).not.toBeInTheDocument();
  });
});

describe('OrgSuspended', () => {
  it('shows the fixed title and body with the org name, and no reason', () => {
    render(<OrgSuspended orgName="Harbor Labs" />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'This organization is suspended' })).toBeInTheDocument();
    expect(
      screen.getByText("You can't open Harbor Labs right now. Contact your Agent Desk administrator."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/reason/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('Projects and ProjectsEmpty in the shell', () => {
  const inShell = (ui: ReactElement, viewer: 'owner' | 'member' = 'owner') =>
    render(
      <OrgShellFrame viewer={viewer} page="projects">
        {ui}
      </OrgShellFrame>,
    );

  it('Projects draws one main with the h1, the intro as header meta and New project in the header actions', () => {
    inShell(<Projects user={user} projects={projects} newHref="/new" canCreate />);
    const main = expectShellOwnedPage('Projects');
    expect(within(headerActions(main)).getByRole('link', { name: 'New project' })).toHaveAttribute('href', '/new');
    expect(
      within(main).getByText('After sign-in you land on this list. It is one click away on the logo.'),
    ).toBeInTheDocument();
    expect(within(main).getByRole('table')).toBeInTheDocument();
  });

  it('Projects without create rights has no header actions', () => {
    inShell(<Projects user={user} projects={projects} newHref="/new" />, 'member');
    const main = expectShellOwnedPage('Projects');
    expect(main.querySelector('[data-page-header-actions]')).toBeNull();
    expect(within(main).queryByRole('link', { name: 'New project' })).toBeNull();
  });

  it('the pending-invitations banner follows the h1 inside the page header', () => {
    inShell(
      <Projects
        user={user}
        projects={projects}
        newHref="/new"
        invitationsBanner={{ count: 1, href: '/invitations' }}
      />,
    );
    const main = expectShellOwnedPage('Projects');
    const banner = within(main).getByText('You have 1 pending invitation.');
    expect(
      screen.getByRole('heading', { level: 1 }).compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('ProjectsEmpty with create rights keeps the h1, the four steps and Create project, with no chrome of its own', () => {
    inShell(<ProjectsEmpty user={user} createHref="/new" canCreate />);
    const main = expectShellOwnedPage('Create your first project');
    expect(within(main).getAllByRole('listitem')).toHaveLength(4);
    expect(within(main).getByText('Add an agent')).toBeInTheDocument();
    expect(within(main).getByRole('link', { name: 'Create project' })).toHaveAttribute('href', '/new');
  });

  it('ProjectsEmpty without create rights names who creates projects', () => {
    inShell(<ProjectsEmpty user={user} createHref="/new" canCreate={false} />, 'member');
    const main = expectShellOwnedPage('No projects yet', { pageHeader: false });
    expect(within(main).getByText('An owner or admin of this organization creates projects.')).toBeInTheDocument();
  });
});

describe('route states and the suspended page in the shell', () => {
  it('RouteSkeleton is a busy status and draws no main of its own', () => {
    render(<RouteSkeleton />);
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('main')).toBeNull();
  });

  it('RouteLoadError draws the banner with Retry and no main or heading of its own', () => {
    render(<RouteLoadError title="Internal server error" requestId="req_9" onRetry={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByRole('main')).toBeNull();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('a load error inside the shell main has the menu, one main and no h1', () => {
    render(
      <OrgShellFrame page="projects">
        <main>
          <RouteLoadError title="Internal server error" onRetry={vi.fn()} />
        </main>
      </OrgShellFrame>,
    );
    expectShellOwnedPage(null);
  });

  it('BR-58: the suspended page in a shell with no menu has one main and the fixed h1', () => {
    render(
      <ShellFrame
        topBar={{
          variant: 'global',
          user,
          crumbs: [],
          org: { ...orgSwitchFixtures.oneOrg, orgHref: () => '/', createHref: '/orgs/new' },
          tabs: 'none',
        }}
      >
        <OrgSuspended orgName="Harbor Labs" />
      </ShellFrame>,
    );
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.queryByRole('navigation', { name: 'Organization menu' })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
