import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlatformLayout } from './PlatformLayout';

const links = {
  overview: '/platform/orgs/1',
  projects: '/platform/orgs/1/projects',
  members: '/platform/orgs/1/members',
  invitations: '/platform/orgs/1/invitations',
};

describe('PlatformLayout', () => {
  it('without an org there is no side menu', () => {
    render(
      <PlatformLayout>
        <p>Body</p>
      </PlatformLayout>,
    );
    expect(screen.queryByRole('navigation', { name: 'Platform admin' })).toBeNull();
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('a ready org shows its name as a link to Overview, then Overview, Projects, Members, Invitations', () => {
    render(
      <PlatformLayout active="members" org={{ state: 'ready', name: 'Acme', links }}>
        <p>Body</p>
      </PlatformLayout>,
    );
    const nav = screen.getByRole('navigation', { name: 'Platform admin' });
    const all = within(nav).getAllByRole('link');
    expect(all.map((a) => a.textContent)).toEqual(['Acme', 'Overview', 'Projects', 'Members', 'Invitations']);
    expect(all[0]).toHaveAttribute('href', links.overview);
    expect(within(nav).getByRole('link', { name: 'Members' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });

  it('an absent link hides its item', () => {
    render(
      <PlatformLayout active="overview" org={{ state: 'ready', name: 'Acme', links: { overview: links.overview } }}>
        <p>Body</p>
      </PlatformLayout>,
    );
    const nav = screen.getByRole('navigation', { name: 'Platform admin' });
    expect(within(nav).queryByRole('link', { name: 'Members' })).toBeNull();
  });

  it('renders a long org name as text with a title', () => {
    const name = 'A very long organization name '.repeat(6).trim();
    render(
      <PlatformLayout active="overview" org={{ state: 'ready', name, links }}>
        <p>Body</p>
      </PlatformLayout>,
    );
    expect(screen.getByTitle(name)).toHaveTextContent(name);
  });

  it('loading shows two placeholders named "Loading organization" in a group as tall as the ready one', () => {
    const { rerender } = render(
      <PlatformLayout org={{ state: 'loading' }}>
        <p>Body</p>
      </PlatformLayout>,
    );
    const nav = screen.getByRole('navigation', { name: 'Platform admin' });
    expect(within(nav).getAllByRole('status', { name: 'Loading organization' })).toHaveLength(2);
    expect(within(nav).queryAllByRole('link')).toEqual([]);
    const loadingClass = nav.querySelector('[data-org-group]')?.className;
    expect(loadingClass).toBeTruthy();
    rerender(
      <PlatformLayout active="overview" org={{ state: 'ready', name: 'Acme', links }}>
        <p>Body</p>
      </PlatformLayout>,
    );
    expect(
      screen.getByRole('navigation', { name: 'Platform admin' }).querySelector('[data-org-group]')?.className,
    ).toBe(loadingClass);
  });

  it('an error group names the org "Organization" and still links', () => {
    render(
      <PlatformLayout active="members" org={{ state: 'error', name: 'Organization', links }}>
        <p>Body</p>
      </PlatformLayout>,
    );
    const nav = screen.getByRole('navigation', { name: 'Platform admin' });
    expect(within(nav).getByRole('link', { name: 'Organization' })).toHaveAttribute('href', links.overview);
  });
});
