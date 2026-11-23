import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockDb } from '@/mocks/msw/db';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

const switchButton = (name: string) => screen.findByRole('button', { name: `Switch organization, currently ${name}` });

describe('org switcher on the Projects page', () => {
  it('BR-6: lists both orgs in a menu named Organizations and marks the current one', async () => {
    const { user } = await renderRoute('/o/alice/projects', { scenario: () => scenarios.onboarding('twoOrgs') });
    await user.click(await switchButton('Alice'));
    const menu = await screen.findByRole('dialog', { name: 'Organizations' });
    const orgs = within(menu).getByRole('group', { name: 'Switch organization' });
    const alice = within(orgs).getByRole('link', { name: 'Alice' });
    const acme = within(orgs).getByRole('link', { name: 'Acme' });
    expect(alice).toHaveAttribute('href', '/o/alice/projects');
    expect(alice).toHaveAttribute('aria-current');
    expect(acme).toHaveAttribute('href', '/o/acme/projects');
    expect(acme).not.toHaveAttribute('aria-current');
  });

  it('TC-3.2 BR-6: the switcher lists only member orgs, not an org the user was only invited to', async () => {
    const { user } = await renderRoute('/o/alice/projects', {
      scenario: () => {
        scenarios.onboarding('twoOrgs');
        const me = mockDb.state.users[0];
        const other = mockDb.state.orgs.find((o) => o.slug === 'other');
        if (!me || !other) throw new Error('scenario has no user or Other org');
        mockDb.state.invitations = [
          {
            id: 'b7000000-0000-4000-8000-000000000001',
            orgId: other.id,
            email: me.email.toLowerCase(),
            role: { id: 'b8000000-0000-4000-8000-000000000001', key: 'member', name: 'Member' },
            scope: { type: 'org' },
            status: 'pending',
            expiresAt: '2099-01-01T00:00:00.000Z',
            invitedBy: { name: 'Ada Lovelace', handle: 'ada' },
            createdAt: '2026-09-01T09:00:00.000Z',
            acceptedAt: null,
          },
        ];
      },
    });
    expect(await screen.findByText('You have 1 pending invitation.')).toBeInTheDocument();
    await user.click(await switchButton('Alice'));
    const menu = await screen.findByRole('dialog', { name: 'Organizations' });
    expect(within(menu).getByRole('link', { name: 'Alice' })).toBeInTheDocument();
    expect(within(menu).getByRole('link', { name: 'Acme' })).toBeInTheDocument();
    expect(within(menu).queryByRole('link', { name: 'Other' })).toBeNull();
  });

  it('BR-7: picking Acme goes to its projects and shows only its projects', async () => {
    const { user, router } = await renderRoute('/o/alice/projects', {
      scenario: () => scenarios.onboarding('twoOrgs'),
    });
    await screen.findByRole('link', { name: 'invoicer-api' });
    await user.click(await switchButton('Alice'));
    await user.click(await screen.findByRole('link', { name: 'Acme' }));
    expect(await screen.findByRole('link', { name: 'storefront' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/o/acme/projects');
    expect(screen.queryByRole('link', { name: 'invoicer-api' })).toBeNull();
  });

  it('BR-9: one org shows a button whose menu has Projects and no Switch organization', async () => {
    const { user } = await renderRoute('/o/alice/projects', { scenario: () => scenarios.onboarding('singleOrg') });
    await screen.findByRole('link', { name: 'invoicer-api' });
    expect(screen.queryByRole('button', { name: /^Switch organization/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Organization menu, Alice' }));
    const menu = await screen.findByRole('dialog', { name: 'Organizations' });
    expect(within(menu).getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    expect(within(menu).queryByText('Switch organization')).toBeNull();
  });

  it('BR-10: under the new URL a loading state shows and no project of the previous org, until set-active answers', async () => {
    const { user } = await renderRoute('/o/alice/projects', {
      scenario: () => scenarios.onboarding('twoOrgsSlowSwitch'),
    });
    await screen.findByRole('link', { name: 'invoicer-api' });
    await user.click(await switchButton('Alice'));
    await user.click(await screen.findByRole('link', { name: 'Acme' }));
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
    for (const name of ['invoicer-api', 'invoicer-web', 'docs-site', 'billing-jobs']) {
      expect(screen.queryByRole('link', { name })).toBeNull();
    }
    expect(await screen.findByRole('link', { name: 'storefront' }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
  });

  it('BR-12: an org the user is not a member of shows not found', async () => {
    await renderRoute('/o/unknown/projects', { scenario: () => scenarios.onboarding('twoOrgs') });
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('BR-40: a platform admin of one org is offered Create organization, linking to /orgs/new', async () => {
    const { user } = await renderRoute('/o/alice/projects', {
      scenario: () => scenarios.onboarding('platformAdminOneOrg'),
    });
    await user.click(await switchButton('Alice'));
    const menu = await screen.findByRole('dialog', { name: 'Organizations' });
    expect(within(menu).getByRole('link', { name: 'Create organization' })).toHaveAttribute('href', '/orgs/new');
  });

  it('BR-46: an owner who is not a platform admin sees no Create organization', async () => {
    const { user } = await renderRoute('/o/alice/projects', { scenario: () => scenarios.onboarding('twoOrgs') });
    await user.click(await switchButton('Alice'));
    const menu = await screen.findByRole('dialog', { name: 'Organizations' });
    expect(within(menu).queryByRole('link', { name: 'Create organization' })).toBeNull();
  });

  it('TC-44.1 BR-44: picking the no-role org in the switcher shows no-access and the switcher still works', async () => {
    const { user, router } = await renderRoute('/o/alice/projects', {
      scenario: () => scenarios.onboarding('twoOrgsNoRoleInSecond'),
    });
    await screen.findByRole('link', { name: 'invoicer-api' });
    await user.click(await switchButton('Alice'));
    await user.click(await screen.findByRole('link', { name: 'Acme' }));
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/o/acme/projects');
    expect(screen.queryByRole('link', { name: 'invoicer-api' })).toBeNull();
    await user.click(await switchButton('Acme'));
    expect(await screen.findByRole('dialog', { name: 'Organizations' })).toBeInTheDocument();
  });

  it('BR-44: a no-role org shows the no-access state with the switcher still switching back', async () => {
    const { user, router } = await renderRoute('/o/acme/projects', {
      scenario: () => scenarios.onboarding('twoOrgsNoRoleInSecond'),
    });
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument();
    await user.click(await switchButton('Acme'));
    await user.click(await screen.findByRole('link', { name: 'Alice' }));
    expect(await screen.findByRole('link', { name: 'invoicer-api' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/o/alice/projects');
  });

  it('BR-1: a platform admin with orgs sees Platform admin linking to /platform', async () => {
    const { user } = await renderRoute('/o/alice/projects', {
      scenario: () => scenarios.platform('platformAdminOrgs'),
    });
    await user.click(await screen.findByRole('button', { name: /^Switch organization/ }));
    const menu = await screen.findByRole('dialog', { name: 'Organizations' });
    expect(within(menu).getByRole('link', { name: 'Platform admin' })).toHaveAttribute('href', '/platform');
  });

  it('BR-1: a platform admin with no org sees Platform admin in the no-org menu', async () => {
    const { user } = await renderRoute('/orgs/new', { scenario: () => scenarios.platform('platformAdminNoOrg') });
    await user.click(await screen.findByRole('button', { name: 'Switch organization' }));
    const menu = await screen.findByRole('dialog', { name: 'Organizations' });
    expect(within(menu).getByRole('link', { name: 'Platform admin' })).toHaveAttribute('href', '/platform');
  });

  it('BR-1: an owner who is not a platform admin never sees Platform admin', async () => {
    const { user } = await renderRoute('/o/alice/projects', { scenario: () => scenarios.platform('ownerNoPlatform') });
    await user.click(await screen.findByRole('button', { name: 'Organization menu, Alice' }));
    const menu = await screen.findByRole('dialog', { name: 'Organizations' });
    expect(within(menu).queryByRole('link', { name: 'Platform admin' })).toBeNull();
  });

  it('a 500 on me.platform hides Platform admin and the page still renders', async () => {
    const { user } = await renderRoute('/o/alice/projects', {
      scenario: () => {
        scenarios.platform('platformAdminOrgs');
        scenarios.serverError('me.platform');
      },
    });
    await screen.findByRole('link', { name: 'invoicer-api' });
    await user.click(await screen.findByRole('button', { name: /^(Switch organization|Organization menu)/ }));
    const menu = await screen.findByRole('dialog', { name: 'Organizations' });
    expect(within(menu).queryByRole('link', { name: 'Platform admin' })).toBeNull();
  });
});
