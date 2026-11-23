import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockDb } from '@/mocks/msw/db';
import { scenarios } from '@/mocks/msw/scenarios';
import { applyTenantAdminScenario, type TenantAdminScenario } from '@/mocks/msw/tenantAdminScenarios';
import { renderRoute } from '@/test/renderRoute';

// Real routes, real `can()` over the mock API's grants; only the data behind the API is faked.
const asRole = (scenario: TenantAdminScenario) => () => applyTenantAdminScenario(mockDb, scenario);

const sideMenu = () => screen.queryByRole('navigation', { name: 'Organization settings' });
const sideItems = () =>
  within(screen.getByRole('navigation', { name: 'Organization settings' }))
    .getAllByRole('link')
    .map((a) => a.textContent);
const mainNav = () => within(screen.getByRole('navigation', { name: 'Main' }));
const noAccess = () => screen.findByText("You don't have access");

describe('settings layout: who lands where', () => {
  it.each<[TenantAdminScenario]>([['soleOwner'], ['admin']])(
    'BR-13 (%s): /settings lands on General with the four side-menu items and Settings current in Main',
    async (scenario) => {
      const { router } = await renderRoute('/o/alice/settings', { scenario: asRole(scenario) });
      await screen.findByRole('navigation', { name: 'Organization settings' });
      expect(router.state.location.pathname).toBe('/o/alice/settings/general');
      expect(sideItems()).toEqual(['General', 'Members', 'Invitations', 'Audit log']);
      expect(mainNav().getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
      expect(mainNav().getByRole('link', { name: 'Projects' })).not.toHaveAttribute('aria-current');
    },
  );

  it('BR-13/BR-2: a project admin lands on Invitations with only that item', async () => {
    const { router } = await renderRoute('/o/alice/settings', { scenario: asRole('projectAdmin') });
    await screen.findByRole('heading', { level: 1, name: 'Invitations' });
    expect(router.state.location.pathname).toBe('/o/alice/settings/invitations');
    expect(sideItems()).toEqual(['Invitations']);
    expect(mainNav().getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  });

  it('BR-2: a project admin never gets General, Members or Audit from the project grant', async () => {
    await renderRoute('/o/alice/settings/general', { scenario: asRole('projectAdmin') });
    await screen.findByRole('navigation', { name: 'Organization settings' });
    expect(sideItems()).toEqual(['Invitations']);
  });

  it.each<[TenantAdminScenario]>([['member'], ['viewer']])(
    'BR-2 (%s): the no-access state under the bar, no side menu, no Settings tab',
    async (scenario) => {
      const { router } = await renderRoute('/o/alice/settings', { scenario: asRole(scenario) });
      await noAccess();
      expect(router.state.location.pathname).toBe('/o/alice/settings');
      expect(screen.getByRole('banner')).toBeInTheDocument();
      expect(sideMenu()).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
      expect(mainNav().getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    },
  );

  it('BR-2: a member typing a settings tab URL sees no-access and no settings content', async () => {
    await renderRoute('/o/alice/settings/invitations', { scenario: asRole('member') });
    await noAccess();
    expect(sideMenu()).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Invitations' })).not.toBeInTheDocument();
  });

  it('BR-2: a person with no role in the org sees no-access under the bar', async () => {
    await renderRoute('/o/acme/settings', { scenario: () => scenarios.onboarding('twoOrgsNoRoleInSecond') });
    await noAccess();
    expect(sideMenu()).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it("BR-25: another org's settings URL shows not found, never its content", async () => {
    await renderRoute('/o/acme/settings', { scenario: asRole('soleOwner') });
    await screen.findByText('Page not found');
    expect(sideMenu()).not.toBeInTheDocument();
  });

  it('a failed access query shows an error, never the settings content', async () => {
    await renderRoute('/o/alice/settings', {
      scenario: () => {
        applyTenantAdminScenario(mockDb, 'soleOwner');
        scenarios.serverError('me.access');
      },
    });
    // The retryable error state is what is shown (not a blank page), and it is not the settings content.
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByText('Internal server error')).toBeInTheDocument();
    expect(sideMenu()).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Invitations' })).not.toBeInTheDocument();
  });
});

describe('the old Invitations URL', () => {
  it('BR-13: keeps status and page on the Invitations tab', async () => {
    const { router } = await renderRoute('/o/acme/invitations?status=all&page=2', {
      scenario: () => scenarios.onboarding('invitationsPaged'),
    });
    await screen.findByRole('navigation', { name: 'Organization settings' });
    expect(router.state.location.pathname).toBe('/o/acme/settings/invitations');
    expect(router.state.location.search).toEqual({ status: 'all', page: '2' });
  });
});
