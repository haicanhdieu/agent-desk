import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SubNav } from './SubNav';

const items = [
  { label: 'Skills', href: '/s' },
  { label: 'Rules', href: '/r' },
];

describe('SubNav', () => {
  it('renders one navigation with the given name and a labelled list per group with items', () => {
    render(<SubNav aria-label="Desk" groups={[{ heading: 'Configure', items }, { content: 'free text' }]} />);
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Desk' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Configure' });
    expect(within(list).getAllByRole('link')).toHaveLength(2);
  });

  it('draws no heading for a group without one', () => {
    render(<SubNav aria-label="Desk" groups={[{ items }]} />);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('marks the active item as the page and a parent item as current', () => {
    render(
      <SubNav
        aria-label="Desk"
        groups={[
          {
            items: [
              { label: 'A', href: '/a', active: true },
              { label: 'B', href: '/b', active: 'parent' },
              { label: 'C', href: '/c' },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: 'A' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'B' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('link', { name: 'C' })).not.toHaveAttribute('aria-current');
  });

  it('shows a badge with "needs you" for a positive count, nothing for 0, and large counts as they are', () => {
    render(
      <SubNav
        aria-label="Desk"
        groups={[
          {
            items: [
              { label: 'A', href: '/a', badge: 3 },
              { label: 'B', href: '/b', badge: 0 },
              { label: 'C', href: '/c', badge: 150 },
            ],
          },
        ]}
      />,
    );
    expect(within(screen.getByRole('link', { name: /^A/ })).getByText('3 needs you')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'B' })).toHaveTextContent(/^B$/);
    expect(within(screen.getByRole('link', { name: /^C/ })).getByText('150 needs you')).toBeInTheDocument();
  });

  it('loading shows a status and no item links but keeps the back link and collapse button', () => {
    render(
      <SubNav
        aria-label="Desk"
        state="loading"
        groups={[{ heading: 'G', items }]}
        back={{ label: 'All projects', href: '/projects' }}
        onToggleCollapsed={() => {}}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading menu');
    expect(screen.queryByRole('link', { name: 'Skills' })).toBeNull();
    expect(screen.getByRole('link', { name: /All projects/ })).toHaveAttribute('href', '/projects');
    expect(screen.getByRole('button', { name: 'Collapse menu' })).toBeInTheDocument();
  });

  it('error keeps the items, says the menu could not load and retries', async () => {
    const onRetry = vi.fn();
    render(<SubNav aria-label="Desk" state="error" onRetry={onRetry} groups={[{ items }]} />);
    expect(screen.getByRole('link', { name: 'Skills' })).toBeInTheDocument();
    expect(screen.getByText('Could not load the menu.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('collapsed shows only Expand menu, with no link in the tab order, in the same-named nav', () => {
    render(
      <SubNav
        aria-label="Desk"
        collapsed
        groups={[{ heading: 'G', items }]}
        back={{ label: 'All projects', href: '/projects' }}
        onToggleCollapsed={() => {}}
      />,
    );
    expect(screen.getByRole('navigation', { name: 'Desk' })).toBeInTheDocument();
    const expand = screen.getByRole('button', { name: 'Expand menu' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('Collapse menu is expanded and sits in the back link row; the toggle keeps focus', async () => {
    const props = {
      'aria-label': 'Desk',
      groups: [{ items }],
      back: { label: 'All projects', href: '/projects' },
      onToggleCollapsed: () => {},
    };
    const { rerender } = render(<SubNav {...props} />);
    const collapse = screen.getByRole('button', { name: 'Collapse menu' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    expect(collapse.parentElement).toBe(screen.getByRole('link', { name: /All projects/ }).parentElement);
    collapse.focus();
    rerender(<SubNav {...props} collapsed />);
    expect(screen.getByRole('button', { name: 'Expand menu' })).toHaveFocus();
  });

  it('has no collapse button without onToggleCollapsed, and Close menu with onClose', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<SubNav aria-label="Desk" groups={[{ items }]} />);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<SubNav aria-label="Desk" groups={[{ items }]} onToggleCollapsed={() => {}} onClose={onClose} />);
    expect(screen.queryByRole('button', { name: 'Collapse menu' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders header and footer', () => {
    render(<SubNav aria-label="Desk" groups={[{ items }]} header={<p>head</p>} footer={<p>foot</p>} />);
    expect(screen.getByText('head')).toBeInTheDocument();
    expect(screen.getByText('foot')).toBeInTheDocument();
  });
});
