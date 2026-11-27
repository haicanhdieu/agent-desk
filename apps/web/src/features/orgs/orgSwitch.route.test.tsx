import { createMemoryHistory } from '@tanstack/react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppProviders } from '@/app/providers';
import { createAppQueryClient } from '@/app/queryClient';
import { createAppRouter } from '@/app/router';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

const switchButton = (name: string) =>
  screen.findByRole('button', { name: `Switch scope, currently organization ${name}` });

describe('org switcher on the Projects page', () => {
  it('BR-6: lists both orgs in a menu named Organizations and marks the current one', async () => {
    const { user } = await renderRoute('/o/alice/projects', { scenario: () => scenarios.onboarding('twoOrgs') });
    await user.click(await switchButton('Alice'));
    const menu = await screen.findByRole('dialog', { name: 'Scope' });
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
    const menu = await screen.findByRole('dialog', { name: 'Scope' });
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

  it('BR-9: one org shows its name with no switch button; Projects is in the org menu', async () => {
    await renderRoute('/o/alice/projects', { scenario: () => scenarios.onboarding('singleOrg') });
    await screen.findByRole('link', { name: 'invoicer-api' });
    const [bar] = screen.getAllByRole('banner');
    if (!bar) throw new Error('no top bar');
    expect(within(bar).getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Switch scope/ })).toBeNull();
    const menu = screen.getByRole('navigation', { name: 'Organization menu' });
    expect(within(menu).getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.queryByText('Switch organization')).toBeNull();
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

  it('BR-40: a platform admin of one org is offered Create organization, linking to /platform/orgs/new', async () => {
    const { user } = await renderRoute('/o/alice/projects', {
      scenario: () => scenarios.onboarding('platformAdminOneOrg'),
    });
    await user.click(await switchButton('Alice'));
    const menu = await screen.findByRole('dialog', { name: 'Scope' });
    expect(within(menu).getByRole('link', { name: 'Create organization' })).toHaveAttribute(
      'href',
      '/platform/orgs/new',
    );
  });

  it('BR-46: an owner who is not a platform admin sees no Create organization', async () => {
    const { user } = await renderRoute('/o/alice/projects', { scenario: () => scenarios.onboarding('twoOrgs') });
    await user.click(await switchButton('Alice'));
    const menu = await screen.findByRole('dialog', { name: 'Scope' });
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
    expect(await screen.findByRole('dialog', { name: 'Scope' })).toBeInTheDocument();
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
    await user.click(await screen.findByRole('button', { name: /^Switch scope/ }));
    const menu = await screen.findByRole('dialog', { name: 'Scope' });
    expect(within(menu).getByRole('link', { name: 'Platform' })).toHaveAttribute('href', '/platform');
  });

  it('BR-1: a platform admin with no org sees Platform in the no-org menu', async () => {
    const { user } = await renderRoute('/invitations', { scenario: () => scenarios.platform('platformAdminNoOrg') });
    await user.click(await screen.findByRole('button', { name: 'Switch scope, currently no organization' }));
    const menu = await screen.findByRole('dialog', { name: 'Scope' });
    expect(within(menu).getByRole('link', { name: /^Platform$/ })).toHaveAttribute('href', '/platform');
  });

  it('BR-1: an owner who is not a platform admin never sees Platform', async () => {
    await renderRoute('/o/alice/projects', { scenario: () => scenarios.platform('ownerNoPlatform') });
    await screen.findByRole('navigation', { name: 'Organization menu' });
    // One org and no platform role: nothing to switch to, so there is no scope menu to open.
    expect(screen.queryByRole('button', { name: /^Switch scope/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Platform' })).toBeNull();
  });

  it('a 500 on me.platform hides Platform and the page still renders', async () => {
    await renderRoute('/o/alice/projects', {
      scenario: () => {
        scenarios.platform('platformAdminOrgs');
        scenarios.serverError('me.platform');
      },
    });
    await screen.findByRole('link', { name: 'invoicer-api' });
    expect(screen.queryByRole('link', { name: 'Platform' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Manage in Platform' })).toBeNull();
  });
});

describe('org switcher with a suspended organization (BR-48, BR-37)', () => {
  it('lists the suspended org with "Suspended"; the other org links and opens normally', async () => {
    const { user, router } = await renderRoute('/o/alice/projects', {
      scenario: () => scenarios.platform('suspendedMember'),
    });
    await user.click(await switchButton('Alice'));
    const menu = await screen.findByRole('dialog', { name: 'Scope' });
    expect(within(menu).getByRole('link', { name: /Alice/ })).toHaveTextContent('Suspended');
    const acme = within(menu).getByRole('link', { name: 'Acme' });
    expect(acme).not.toHaveTextContent('Suspended');
    await user.click(acme);
    expect(await screen.findByRole('link', { name: 'storefront' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/o/acme/projects');
  });
});

// BR-80: the org list is held, then fails. The first list request waits for `settle`; later ones answer by `next`.
let wire: string[] = [];
const onRequest = ({ request }: { request: Request }) => {
  wire.push(`${request.method} ${new URL(request.url).pathname}`);
};
beforeEach(() => {
  wire = [];
  server.events.on('request:start', onRequest);
});
afterEach(() => server.events.removeListener('request:start', onRequest));
const sent = (path: string) => wire.filter((r) => r === `GET ${path}`).length;
const LIST = '/auth/organization/list';

function holdList(next: 'ok' | 'fail' = 'ok') {
  let settle: (outcome: 'ok' | 'fail') => void = () => undefined;
  const gate = new Promise<'ok' | 'fail'>((resolve) => {
    settle = resolve;
  });
  let mode: 'ok' | 'fail' = next;
  let calls = 0;
  server.use(
    http.get('*/auth/organization/list', async () => {
      calls += 1;
      const outcome = calls === 1 ? await gate : mode;
      return outcome === 'fail' ? HttpResponse.json({ message: 'boom' }, { status: 500 }) : undefined;
    }),
  );
  return {
    settle,
    setNext: (m: 'ok' | 'fail') => {
      mode = m;
    },
  };
}

/** Renders at `path` without waiting for the route to load, so the pending state can be looked at. */
function renderNoWait(path: string, scenario: () => void) {
  scenario();
  const queryClient = createAppQueryClient({ retryDelay: 0 });
  const router = createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: [path] }) });
  const user = userEvent.setup();
  render(<AppProviders router={router} queryClient={queryClient} />);
  return { router, queryClient, user };
}

const ADMIN_OWNER = () => scenarios.onboarding('platformAdminOneOrg');
const ORG_PAGE = '/o/alice/projects';
const PROJECT_PAGE = `/o/alice/p/${ids.project.invoicerApi}/runs`;
/** The page's own Retry, in the one main (the menu and the switcher have theirs too). */
const pageRetry = () =>
  waitFor(() => {
    const retry = within(screen.getByRole('main')).queryByRole('button', { name: 'Retry' });
    if (!retry) throw new Error('no page Retry yet');
    return retry;
  });
// The links of the menu's groups; the project menu's "All projects" back link is not an item.
const menuItems = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('link')
    .map((l) => l.textContent)
    .filter((t) => t !== 'All projects');
/** The content area shows its loading state (the route's pending component shows after 300 ms). */
const pendingMain = () =>
  waitFor(
    () => {
      const loading = within(screen.getByRole('main')).queryByRole('status', { name: 'Loading' });
      if (!loading) throw new Error('main is not loading yet');
      return loading;
    },
    { timeout: 3000 },
  );
const sideMenu = () => screen.getByRole('navigation', { name: /^(Organization|Project) menu$/ });
const GATED = /^(Members|Invitations|Audit log|General|Rules|Skills|Agent|Setup|Routing rules)/;

describe.each([
  ['an org page', ORG_PAGE, 'Projects', 'Organization menu'],
  ['a project page', PROJECT_PAGE, 'Runs', 'Project menu'],
] as const)('org list held then failed on %s (BR-80)', (_name, path, item, menuName) => {
  it('TC-80.7 / TC-80.8: the content waits, then fails with Retry, never the loaded page, each with one main', async () => {
    const held = holdList('fail');
    renderNoWait(path, ADMIN_OWNER);
    await pendingMain();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.queryByRole('heading', { level: 1, name: /^(Projects|Runs)$/ })).toBeNull();
    held.settle('fail');
    await pageRetry();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.queryByRole('heading', { level: 1, name: /^(Projects|Runs)$/ })).toBeNull();
  });

  it('TC-80.7 / TC-80.8: while it waits the menu holds only the one item, no skeleton rows, no org or project name, no gated item', async () => {
    const held = holdList('fail');
    renderNoWait(path, ADMIN_OWNER);
    const menu = await screen.findByRole('navigation', { name: menuName });
    expect(menuItems(menu)).toEqual([item]);
    expect(within(menu).queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(within(menu).queryByText('Could not load the menu.')).toBeNull();
    expect(within(menu).queryByRole('link', { name: 'Manage in Platform' })).toBeNull();
    expect(within(menu).queryByRole('status')).toBeNull();
    expect(menu.querySelector('[aria-busy="true"]')).toBeNull();
    expect(document.body).not.toHaveTextContent('Alice');
    expect(document.body).not.toHaveTextContent('invoicer-api');
    held.settle('fail');
    await pageRetry();
  });

  it('TC-80.9: after the failure the menu adds "Could not load the menu." and Retry, and still has no gated item, no Manage in Platform, no name', async () => {
    const held = holdList('fail');
    renderNoWait(path, ADMIN_OWNER);
    held.settle('fail');
    const menu = await screen.findByRole('navigation', { name: menuName });
    expect(await within(menu).findByText('Could not load the menu.')).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(menuItems(menu)).toEqual([item]);
    expect(within(menu).queryByRole('link', { name: GATED })).toBeNull();
    expect(within(menu).queryByRole('link', { name: 'Manage in Platform' })).toBeNull();
    expect(document.body).not.toHaveTextContent('Alice');
    expect(document.body).not.toHaveTextContent('invoicer-api');
  });

  it('sends no org or project query while membership is unknown', async () => {
    const held = holdList('fail');
    renderNoWait(path, ADMIN_OWNER);
    await pendingMain();
    held.settle('fail');
    await pageRetry();
    expect(sent('/api/projects')).toBe(0);
    expect(sent('/api/me/access')).toBe(0);
    expect(sent(LIST)).toBeGreaterThan(0);
  });

  it('TC-80.10: the menu Retry brings the role items; the page loads after its own Retry at the latest', async () => {
    const held = holdList('fail');
    const { user } = renderNoWait(path, ADMIN_OWNER);
    held.settle('fail');
    const menu = await screen.findByRole('navigation', { name: menuName });
    await within(menu).findByText('Could not load the menu.');
    held.setNext('ok');
    await user.click(within(menu).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(within(sideMenu()).getAllByRole('link').length).toBeGreaterThan(1));
    expect(within(sideMenu()).queryByText('Could not load the menu.')).toBeNull();
    const pageRetry = screen.queryByRole('button', { name: 'Retry' });
    if (pageRetry) await user.click(pageRetry);
    expect(await screen.findByRole('heading', { level: 1, name: /^(Projects|Runs)$/ })).toBeInTheDocument();
  });
});

describe('the org switcher while the org list loads or fails (BR-80, BR-53)', () => {
  const switcher = () => screen.findByRole('button', { name: /^Switch scope/ });

  it('TC-80.1: held, it shows the loading state and no org entry; the button reads "Organization", never "No organization"', async () => {
    holdList('ok');
    const { user } = renderNoWait('/invitations', () => scenarios.onboarding('twoOrgs'));
    const button = await switcher();
    expect(button).toHaveTextContent('Organization');
    expect(button).not.toHaveTextContent('No organization');
    await user.click(button);
    const menu = await screen.findByRole('dialog', { name: 'Scope' });
    expect(within(menu).getByRole('status')).toHaveTextContent('Loading organizations');
    expect(within(menu).queryByRole('link')).toBeNull();
    expect(within(menu).queryByText('No organization')).toBeNull();
    expect(screen.queryByText('Alice')).toBeNull();
  });

  it('TC-80.2: failed, it shows "Could not load your organizations." with Retry and no org entry', async () => {
    const held = holdList('fail');
    const { user } = renderNoWait('/invitations', () => scenarios.onboarding('twoOrgs'));
    held.settle('fail');
    const button = await switcher();
    await user.click(button);
    const menu = await screen.findByRole('dialog', { name: 'Scope' });
    expect(await within(menu).findByText('Could not load your organizations.')).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(within(menu).queryByRole('link')).toBeNull();
    expect(button).toHaveTextContent('Organization');
  });

  it("the switcher's Retry refetches only the org list", async () => {
    const held = holdList('fail');
    const { user } = renderNoWait('/o/alice/projects', ADMIN_OWNER);
    held.settle('fail');
    await pageRetry();
    await user.click(await switcher());
    const menu = await screen.findByRole('dialog', { name: 'Scope' });
    await within(menu).findByText('Could not load your organizations.');
    const before = wire.length;
    held.setNext('ok');
    await user.click(within(menu).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(within(menu).queryByText('Could not load your organizations.')).toBeNull());
    const after = wire.slice(before);
    expect(after.filter((r) => r === `GET ${LIST}`)).toHaveLength(1);
    // The page and the menu load their own data once the list is known; the retry itself asks for the list only.
    expect(after.filter((r) => r === 'GET /api/projects')).toEqual([]);
  });

  it('TC-80.11: a failed background refetch keeps the last list and shows no error state', async () => {
    const { user, queryClient } = await renderRoute(ORG_PAGE, { scenario: () => scenarios.onboarding('twoOrgs') });
    await screen.findByRole('heading', { level: 1, name: 'Projects' });
    server.use(http.get('*/auth/organization/list', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['session', 'orgs'] }).catch(() => undefined);
    });
    await user.click(await switcher());
    const menu = await screen.findByRole('dialog', { name: 'Scope' });
    expect(within(menu).getByRole('link', { name: 'Acme' })).toBeInTheDocument();
    expect(within(menu).queryByText('Could not load your organizations.')).toBeNull();
  });
});
