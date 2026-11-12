import { render, screen, within } from '@testing-library/react';
import { projects, user } from '@/mocks';
import { SignIn } from './SignIn';
import { ProjectsEmpty } from './ProjectsEmpty';
import { Projects } from './Projects';

describe('SignIn', () => {
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
    render(<ProjectsEmpty user={user} createHref="/new" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Create your first project' })).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'Create project' })).toHaveAttribute('href', '/new');
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });
});

describe('Projects', () => {
  it('shows the empty-state content when there are no projects', () => {
    render(<Projects user={user} projects={[]} newHref="/new" />);
    expect(screen.getByText('Create your first project')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create project' })).toHaveAttribute('href', '/new');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('has one main landmark, an h1 and a New project link', () => {
    render(<Projects user={user} projects={projects} newHref="/new" />);
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

  it('shows polling status: ok with the succeeded glyph, failure with the failed glyph and fail tone', () => {
    render(<Projects user={user} projects={projects} newHref="/new" />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[1]).getByText('Polling every 5 min')).toBeInTheDocument();
    expect(within(rows[1]).getByTitle('status: succeeded')).toBeInTheDocument();
    const failed = within(rows[3]).getByText('Polling failed: rate limited, retry in 5 min');
    expect(failed.closest('.inline-status')).toHaveClass('fail');
    expect(within(rows[3]).getByTitle('status: failed')).toBeInTheDocument();
  });

  it('offers Switch to polling only on the silent-webhook row', () => {
    render(<Projects user={user} projects={projects} newHref="/new" />);
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
