import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Brand } from './Brand';
import { Breadcrumb } from './Breadcrumb';
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
    expect([...container.querySelectorAll('svg text')].map((t) => t.textContent)).toEqual(['Agent', 'Desk']);
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
    const tabs = screen.getByRole('navigation', { name: 'Project' });
    const runs = within(tabs).getByRole('link', { name: /Runs/ });
    expect(runs).toHaveAttribute('aria-current', 'page');
    expect(runs.className).toMatch(/\bon\b/);
    expect(within(tabs).getByRole('link', { name: 'Desk' })).not.toHaveAttribute('aria-current');
  });
  it('shows no Desk tab without a desk link (a member or viewer may not open the Desk)', () => {
    render(<TopBar variant="project" user={user} project={project} active="runs" />);
    const tabs = screen.getByRole('navigation', { name: 'Project' });
    expect(within(tabs).getByRole('link', { name: /Runs/ })).toBeInTheDocument();
    expect(within(tabs).queryByRole('link', { name: 'Desk' })).not.toBeInTheDocument();
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

describe('TopBar global', () => {
  it('has no tabs and no switch', () => {
    render(<TopBar variant="global" user={user} />);
    expect(screen.queryByRole('navigation', { name: 'Project' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Switch project/ })).toBeNull();
    expect(screen.getByRole('img', { name: 'Agent Desk' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications on' })).toBeInTheDocument();
  });
});

describe('TopBar org switch', () => {
  const org = {
    ...orgSwitchFixtures.severalOrgs,
    orgHref: (o: { slug: string }) => `/o/${o.slug}`,
    createHref: '/orgs/new',
  };
  it('renders the switcher on the global variant when org is given', () => {
    render(<TopBar variant="global" user={user} org={org} />);
    expect(screen.getByRole('button', { name: /^Switch organization/ })).toBeInTheDocument();
  });
  it('draws no separator when the switcher renders nothing (non-admin with no org)', () => {
    const { container } = render(
      <TopBar variant="global" user={user} org={{ ...org, current: null, orgs: [], platformAdmin: false }} />,
    );
    expect(screen.queryByRole('button', { name: /^Switch organization/ })).toBeNull();
    expect(container.querySelector('header [class*="sep"]')).toBeNull();
  });
  it('draws the separator before a visible switcher', () => {
    const { container } = render(<TopBar variant="global" user={user} org={org} />);
    expect(container.querySelector('header [class*="sep"]')).not.toBeNull();
  });
  it('renders no switcher on the global variant without org', () => {
    render(<TopBar variant="global" user={user} />);
    expect(screen.queryByRole('button', { name: /^Switch organization/ })).toBeNull();
  });
  it('renders no switcher on the project variant', () => {
    render(<TopBar variant="project" user={user} project={project} active="runs" org={org} />);
    expect(screen.queryByRole('button', { name: /^Switch organization/ })).toBeNull();
  });
});

describe('TopBar run', () => {
  it('renders breadcrumb, children and actions without tabs', () => {
    render(
      <TopBar
        variant="run"
        user={user}
        breadcrumb={[{ label: 'invoicer-api', href: '/p' }, { label: 'Runs', href: '/runs' }, { label: 'Run 61' }]}
        actions={<button>Cancel run</button>}
      >
        <span>Running pill</span>
      </TopBar>,
    );
    expect(screen.queryByRole('navigation', { name: 'Project' })).toBeNull();
    const last = screen.getByText('Run 61');
    expect(last).toHaveAttribute('aria-current', 'page');
    expect(last.tagName).not.toBe('A');
    expect(screen.getByText('Running pill')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel run' })).toBeInTheDocument();
    expect(screen.queryByText('Agent Desk')).toBeNull();
  });
});

describe('Breadcrumb', () => {
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
  const breadcrumb = [{ label: 'invoicer-api', href: '/p' }, { label: 'Run 61' }];
  const variants = {
    global: <TopBar variant="global" user={user} />,
    project: <TopBar variant="project" user={user} project={project} active="runs" />,
    run: <TopBar variant="run" user={user} breadcrumb={breadcrumb} />,
  } as const;
  const setup = (variant: keyof typeof variants, pendingInvitations = 0) => {
    const onSignOut = vi.fn();
    const events = userEvent.setup();
    render(
      <SignOutProvider onSignOut={onSignOut}>
        <AccountInfoProvider name="Kim Hale" pendingInvitations={pendingInvitations}>
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

  it('closes when the avatar is pressed again', async () => {
    const { events } = setup('global');
    await events.click(trigger());
    expect(menu()).toBeInTheDocument();
    await events.click(trigger());
    expect(menu()).toBeNull();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows the identity header, My invitations with its pending count, a separator and Logout, in the prototype order', async () => {
    const { events } = setup('global', 2);
    await events.click(trigger());
    const m = screen.getByRole('menu', { name: 'Account' });
    expect(within(m).getByText('Kim Hale')).toBeInTheDocument();
    const handle = within(m).getByText('kim-hale');
    expect(handle).toHaveClass('mono');
    const invitations = within(m).getByRole('menuitem', { name: /My invitations/ });
    expect(invitations).toHaveAttribute('href', '/invitations');
    expect(within(invitations).getByText('2 pending')).toBeInTheDocument();
    const logout = within(m).getByRole('menuitem', { name: 'Logout' });
    const separator = within(m).getByRole('separator');
    const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(handle, invitations)).toBe(true);
    expect(follows(invitations, separator)).toBe(true);
    expect(follows(separator, logout)).toBe(true);
    expect(within(m).getAllByRole('menuitem')).toHaveLength(2);
    expect(within(m).queryByRole('menuitem', { name: /Settings/ })).toBeNull();
    expect(m).toHaveStyle({ width: '240px' });
  });

  it('shows no pending count when no invitation is pending', async () => {
    const { events } = setup('global', 0);
    await events.click(trigger());
    const invitations = screen.getByRole('menuitem', { name: /My invitations/ });
    expect(within(invitations).queryByText(/pending/)).toBeNull();
  });

  it('tells the app when the menu opens, so it can fetch the pending count then', async () => {
    const onOpen = vi.fn();
    const events = userEvent.setup();
    render(
      <SignOutProvider onSignOut={vi.fn()}>
        <AccountInfoProvider onOpen={onOpen}>
          <TopBar variant="global" user={user} />
        </AccountInfoProvider>
      </SignOutProvider>,
    );
    expect(onOpen).not.toHaveBeenCalled();
    await events.click(trigger());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('closes the menu when My invitations is followed', async () => {
    const { events } = setup('global', 1);
    await events.click(trigger());
    await events.click(screen.getByRole('menuitem', { name: /My invitations/ }));
    expect(menu()).toBeNull();
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

  it('moves between the menu items with the arrow keys, Home and End', async () => {
    const { events } = setup('global', 1);
    await events.click(trigger());
    const invitations = screen.getByRole('menuitem', { name: /My invitations/ });
    const logout = screen.getByRole('menuitem', { name: 'Logout' });
    invitations.focus();
    await events.keyboard('{ArrowDown}');
    expect(logout).toHaveFocus();
    await events.keyboard('{ArrowDown}');
    expect(invitations).toHaveFocus();
    await events.keyboard('{ArrowUp}');
    expect(logout).toHaveFocus();
    await events.keyboard('{Home}');
    expect(invitations).toHaveFocus();
    await events.keyboard('{End}');
    expect(logout).toHaveFocus();
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
