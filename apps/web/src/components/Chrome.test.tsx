import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Brand } from './Brand';
import { Breadcrumb } from './Breadcrumb';
import { OrgNav } from './OrgNav';
import { ProjectNav } from './ProjectNav';
import { ProjectMenu } from './ProjectSwitch';
import { SubNav } from './SubNav';
import { AccountInfoProvider, SignOutProvider } from './AccountMenu';
import { TopBar } from './TopBar';
import { orgSwitchFixtures } from '@/mocks';

const user = { login: 'kim-hale', initials: 'KH' };
const project = { org: 'harbor-labs', name: 'invoicer-api', repoUrl: 'https://github.com/harbor-labs/invoicer-api' };

describe('Brand', () => {
  it('link has the all-projects accessible name', () => {
    render(<Brand href="/projects" />);
    expect(screen.getByRole('link', { name: 'Agent Desk, all projects' })).toHaveAttribute('href', '/projects');
  });
  it('glyph-only still has the name', () => {
    render(<Brand withName={false} href="/" />);
    expect(screen.getByRole('link', { name: 'Agent Desk, all projects' })).toBeInTheDocument();
    expect(screen.queryByText('Agent Desk')).toBeNull();
  });
  it('draws the horizontal lockup (icon and name in one svg) instead of the icon plus a text name', () => {
    const { container } = render(<Brand href="/projects" size={26} />);
    const logo = container.querySelector('svg');
    expect(logo).toHaveAttribute('viewBox', '0 0 480 120');
    expect(Number(logo?.getAttribute('width'))).toBe(Number(logo?.getAttribute('height')) * 4);
    expect(container.querySelector('img')).toBeNull();
    // The name is part of the drawing, not a text node of the link.
    const link = screen.getByRole('link', { name: 'Agent Desk, all projects' });
    expect([...link.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE)).toHaveLength(0);
    // One text element, so the name carries a real space: "Agent Desk", not "AgentDesk".
    expect([...container.querySelectorAll('svg text')].map((t) => t.textContent)).toEqual(['Agent Desk']);
  });
  it('draws the icon alone, sized to the prop, when the name is off', () => {
    const { container } = render(<Brand withName={false} href="/projects" size={26} />);
    const logo = container.querySelector('svg');
    expect(logo).toHaveAttribute('viewBox', '0 0 120 120');
    expect(logo).toHaveAttribute('width', '26');
    expect(logo).toHaveAttribute('height', '26');
    expect(container.querySelector('img')).toBeNull();
  });
  it('names the lockup (or the lone icon) for a screen reader, since no text beside it does', () => {
    const { rerender } = render(<Brand />);
    expect(screen.getByRole('img', { name: 'Agent Desk' })).toHaveAttribute('viewBox', '0 0 480 120');
    rerender(<Brand withName={false} />);
    expect(screen.getByRole('img', { name: 'Agent Desk' })).toHaveAttribute('viewBox', '0 0 120 120');
  });
  it('is the horizontal lockup in the global and project top bars and the icon in the run top bar', () => {
    const { container, rerender } = render(<TopBar variant="global" user={user} />);
    expect(container.querySelector('header svg[viewBox="0 0 480 120"]')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
    rerender(<TopBar variant="project" user={user} project={project} />);
    expect(container.querySelector('header svg[viewBox="0 0 480 120"]')).not.toBeNull();
    rerender(<TopBar variant="run" user={user} />);
    expect(container.querySelector('header svg[viewBox="0 0 480 120"]')).toBeNull();
    expect(container.querySelector('header svg[viewBox="0 0 120 120"]')).not.toBeNull();
  });
});

describe('TopBar project', () => {
  it('marks the active tab with aria-current and class on', () => {
    render(<TopBar variant="project" user={user} project={project} active="runs" links={{ desk: '/desk' }} />);
    const tabs = screen.getByRole('navigation', { name: 'Main' });
    const runs = within(tabs).getByRole('link', { name: /Runs/ });
    expect(runs).toHaveAttribute('aria-current', 'page');
    expect(runs.className).toMatch(/\bon\b/);
    expect(within(tabs).getByRole('link', { name: 'Settings' })).not.toHaveAttribute('aria-current');
  });
  it('shows no Settings tab without a desk link (a member or viewer may not open the Desk)', () => {
    render(<TopBar variant="project" user={user} project={project} active="runs" />);
    const tabs = screen.getByRole('navigation', { name: 'Main' });
    expect(within(tabs).getByRole('link', { name: /Runs/ })).toBeInTheDocument();
    expect(within(tabs).queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });
  it('draws the project Settings tab with the org Settings tab icon and no Desk label', () => {
    render(
      <>
        <OrgNav projectsHref="/projects" settingsHref="/settings" />
        <ProjectNav deskHref="/rules" label="Project" />
      </>,
    );
    const orgNav = screen.getByRole('navigation', { name: 'Main' });
    const projectNav = screen.getByRole('navigation', { name: 'Project' });
    const orgIcon = within(orgNav).getByRole('link', { name: 'Settings' }).querySelector('svg');
    const projectIcon = within(projectNav).getByRole('link', { name: 'Settings' }).querySelector('svg');
    expect(orgIcon).not.toBeNull();
    expect(projectIcon?.innerHTML).toBe(orgIcon?.innerHTML);
    expect(within(projectNav).queryByText('Desk')).toBeNull();
  });
  it('needsYou 0 or undefined renders no badge', () => {
    const { rerender } = render(<TopBar variant="project" user={user} project={project} active="runs" needsYou={0} />);
    expect(screen.queryByText(/needs you/)).toBeNull();
    rerender(<TopBar variant="project" user={user} project={project} active="runs" />);
    expect(screen.queryByText(/needs you/)).toBeNull();
  });
  it('needsYou 1 renders "1 needs you"', () => {
    render(<TopBar variant="project" user={user} project={project} active="runs" needsYou={1} />);
    expect(screen.getByText('1 needs you')).toBeInTheDocument();
  });
  it('truncates a long project name with a title', () => {
    const name = 'x'.repeat(80);
    render(<TopBar variant="project" user={user} project={{ ...project, name }} active="desk" />);
    const el = screen.getByText(name);
    expect(el).toHaveAttribute('title', name);
    expect(el.className).toMatch(/name/);
    expect(screen.getByRole('button', { name: /^Switch project/ })).toBeInTheDocument();
  });
  it('opens the repo link in a new tab without giving the page access to the opener', () => {
    render(<TopBar variant="project" user={user} project={project} active="runs" />);
    const link = screen.getByRole('link', { name: /Repo on GitHub/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
  it('has repo link, bell and avatar', () => {
    render(<TopBar variant="project" user={user} project={project} active="runs" />);
    expect(screen.getByRole('link', { name: /Repo on GitHub/ })).toHaveAttribute('href', project.repoUrl);
    expect(screen.getByRole('button', { name: 'Notifications on' })).toBeInTheDocument();
    expect(screen.getByTitle('kim-hale')).toHaveTextContent('KH');
  });
});

const orgProps = {
  ...orgSwitchFixtures.oneOrg,
  orgHref: (o: { slug: string }) => `/o/${o.slug}`,
  createHref: '/orgs/new',
  settingsHref: '/o/acme/settings',
};
const orgLinks = { projects: '/o/acme/projects' };

describe('TopBar org level', () => {
  it('renders the org crumb and the Projects and Settings tabs, Projects current (BR-43)', () => {
    render(<TopBar variant="global" user={user} org={orgProps} tabs="org" active="projects" links={orgLinks} />);
    expect(screen.getByRole('button', { name: /^Organization menu/ })).toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: 'Main' });
    expect(within(tabs).getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/o/acme/projects');
    expect(within(tabs).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/o/acme/settings');
    expect(within(tabs).getByRole('link', { name: 'Settings' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Notifications on' })).toBeInTheDocument();
  });
  it('shows only Projects without a settings link (BR-43)', () => {
    render(
      <TopBar
        variant="global"
        user={user}
        org={{ ...orgProps, settingsHref: undefined }}
        tabs="org"
        active="projects"
        links={orgLinks}
      />,
    );
    const tabs = screen.getByRole('navigation', { name: 'Main' });
    expect(within(tabs).getAllByRole('link')).toHaveLength(1);
  });
  it('tabs none renders no Main nav (BR-43)', () => {
    render(<TopBar variant="global" user={user} org={orgProps} tabs="none" />);
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Organization menu/ })).toBeInTheDocument();
  });
  it('defaults to no tabs on the org level and keeps the brand link (BR-48)', () => {
    render(<TopBar variant="global" user={user} org={orgProps} />);
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Agent Desk, all projects' })).toBeInTheDocument();
  });
  it('a no-org person sees "No organization" and the bell (BR-43)', () => {
    render(
      <TopBar variant="global" user={user} org={{ ...orgProps, current: null, orgs: [], platformAdmin: false }} />,
    );
    expect(screen.getByText('No organization')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications on' })).toBeInTheDocument();
  });
  it('cuts a long org name with a title', () => {
    render(<TopBar variant="global" user={user} org={{ ...orgProps, ...orgSwitchFixtures.longName }} />);
    const name = orgSwitchFixtures.longName.current?.name ?? '';
    expect(screen.getByText(name)).toHaveAttribute('title', name);
  });
  it('without org renders only the brand, the bell and the avatar', () => {
    render(<TopBar variant="global" user={user} />);
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Switch project/ })).toBeNull();
    expect(screen.getByRole('img', { name: 'Agent Desk' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications on' })).toBeInTheDocument();
  });
});

describe('TopBar project level with the org crumb', () => {
  it('renders org crumb, project crumb, Runs and Settings tabs, repo link and bell (BR-43)', () => {
    render(
      <TopBar
        variant="project"
        user={user}
        org={orgProps}
        project={{ name: project.name, repoUrl: project.repoUrl }}
        active="desk"
        links={{ desk: '/desk' }}
      />,
    );
    expect(screen.getByRole('button', { name: /^Organization menu/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch project, currently invoicer-api' })).toHaveTextContent(
      /^invoicer-api$/,
    );
    const tabs = screen.getByRole('navigation', { name: 'Main' });
    expect(within(tabs).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).getByRole('link', { name: /Runs/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Repo on GitHub/ })).toHaveAttribute('href', project.repoUrl);
    expect(screen.getByRole('button', { name: 'Notifications on' })).toBeInTheDocument();
  });
  it('shows no org text when no org crumb is given', () => {
    render(<TopBar variant="project" user={user} project={project} active="runs" />);
    expect(screen.queryByText('harbor-labs')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Organization menu/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Switch project/ })).toBeInTheDocument();
  });
  it("the brand link goes to the org crumb's projects href when links.projects is omitted", () => {
    render(
      <TopBar
        variant="project"
        user={user}
        project={project}
        org={{ ...orgProps, projectsHref: '/o/acme/projects' }}
      />,
    );
    expect(screen.getByRole('link', { name: 'Agent Desk, all projects' })).toHaveAttribute('href', '/o/acme/projects');
  });
});

describe('TopBar run', () => {
  const run = { runsHref: '/o/acme/p/api/runs', label: 'Run 61' };
  it('renders four crumbs, children and actions, no tabs and no bell (BR-46)', () => {
    render(
      <TopBar
        variant="run"
        user={user}
        org={orgProps}
        project={{ name: project.name, repoUrl: project.repoUrl }}
        run={run}
        actions={<button>Cancel run</button>}
      >
        <span>Running pill</span>
      </TopBar>,
    );
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('button', { name: /^Organization menu/ })).toBeInTheDocument();
    expect(within(crumbs).getByRole('button', { name: /^Switch project/ })).toBeInTheDocument();
    expect(within(crumbs).getByRole('link', { name: 'Runs' })).toHaveAttribute('href', run.runsHref);
    const last = within(crumbs).getByText('Run 61');
    expect(last).toHaveAttribute('aria-current', 'page');
    expect(last.tagName).not.toBe('A');
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Notifications on' })).toBeNull();
    expect(screen.getByText('Running pill')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel run' })).toBeInTheDocument();
    expect(screen.queryByText('Agent Desk')).toBeNull();
  });
  it('opens the project switcher from the run-level project crumb (TC-46.3)', async () => {
    const onOpen = vi.fn();
    render(
      <TopBar
        variant="run"
        user={user}
        org={orgProps}
        project={{ name: project.name, repoUrl: project.repoUrl }}
        projectMenu={{
          status: 'ready',
          onOpen,
          items: [
            { name: 'invoicer-api', needsYou: 0, current: true, href: '/a' },
            { name: 'invoicer-web', needsYou: 0, href: '/b' },
          ],
        }}
        run={run}
      />,
    );
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    await userEvent.click(within(crumbs).getByRole('button', { name: /^Switch project/ }));
    expect(onOpen).toHaveBeenCalled();
    expect(within(crumbs).getByRole('link', { name: /invoicer-web/ })).toHaveAttribute('href', '/b');
  });
});

describe('Breadcrumb', () => {
  it('renders a control item as is, between slashes', () => {
    render(<Breadcrumb items={[{ control: <button>Org menu</button> }, { label: 'b' }]} />);
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByRole('button', { name: 'Org menu' })).toBeInTheDocument();
    expect(within(nav).getByText('b')).toHaveAttribute('aria-current', 'page');
  });
  it('links earlier items only', () => {
    render(<Breadcrumb items={[{ label: 'a', href: '/a' }, { label: 'b' }]} />);
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getAllByRole('link')).toHaveLength(1);
  });
});

describe('Breadcrumb ellipsis', () => {
  it('string crumbs carry a title and the ellipsis class', () => {
    const long = 'r'.repeat(90);
    render(<Breadcrumb items={[{ label: long, href: '/a' }, { label: 'Run 61' }]} />);
    const a = screen.getByRole('link');
    expect(a).toHaveAttribute('title', long);
    expect(a.className).toMatch(/crumb/);
    expect(screen.getByText('Run 61')).toHaveAttribute('title', 'Run 61');
  });
});

describe('SubNav', () => {
  it('headings are direct children of the nav so only the first is :first-child', () => {
    render(
      <SubNav
        aria-label="D"
        groups={[
          { heading: 'One', items: [{ label: 'x', href: '/x' }] },
          { heading: 'Two', content: 'c' },
        ]}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'D' });
    expect(screen.getByText('One').parentElement).toBe(nav);
    expect(screen.getByText('Two').parentElement).toBe(nav);
    expect(screen.getByText('Two')).not.toBe(nav.firstElementChild);
  });
  it('active item has aria-current and content group renders', () => {
    render(
      <SubNav
        aria-label="Desk"
        groups={[
          {
            heading: 'Desk',
            items: [
              { label: 'Skills', href: '/s', active: true },
              { label: 'Rules', href: '/r' },
            ],
          },
          { heading: 'Repository', content: <span>Connected</span> },
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Skills' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Rules' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Repository')).toBeInTheDocument();
  });
});

describe('ProjectMenu', () => {
  it('zero shows faint 0, positive shows badge, warning shows status', () => {
    render(
      <ProjectMenu
        items={[
          { name: 'invoicer-api', needsYou: 1, current: true, href: '/a' },
          { name: 'invoicer-web', needsYou: 0, href: '/b' },
          { name: 'docs-site', needsYou: 0, warning: 'webhooks', href: '/c' },
        ]}
      />,
    );
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getAllByText('0')).toHaveLength(1);
    expect(screen.getByText('webhooks')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /invoicer-api/ })).toHaveAttribute('aria-current', 'true');
  });

  it('a silent webhook warns in idle tone, a polling failure in err tone', () => {
    render(
      <ProjectMenu
        items={[
          { name: 'docs-site', needsYou: 0, warning: 'webhooks', href: '/c' },
          { name: 'billing-jobs', needsYou: 0, warning: 'polling', warningTone: 'err', href: '/d' },
        ]}
      />,
    );
    expect(screen.getByText('webhooks').closest('.inline-status')).toHaveClass('idle');
    expect(screen.getByText('polling').closest('.inline-status')).toHaveClass('err');
  });
});

describe('TopBar account menu', () => {
  const variants = {
    global: <TopBar variant="global" user={user} />,
    project: <TopBar variant="project" user={user} project={project} active="runs" />,
    run: (
      <TopBar variant="run" user={user} project={{ name: project.name }} run={{ runsHref: '/runs', label: 'Run 61' }} />
    ),
  } as const;
  const setup = (variant: keyof typeof variants) => {
    const onSignOut = vi.fn();
    const events = userEvent.setup();
    render(
      <SignOutProvider onSignOut={onSignOut}>
        <AccountInfoProvider name="Kim Hale" email="kim.hale@harbor-labs.example">
          {variants[variant]}
        </AccountInfoProvider>
      </SignOutProvider>,
    );
    return { onSignOut, events };
  };
  const trigger = () => screen.getByRole('button', { name: 'Account menu for kim-hale' });
  const menu = () => screen.queryByRole('menu', { name: 'Account' });

  it.each(Object.keys(variants) as (keyof typeof variants)[])(
    'the %s avatar is a button that opens a menu with Logout, and Logout signs out and closes it',
    async (variant) => {
      const { onSignOut, events } = setup(variant);
      expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
      expect(trigger()).toHaveAttribute('aria-expanded', 'false');
      expect(menu()).toBeNull();
      await events.click(trigger());
      expect(trigger()).toHaveAttribute('aria-expanded', 'true');
      await events.click(
        within(screen.getByRole('menu', { name: 'Account' })).getByRole('menuitem', { name: 'Logout' }),
      );
      expect(onSignOut).toHaveBeenCalledTimes(1);
      expect(menu()).toBeNull();
    },
  );

  it('aria-controls on the avatar points at the role="menu" element itself', async () => {
    const { events } = setup('global');
    await events.click(trigger());
    const controlled = trigger().getAttribute('aria-controls');
    expect(controlled).toBeTruthy();
    expect(screen.getByRole('menu', { name: 'Account' }).id).toBe(controlled);
  });

  it('closes when the avatar is pressed again', async () => {
    const { events } = setup('global');
    await events.click(trigger());
    expect(menu()).toBeInTheDocument();
    await events.click(trigger());
    expect(menu()).toBeNull();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows the name with the full email directly under it, then a separator and Logout with an icon', async () => {
    const { events } = setup('global');
    await events.click(trigger());
    const m = screen.getByRole('menu', { name: 'Account' });
    const name = within(m).getByText('Kim Hale');
    const email = within(m).getByText('kim.hale@harbor-labs.example');
    expect(email).toHaveClass('mono');
    // jsdom cannot lay out; the wrapping rule lives in the .email class (see the OpenLongName story).
    expect(email).toHaveClass('email');
    expect(name.nextElementSibling).toBe(email);
    expect(within(m).queryByText('kim-hale')).toBeNull();
    expect(within(m).queryByRole('menuitem', { name: /My invitations/ })).toBeNull();
    const logout = within(m).getByRole('menuitem', { name: 'Logout' });
    expect(logout.querySelector('svg')).not.toBeNull();
    const separator = within(m).getByRole('separator');
    expect(Boolean(separator.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(within(m).getAllByRole('menuitem')).toHaveLength(1);
    expect(m).toHaveStyle({ width: '240px' });
  });

  it('opens from the keyboard, closes on Escape with focus back on the avatar, and closes on an outside press', async () => {
    const { onSignOut, events } = setup('global');
    trigger().focus();
    await events.keyboard('{Enter}');
    expect(menu()).toBeInTheDocument();
    await events.keyboard('{Escape}');
    expect(menu()).toBeNull();
    expect(trigger()).toHaveFocus();
    await events.click(trigger());
    await events.click(document.body);
    expect(menu()).toBeNull();
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('shows the handle as the name when the session gives none', async () => {
    const events = userEvent.setup();
    render(
      <SignOutProvider onSignOut={vi.fn()}>
        <TopBar variant="global" user={user} />
      </SignOutProvider>,
    );
    await events.click(trigger());
    expect(within(screen.getByRole('menu', { name: 'Account' })).getAllByText('kim-hale')).toHaveLength(2);
  });

  it('keeps the avatar static when nothing can sign the user out (no provider)', () => {
    render(<TopBar variant="global" user={user} />);
    expect(screen.queryByRole('button', { name: /^Account menu/ })).toBeNull();
    expect(screen.getByTitle('kim-hale')).toHaveTextContent('KH');
  });
});
