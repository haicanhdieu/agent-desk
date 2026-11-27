import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockDb } from '@/mocks/msw/db';
import { scenarios } from '@/mocks/msw/scenarios';
import { applyShellScenario, type ShellScenario } from '@/mocks/msw/shellScenarios';
import { applyTenantAdminScenario, type TenantAdminScenario } from '@/mocks/msw/tenantAdminScenarios';
import { renderRoute } from '@/test/renderRoute';

// Real routes, real `can()` over the mock API's grants; only the data behind the API is faked.
const asRole = (scenario: TenantAdminScenario) => () => applyTenantAdminScenario(mockDb, scenario);
const asShell = (scenario: ShellScenario) => () => applyShellScenario(scenario);

const orgMenu = () => screen.getByRole('navigation', { name: 'Organization menu' });
const menuItems = () =>
  within(orgMenu())
    .getAllByRole('link')
    .map((a) => a.textContent);
const topBars = () => screen.getAllByRole('link', { name: /^Agent Desk, all projects/ });
const noAccess = () => screen.findByText("You don't have access");

describe('settings pages on the shell: breadcrumb and title', () => {
  it('BR-17: the bar names the page only: no "Org settings" crumb, and the title reads "Members · <org> · Agent Desk"', async () => {
    await renderRoute('/o/alice/settings/members', { scenario: asRole('soleOwner') });
    await screen.findByRole('navigation', { name: 'Organization menu' });
    const crumbs = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    expect(crumbs.queryByRole('link', { name: 'Org settings' })).not.toBeInTheDocument();
    expect(crumbs.getByText('Members')).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(document.title).toMatch(/^Members · .+ · Agent Desk$/));
  });

  it('draws one top bar and one org menu', async () => {
    await renderRoute('/o/alice/settings/audit', { scenario: asRole('soleOwner') });
    await screen.findByRole('navigation', { name: 'Organization menu' });
    expect(topBars()).toHaveLength(1);
    expect(screen.queryByRole('navigation', { name: 'Organization settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Organization sections' })).not.toBeInTheDocument();
  });
});

describe('settings layout: who lands where', () => {
  it.each<[TenantAdminScenario]>([['soleOwner'], ['admin']])(
    'BR-21 (%s): /settings lands on Members; the menu holds Projects, then Settings with the four pages in order',
    async (scenario) => {
      const { router } = await renderRoute('/o/alice/settings', { scenario: asRole(scenario) });
      await screen.findByRole('heading', { level: 1, name: 'Members' });
      expect(router.state.location.pathname).toBe('/o/alice/settings/members');
      expect(menuItems()).toEqual(['Projects', 'Members', 'Invitations', 'Audit log', 'General']);
      expect(within(orgMenu()).getByRole('link', { name: 'Members' })).toHaveAttribute('aria-current', 'page');
    },
  );

  it('BR-21/BR-19: a project admin lands on Invitations with Projects and Invitations only', async () => {
    const { router } = await renderRoute('/o/alice/settings', { scenario: asRole('projectAdmin') });
    await screen.findByRole('heading', { level: 1, name: 'Invitations' });
    expect(router.state.location.pathname).toBe('/o/alice/settings/invitations');
    expect(menuItems()).toEqual(['Projects', 'Invitations']);
  });

  it('BR-21: a person who may only read the audit log lands on Audit log', async () => {
    const { router } = await renderRoute('/o/alice/settings', { scenario: asShell('auditOnly') });
    await waitFor(() => expect(router.state.location.pathname).toBe('/o/alice/settings/audit'));
    expect(menuItems()).toEqual(['Projects', 'Audit log']);
  });

  it('BR-21: a person who may only update the org lands on General', async () => {
    const { router } = await renderRoute('/o/alice/settings', { scenario: asShell('orgUpdateOnly') });
    await waitFor(() => expect(router.state.location.pathname).toBe('/o/alice/settings/general'));
    expect(menuItems()).toEqual(['Projects', 'General']);
  });

  it('BR-2: a project admin never gets General, Members or Audit from the project grant', async () => {
    await renderRoute('/o/alice/settings/general', { scenario: asRole('projectAdmin') });
    await noAccess();
    expect(menuItems()).toEqual(['Projects', 'Invitations']);
  });

  it.each<[TenantAdminScenario]>([['member'], ['viewer']])(
    'BR-18/BR-21 (%s): the no-access state with the org menu holding Projects only',
    async (scenario) => {
      const { router } = await renderRoute('/o/alice/settings', { scenario: asRole(scenario) });
      await noAccess();
      expect(router.state.location.pathname).toBe('/o/alice/settings');
      expect(topBars()).toHaveLength(1);
      expect(menuItems()).toEqual(['Projects']);
      expect(within(orgMenu()).queryByText('Settings')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Manage in Platform' })).not.toBeInTheDocument();
      await waitFor(() => expect(document.title).toBe("You don't have access · Agent Desk"));
    },
  );

  it('BR-2: a member typing a settings tab URL sees no-access and no settings content', async () => {
    await renderRoute('/o/alice/settings/invitations', { scenario: asRole('member') });
    await noAccess();
    expect(menuItems()).toEqual(['Projects']);
    expect(screen.queryByRole('heading', { level: 1, name: 'Invitations' })).not.toBeInTheDocument();
  });

  it('BR-2: a person with no role in the org sees no-access with the org menu', async () => {
    await renderRoute('/o/acme/settings', { scenario: () => scenarios.onboarding('twoOrgsNoRoleInSecond') });
    await noAccess();
    expect(screen.queryByRole('navigation', { name: 'Organization settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Members' })).not.toBeInTheDocument();
  });

  it("BR-25: another org's settings URL shows not found, never its content", async () => {
    await renderRoute('/o/acme/settings', { scenario: asRole('soleOwner') });
    await screen.findByText('Page not found');
    expect(screen.queryByRole('navigation', { name: 'Organization menu' })).not.toBeInTheDocument();
  });

  it('an unknown tab keeps the bar and the org menu and shows not found', async () => {
    await renderRoute('/o/alice/settings/nope', { scenario: asRole('soleOwner') });
    await screen.findByText('Page not found');
    expect(topBars()).toHaveLength(1);
    expect(menuItems()).toContain('Members');
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
    expect(screen.queryByRole('heading', { level: 1, name: 'Invitations' })).not.toBeInTheDocument();
  });
});

describe('the old Invitations URL', () => {
  it('BR-13: keeps status and page on the Invitations tab', async () => {
    const { router } = await renderRoute('/o/acme/invitations?status=all&page=2', {
      scenario: () => scenarios.onboarding('invitationsPaged'),
    });
    await screen.findByRole('navigation', { name: 'Organization menu' });
    expect(router.state.location.pathname).toBe('/o/acme/settings/invitations');
    expect(router.state.location.search).toEqual({ status: 'all', page: '2' });
  });
});
