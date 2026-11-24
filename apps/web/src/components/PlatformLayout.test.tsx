import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlatformLayout } from './PlatformLayout';

const links = { orgs: '/platform/orgs', admins: '/platform/admins', audit: '/platform/audit' };

describe('PlatformLayout', () => {
  it('lists Organizations, Platform admins and Audit log in a "Platform admin" nav', () => {
    render(
      <PlatformLayout active="orgs" links={links}>
        <p>Body</p>
      </PlatformLayout>,
    );
    const nav = screen.getByRole('navigation', { name: 'Platform admin' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Organizations', 'Platform admins', 'Audit log']);
    expect(within(nav).getByRole('link', { name: 'Platform admins' })).toHaveAttribute('href', links.admins);
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('marks the active item with aria-current="page"', () => {
    render(
      <PlatformLayout active="admins" links={links}>
        <p>Body</p>
      </PlatformLayout>,
    );
    expect(screen.getByRole('link', { name: 'Platform admins' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Organizations' })).not.toHaveAttribute('aria-current');
  });

  it('inside an org adds a group headed by the org name with Overview and only the given links', () => {
    render(
      <PlatformLayout
        active="members"
        links={links}
        org={{ name: 'Acme', links: { overview: '/platform/orgs/1', members: '/platform/orgs/1/members' } }}
      >
        <p>Body</p>
      </PlatformLayout>,
    );
    const nav = screen.getByRole('navigation', { name: 'Platform admin' });
    expect(within(nav).getByText('Acme')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/platform/orgs/1');
    expect(within(nav).getByRole('link', { name: 'Members' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).queryByRole('link', { name: 'Projects' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Invitations' })).toBeNull();
  });

  it('renders a long org name as text with a title', () => {
    const name = 'A very long organization name '.repeat(6).trim();
    render(
      <PlatformLayout active="overview" links={links} org={{ name, links: { overview: '/platform/orgs/1' } }}>
        <p>Body</p>
      </PlatformLayout>,
    );
    expect(screen.getByTitle(name)).toHaveTextContent(name);
  });
});
