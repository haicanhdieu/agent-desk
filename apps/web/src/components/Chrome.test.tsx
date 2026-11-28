import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Brand } from './Brand';
import { Breadcrumb } from './Breadcrumb';
import { ProjectMenu } from './ProjectSwitch';
import { SubNav } from './SubNav';
import { AccountInfoProvider, SignOutProvider } from './AccountMenu';
import { TopBar } from './TopBar';
import { NO_PAGE_CRUMBS } from './pageTitle';
import { orgSwitchFixtures } from '@/mocks';

const user = { login: 'kim-hale', initials: 'KH' };
const orgProps = {
  ...orgSwitchFixtures.severalOrgs,
  orgHref: (o: { slug: string }) => `/o/${o.slug}`,
  createHref: '/orgs/new',
};
const projectName = 'invoicer-api';

describe('TopBar bell', () => {
  it('has a disabled, unfocusable bell named "Notifications (coming soon)" with that tooltip, never "Notifications on"', () => {
    render(<TopBar crumbs={NO_PAGE_CRUMBS} user={user} />);
    const bell = screen.getByRole('button', { name: 'Notifications (coming soon)' });
    expect(bell).toBeDisabled();
    expect(bell).toHaveAttribute('title', 'Notifications (coming soon)');
    bell.focus();
    expect(bell).not.toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Notifications on' })).toBeNull();
  });
  it('leaves document.title to the shell host', () => {
    document.title = 'Before';
    render(<TopBar crumbs={[{ label: 'Runs' }]} user={user} />);
    expect(document.title).toBe('Before');
  });
});

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
  it('is the horizontal lockup in the bar', () => {
    const { container } = render(<TopBar crumbs={NO_PAGE_CRUMBS} user={user} />);
    expect(container.querySelector('header svg[viewBox="0 0 480 120"]')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('TopBar', () => {
  it('has no navigation landmark of its own beyond the breadcrumb: no section links, no tabs', () => {
    render(<TopBar crumbs={NO_PAGE_CRUMBS} user={user} org={orgProps} projectName={projectName} />);
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Organization sections' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Project sections' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Repo on GitHub/ })).toBeNull();
  });
  it('without org renders only the brand, the bell and the avatar', () => {
    render(<TopBar crumbs={NO_PAGE_CRUMBS} user={user} />);
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Switch project/ })).toBeNull();
    expect(screen.getByRole('img', { name: 'Agent Desk' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications (coming soon)' })).toBeInTheDocument();
    expect(screen.getByTitle('kim-hale')).toHaveTextContent('KH');
  });
  it('a no-org person sees "No organization" and the bell (BR-43)', () => {
    render(
      <TopBar
        crumbs={NO_PAGE_CRUMBS}
        user={user}
        org={{ ...orgProps, current: null, orgs: [], platformAdmin: false }}
      />,
    );
    expect(screen.getByText('No organization')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications (coming soon)' })).toBeInTheDocument();
  });
  it('cuts a long org name with a title', () => {
    render(<TopBar crumbs={NO_PAGE_CRUMBS} user={user} org={{ ...orgProps, ...orgSwitchFixtures.longName }} />);
    const name = orgSwitchFixtures.longName.current?.name ?? '';
    expect(screen.getByText(name)).toHaveAttribute('title', name);
  });
  it('truncates a long project name with a title', () => {
    const name = 'x'.repeat(80);
    render(<TopBar crumbs={NO_PAGE_CRUMBS} user={user} projectName={name} />);
    const el = screen.getByText(name);
    expect(el).toHaveAttribute('title', name);
    expect(el.className).toMatch(/name/);
    expect(screen.getByRole('button', { name: /^Switch project/ })).toBeInTheDocument();
  });
  it('shows no org text when no org crumb is given', () => {
    render(<TopBar crumbs={NO_PAGE_CRUMBS} user={user} projectName={projectName} />);
    expect(screen.queryByRole('button', { name: /^Switch scope/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Switch project/ })).toBeInTheDocument();
  });
  it('renders the org crumb, the project crumb and the bell', () => {
    render(<TopBar crumbs={NO_PAGE_CRUMBS} user={user} org={orgProps} projectName={projectName} />);
    expect(screen.getByRole('button', { name: /^Switch scope/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch project, currently invoicer-api' })).toHaveTextContent(
      /^invoicer-api$/,
    );
    expect(screen.getByRole('button', { name: 'Notifications (coming soon)' })).toBeInTheDocument();
  });
  it('sends the logo to the given address, "/projects" without one', () => {
    const { rerender } = render(<TopBar crumbs={NO_PAGE_CRUMBS} user={user} org={orgProps} />);
    expect(screen.getByRole('link', { name: 'Agent Desk, all projects' })).toHaveAttribute('href', '/projects');
    rerender(<TopBar crumbs={NO_PAGE_CRUMBS} user={user} org={orgProps} logoHref="/o/acme/projects" />);
    expect(screen.getByRole('link', { name: 'Agent Desk, all projects' })).toHaveAttribute('href', '/o/acme/projects');
  });
  it('shows the "Open menu" button only with a handler, and reports the drawer state', async () => {
    const onOpenMenu = vi.fn();
    const { rerender } = render(<TopBar crumbs={NO_PAGE_CRUMBS} user={user} />);
    expect(screen.queryByRole('button', { name: 'Open menu' })).toBeNull();
    rerender(<TopBar crumbs={NO_PAGE_CRUMBS} user={user} onOpenMenu={onOpenMenu} menuOpen />);
    const button = screen.getByRole('button', { name: 'Open menu' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(button);
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
  });
  it('opens the project switcher from the project crumb (TC-46.3)', async () => {
    const onOpen = vi.fn();
    render(
      <TopBar
        user={user}
        org={orgProps}
        projectName={projectName}
        projectMenu={{
          status: 'ready',
          onOpen,
          items: [
            { name: 'invoicer-api', needsYou: 0, current: true, href: '/a' },
            { name: 'invoicer-web', needsYou: 0, href: '/b' },
          ],
        }}
        crumbs={[{ label: 'Runs', href: '/runs' }, { label: 'Run 61' }]}
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
    scope: <TopBar crumbs={NO_PAGE_CRUMBS} user={user} />,
    project: <TopBar crumbs={NO_PAGE_CRUMBS} user={user} projectName={projectName} />,
    run: (
      <TopBar user={user} projectName={projectName} crumbs={[{ label: 'Runs', href: '/runs' }, { label: 'Run 61' }]} />
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
    const { events } = setup('scope');
    await events.click(trigger());
    const controlled = trigger().getAttribute('aria-controls');
    expect(controlled).toBeTruthy();
    expect(screen.getByRole('menu', { name: 'Account' }).id).toBe(controlled);
  });

  it('closes when the avatar is pressed again', async () => {
    const { events } = setup('scope');
    await events.click(trigger());
    expect(menu()).toBeInTheDocument();
    await events.click(trigger());
    expect(menu()).toBeNull();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows the name with the full email directly under it, then a separator, My invitations and Logout with an icon', async () => {
    const { events } = setup('scope');
    await events.click(trigger());
    const m = screen.getByRole('menu', { name: 'Account' });
    const name = within(m).getByText('Kim Hale');
    const email = within(m).getByText('kim.hale@harbor-labs.example');
    expect(email).toHaveClass('mono');
    // jsdom cannot lay out; the wrapping rule lives in the .email class (see the OpenLongName story).
    expect(email).toHaveClass('email');
    expect(name.nextElementSibling).toBe(email);
    expect(within(m).queryByText('kim-hale')).toBeNull();
    expect(within(m).getByRole('menuitem', { name: 'My invitations' })).toHaveAttribute('href', '/invitations');
    const logout = within(m).getByRole('menuitem', { name: 'Logout' });
    expect(logout.querySelector('svg')).not.toBeNull();
    const separator = within(m).getByRole('separator');
    expect(Boolean(separator.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(within(m).getAllByRole('menuitem')).toHaveLength(2);
    expect(m).toHaveStyle({ width: '240px' });
  });

  it('opens from the keyboard, closes on Escape with focus back on the avatar, and closes on an outside press', async () => {
    const { onSignOut, events } = setup('scope');
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
        <TopBar crumbs={NO_PAGE_CRUMBS} user={user} />
      </SignOutProvider>,
    );
    await events.click(trigger());
    expect(within(screen.getByRole('menu', { name: 'Account' })).getAllByText('kim-hale')).toHaveLength(2);
  });

  it('keeps the avatar static when nothing can sign the user out (no provider)', () => {
    render(<TopBar crumbs={NO_PAGE_CRUMBS} user={user} />);
    expect(screen.queryByRole('button', { name: /^Account menu/ })).toBeNull();
    expect(screen.getByTitle('kim-hale')).toHaveTextContent('KH');
  });
});

describe('TopBar breadcrumb', () => {
  const runCrumbs = [{ label: 'Runs', href: '/runs' }, { label: 'Run 61' }];
  const named = (name: string) => ({
    ...orgProps,
    current: { id: 'org-named', slug: 'named', name },
  });
  it('renders exactly one Breadcrumb nav with the org, the project and the page crumbs', () => {
    for (const bar of [
      <TopBar key="g" user={user} org={orgProps} crumbs={[{ label: 'Projects' }]} />,
      <TopBar key="p" user={user} org={orgProps} projectName={projectName} crumbs={NO_PAGE_CRUMBS} />,
      <TopBar key="r" user={user} org={orgProps} projectName={projectName} crumbs={runCrumbs} />,
    ]) {
      const { unmount } = render(bar);
      expect(screen.getAllByRole('navigation', { name: 'Breadcrumb' })).toHaveLength(1);
      unmount();
    }
  });
  it('has no slash outside the Breadcrumb', () => {
    const { container } = render(
      <TopBar user={user} org={orgProps} projectName={projectName} crumbs={NO_PAGE_CRUMBS} />,
    );
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const slashes = [...container.querySelectorAll('[aria-hidden="true"]')].filter((el) => el.textContent === '/');
    expect(slashes.length).toBeGreaterThan(0);
    for (const el of slashes) expect(nav.contains(el)).toBe(true);
  });
  it('page crumbs follow the scope and project crumbs; only the last has aria-current="page"', () => {
    render(
      <TopBar
        user={user}
        projectName={projectName}
        crumbs={[{ label: 'Project settings', href: '/d' }, { label: 'Skills' }]}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByRole('link', { name: 'Project settings' })).toHaveAttribute('href', '/d');
    const current = nav.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.tagName).toBe('B');
    expect(current[0]).toHaveTextContent('Skills');
  });
  it('a run page reads org, project, a Runs link and the run, the last one current', () => {
    render(<TopBar user={user} org={named('Harbor Labs')} projectName={projectName} crumbs={runCrumbs} />);
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByRole('link', { name: 'Runs' })).toHaveAttribute('href', '/runs');
    const last = within(nav).getByText('Run 61');
    expect(last).toHaveAttribute('aria-current', 'page');
    expect(last.tagName).not.toBe('A');
  });
  it('a loading crumb is a status named "Loading organization" with no text', () => {
    render(<TopBar user={user} crumbs={[{ label: '', loading: true, what: 'organization' }]} />);
    expect(screen.getByRole('status', { name: 'Loading organization' })).toHaveTextContent('');
  });
  it('a 60-character org and project name keep ellipsis and title', () => {
    const orgName = 'o'.repeat(60);
    const name = 'p'.repeat(60);
    render(<TopBar user={user} org={named(orgName)} projectName={name} crumbs={NO_PAGE_CRUMBS} />);
    expect(screen.getByText(orgName)).toHaveAttribute('title', orgName);
    expect(screen.getByText(name)).toHaveAttribute('title', name);
  });
  it('requires crumbs', () => {
    // @ts-expect-error crumbs is required
    const bar = <TopBar user={user} />;
    expect(bar).toBeTruthy();
  });
});
