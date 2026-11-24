import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlatformNav } from './PlatformNav';

const links = { orgs: '/platform/orgs', admins: '/platform/admins', audit: '/platform/audit' };

describe('PlatformNav', () => {
  it('is named "Platform sections" and lists Organizations, Platform admins, Audit log in order', () => {
    render(<PlatformNav links={links} />);
    const nav = screen.getByRole('navigation', { name: 'Platform sections' });
    const found = within(nav).getAllByRole('link');
    expect(found.map((l) => l.textContent?.trim())).toEqual(['Organizations', 'Platform admins', 'Audit log']);
    expect(found.map((l) => l.getAttribute('href'))).toEqual(Object.values(links));
    for (const link of found) expect(link).not.toHaveAttribute('aria-current');
  });

  it('marks only the active tab with aria-current and class on', () => {
    render(<PlatformNav active="admins" links={links} />);
    const admins = screen.getByRole('link', { name: 'Platform admins' });
    expect(admins).toHaveAttribute('aria-current', 'page');
    expect(admins).toHaveClass('on');
    expect(screen.getByRole('link', { name: 'Organizations' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Audit log' })).not.toHaveClass('on');
  });
});
