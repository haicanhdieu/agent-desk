import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Brand } from './Brand';
import { Breadcrumb } from './Breadcrumb';
import { ProjectMenu } from './ProjectSwitch';
import { SubNav } from './SubNav';
import { SignOutProvider } from './AccountMenu';
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
});

describe('TopBar project', () => {
  it('marks the active tab with aria-current and class on', () => {
    render(<TopBar variant="project" user={user} project={project} active="runs" />);
    const tabs = screen.getByRole('navigation', { name: 'Project' });
    const runs = within(tabs).getByRole('link', { name: /Runs/ });
    expect(runs).toHaveAttribute('aria-current', 'page');
    expect(runs.className).toMatch(/\bon\b/);
    expect(within(tabs).getByRole('link', { name: 'Desk' })).not.toHaveAttribute('aria-current');
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
    expect(screen.getByText('Agent Desk')).toBeInTheDocument();
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
  const setup = (variant: keyof typeof variants) => {
    const onSignOut = vi.fn();
    const events = userEvent.setup();
    render(<SignOutProvider onSignOut={onSignOut}>{variants[variant]}</SignOutProvider>);
    return { onSignOut, events };
  };
  const trigger = () => screen.getByRole('button', { name: 'Account menu for kim-hale' });
  const menu = () => screen.queryByRole('dialog', { name: 'Account' });

  it.each(Object.keys(variants) as (keyof typeof variants)[])(
    'the %s avatar is a button that opens a menu with Logout, and Logout signs out and closes it',
    async (variant) => {
      const { onSignOut, events } = setup(variant);
      expect(trigger()).toHaveAttribute('aria-haspopup', 'dialog');
      expect(trigger()).toHaveAttribute('aria-expanded', 'false');
      expect(menu()).toBeNull();
      await events.click(trigger());
      expect(trigger()).toHaveAttribute('aria-expanded', 'true');
      await events.click(
        within(screen.getByRole('dialog', { name: 'Account' })).getByRole('menuitem', { name: 'Logout' }),
      );
      expect(onSignOut).toHaveBeenCalledTimes(1);
      expect(menu()).toBeNull();
    },
  );

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

  it('keeps the avatar static when nothing can sign the user out (no provider)', () => {
    render(<TopBar variant="global" user={user} />);
    expect(screen.queryByRole('button', { name: /^Account menu/ })).toBeNull();
    expect(screen.getByTitle('kim-hale')).toHaveTextContent('KH');
  });
});
