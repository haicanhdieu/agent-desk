import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Brand } from './Brand';
import { Breadcrumb } from './Breadcrumb';
import { ProjectMenu } from './ProjectSwitch';
import { SubNav } from './SubNav';
import { TopBar } from './TopBar';

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
    render(<SubNav aria-label="D" groups={[{ heading: 'One', items: [{ label: 'x', href: '/x' }] }, { heading: 'Two', content: 'c' }]} />);
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
          { heading: 'Desk', items: [{ label: 'Skills', href: '/s', active: true }, { label: 'Rules', href: '/r' }] },
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

  it('a silent webhook warns in idle tone, a polling failure in fail tone', () => {
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
