import { render, screen, within } from '@testing-library/react';
import { Icon } from '@/ds';
import { DeskLayout, type DeskLayoutProps } from './DeskLayout';

const repo = { org: 'harbor-labs', name: 'invoicer-api', branch: 'main', connected: true };
const base = { skills: '#skills', rules: '#rules', agent: '#agent' };

function setup(props: Partial<DeskLayoutProps> = {}) {
  render(<DeskLayout active="agent" repo={repo} {...props} />);
  return screen.getByRole('navigation', { name: 'Desk' });
}

const iconMarkup = (name: 'users' | 'clock') => render(<Icon name={name} size={15} />).container.innerHTML;

describe('DeskLayout Access group', () => {
  it('shows Access with Members and Audit log between Agent & settings and Repository', () => {
    const nav = setup({ links: { ...base, members: '#members', audit: '#audit' } });
    const headings = [...nav.querySelectorAll('div')]
      .map((d) => d.textContent)
      .filter((t) => t === 'Access' || t === 'Repository');
    expect(headings).toEqual(['Access', 'Repository']);
    const labels = within(nav)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(labels).toEqual(['Routing rules', 'Skills', 'Agent & settings', 'Members', 'Audit log']);
    const members = within(nav).getByRole('link', { name: 'Members' });
    expect(members.innerHTML).toContain(iconMarkup('users').replace(/^<svg[^>]*>|<\/svg>$/g, ''));
    expect(within(nav).getByRole('link', { name: 'Audit log' }).innerHTML).toContain(
      iconMarkup('clock').replace(/^<svg[^>]*>|<\/svg>$/g, ''),
    );
  });

  it('marks Members as the current page when active is members', () => {
    const nav = setup({ active: 'members', links: { ...base, members: '#members', audit: '#audit' } });
    expect(within(nav).getByRole('link', { name: 'Members' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Audit log' })).not.toHaveAttribute('aria-current');
  });

  it('marks Audit log as the current page when active is audit', () => {
    const nav = setup({ active: 'audit', links: { ...base, members: '#members', audit: '#audit' } });
    expect(within(nav).getByRole('link', { name: 'Audit log' })).toHaveAttribute('aria-current', 'page');
  });

  it('has no Access heading without the two links', () => {
    const nav = setup({ links: base });
    expect(within(nav).queryByText('Access')).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Members' })).toBeNull();
  });

  it('shows only Members when only the members link is given', () => {
    const nav = setup({ links: { ...base, members: '#members' } });
    expect(within(nav).getByText('Access')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Members' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Audit log' })).toBeNull();
  });
});

describe('DeskLayout with partial links', () => {
  it('draws no Configure item and no empty heading when only members is set', () => {
    const nav = setup({ links: { members: '#members' } });
    const labels = within(nav)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(labels).toEqual(['Members']);
    expect(within(nav).getByText('Access')).toBeInTheDocument();
    expect(within(nav).getByText('Repository')).toBeInTheDocument();
    expect(within(nav).getByText('invoicer-api')).toBeInTheDocument();
    expect(within(nav).queryByText('Desk')).toBeNull();
  });

  it('shows neither group heading with no link at all', () => {
    const nav = setup({ links: {} });
    expect(within(nav).queryAllByRole('link')).toEqual([]);
    expect(within(nav).queryByText('Access')).toBeNull();
    expect(within(nav).queryByText('Desk')).toBeNull();
    expect(within(nav).getByText('Repository')).toBeInTheDocument();
  });
});
