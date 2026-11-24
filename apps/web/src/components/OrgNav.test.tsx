import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrgNav } from './OrgNav';

describe('OrgNav', () => {
  it('BR-43: Projects and Settings sit in the Main nav, the active one marked current', () => {
    render(<OrgNav active="settings" projectsHref="/o/acme/projects" settingsHref="/o/acme/settings" />);
    const nav = screen.getByRole('navigation', { name: 'Organization sections' });
    const projects = within(nav).getByRole('link', { name: 'Projects' });
    const settings = within(nav).getByRole('link', { name: 'Org settings' });
    expect(projects).toHaveAttribute('href', '/o/acme/projects');
    expect(settings).toHaveAttribute('href', '/o/acme/settings');
    expect(settings).toHaveAttribute('aria-current', 'page');
    expect(projects).not.toHaveAttribute('aria-current');
  });

  it('the settings tab reads "Org settings"', () => {
    render(<OrgNav projectsHref="/p" settingsHref="/s" />);
    expect(screen.getByRole('link', { name: 'Org settings' })).toHaveAttribute('href', '/s');
  });

  it('BR-43: Projects active marks only Projects', () => {
    render(<OrgNav active="projects" projectsHref="/p" settingsHref="/s" />);
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Org settings' })).not.toHaveAttribute('aria-current');
  });

  it('BR-43: no Settings tab without settingsHref', () => {
    render(<OrgNav active="projects" projectsHref="/p" />);
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Org settings' })).toBeNull();
  });

  it('BR-43: no active tab when active is absent', () => {
    render(<OrgNav projectsHref="/p" settingsHref="/s" />);
    for (const link of screen.getAllByRole('link')) expect(link).not.toHaveAttribute('aria-current');
  });
});
