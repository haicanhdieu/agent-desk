import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrgSettingsLayout } from './OrgSettingsLayout';

const ALL = {
  audit: '/o/harbor-labs/settings/audit',
  members: '/o/harbor-labs/settings/members',
  invitations: '/o/harbor-labs/settings/invitations',
  general: '/o/harbor-labs/settings/general',
};

describe('OrgSettingsLayout', () => {
  it('lists the tabs in the order General, Members, Invitations, Audit log under an Organization heading', () => {
    render(
      <OrgSettingsLayout tabs={ALL} active="members">
        <p>Body</p>
      </OrgSettingsLayout>,
    );
    const nav = screen.getByRole('navigation', { name: 'Organization settings' });
    expect(within(nav).getByText('Organization')).toBeInTheDocument();
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['General', 'Members', 'Invitations', 'Audit log']);
    expect(within(nav).getByRole('link', { name: 'Members' })).toHaveAttribute('href', ALL.members);
  });

  it('shows only the tabs it is given', () => {
    render(
      <OrgSettingsLayout tabs={{ invitations: ALL.invitations }} active="invitations">
        <p>Body</p>
      </OrgSettingsLayout>,
    );
    const nav = screen.getByRole('navigation', { name: 'Organization settings' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Invitations']);
  });

  it('marks the active tab with aria-current and no other', () => {
    render(
      <OrgSettingsLayout tabs={ALL} active="audit">
        <p>Body</p>
      </OrgSettingsLayout>,
    );
    expect(screen.getByRole('link', { name: 'Audit log' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByRole('link').filter((a) => a.hasAttribute('aria-current'))).toHaveLength(1);
  });

  it('marks no tab when none is active', () => {
    render(
      <OrgSettingsLayout tabs={ALL} active={null}>
        <p>Body</p>
      </OrgSettingsLayout>,
    );
    expect(screen.getAllByRole('link').some((a) => a.hasAttribute('aria-current'))).toBe(false);
  });

  it('renders children in the content area next to the menu', () => {
    render(
      <OrgSettingsLayout tabs={ALL} active="general">
        <p>Body text</p>
      </OrgSettingsLayout>,
    );
    const body = screen.getByText('Body text');
    expect(screen.getByRole('navigation', { name: 'Organization settings' }).contains(body)).toBe(false);
  });
});
