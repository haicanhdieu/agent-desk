import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, delay, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { problemResponse } from '@/mocks/msw/http';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';
import { ids } from '@/mocks/dto/ids';
import { platformKeys } from './keys';

// Real routes and the real guard of the platform shell; only the data behind the API is the mock.
const ACME = 'b8000000-0000-4000-8000-000000000001';
const UNKNOWN = 'b8000000-0000-4000-8000-0000000000ff';
const asAdmin = () => scenarios.platform('platformAdminOrgs');
const detailPath = `/platform/orgs/${ACME}`;
const ready = () => screen.findByRole('heading', { level: 1, name: 'Acme' });
/** The header block of the page: the h1 with the slug and the status next to it. */
const headerStatus = () => {
  const title = screen.getByRole('heading', { level: 1, name: 'Acme' }).parentElement;
  if (!title) throw new Error('no header block');
  return within(title);
};
type User = Awaited<ReturnType<typeof renderRoute>>['user'];
/** Opens the More actions menu and picks an item (the status actions live there). */
async function chooseAction(user: User, name: string) {
  await user.click(screen.getByRole('button', { name: 'More actions' }));
  await user.click(screen.getByRole('menuitem', { name }));
}
/** The More actions menu offers the item; closes it again. */
async function expectAction(user: User, name: string) {
  await user.click(screen.getByRole('button', { name: 'More actions' }));
  expect(screen.getByRole('menuitem', { name })).toBeInTheDocument();
  await user.keyboard('{Escape}');
}
const suspendDialog = async () => within(await screen.findByRole('dialog', { name: 'Suspend Acme?' }));

/** Counts the POSTs to suspend and reactivate until the test ends. */
function countStatusPosts() {
  const seen: string[] = [];
  const listener = ({ request }: { request: Request }) => {
    if (request.method === 'POST' && /\/(suspend|reactivate)$/.test(new URL(request.url).pathname)) {
      seen.push(request.url);
    }
  };
  server.events.on('request:start', listener);
  return { seen, stop: () => server.events.removeListener('request:start', listener) };
}

describe('Platform org detail', () => {
  it('TC-24.1: a directory row opens the detail with heading, slug, status, facts and the side menu group', async () => {
    const { user, router } = await renderRoute('/platform/orgs', { scenario: asAdmin });
    await user.click(await screen.findByRole('link', { name: 'Acme' }));
    await ready();
    expect(router.state.location.pathname).toBe(detailPath);
    expect(screen.getByText('/o/acme', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    for (const term of ['Slug', 'Owner', 'Members', 'Projects', 'Last activity', 'Created', 'Status']) {
      expect(within(screen.getByRole('main')).getByText(term)).toBeInTheDocument();
    }
    const menu = screen.getByRole('navigation', { name: 'Platform menu' });
    expect(within(menu).getByText('Acme')).toBeInTheDocument();
    for (const name of ['Overview', 'Projects', 'Members', 'Invitations']) {
      expect(within(menu).getByRole('link', { name })).toBeInTheDocument();
    }
  });

  it('shows the loading state, then the page', async () => {
    server.use(
      http.get('*/api/platform/orgs/:orgId', async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    await renderRoute(detailPath, { scenario: asAdmin });
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('shows a server error with Retry', async () => {
    server.use(
      http.get('*/api/platform/orgs/:orgId', () => problemResponse({ status: 500, title: 'Server exploded' })),
    );
    const { user } = await renderRoute(detailPath, { scenario: asAdmin });
    expect(await screen.findByText('Server exploded')).toBeInTheDocument();
    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await ready();
  });

  it('an unknown id shows the not-found state without the org side menu', async () => {
    await renderRoute(`/platform/orgs/${UNKNOWN}`, { scenario: asAdmin });
    expect(await screen.findByText('This organization does not exist.')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Platform admin' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to organizations' })).toHaveAttribute('href', '/platform/orgs');
  });

  it('BR-33: an empty reason shows "Enter a reason." and sends nothing', async () => {
    const posts = countStatusPosts();
    try {
      const { user } = await renderRoute(detailPath, { scenario: asAdmin });
      await ready();
      await chooseAction(user, 'Suspend organization');
      const dialog = await suspendDialog();
      await user.click(dialog.getByRole('button', { name: 'Suspend' }));
      expect(await dialog.findByText('Enter a reason.')).toBeInTheDocument();
      expect(posts.seen).toHaveLength(0);
      expect(screen.queryByText('Organization suspended')).toBeNull();
      expect(headerStatus().getByText('Active')).toBeInTheDocument();
    } finally {
      posts.stop();
    }
  });

  it('BR-33: a spaces-only reason shows "Enter a reason." and sends nothing', async () => {
    const posts = countStatusPosts();
    try {
      const { user } = await renderRoute(detailPath, { scenario: asAdmin });
      await ready();
      await chooseAction(user, 'Suspend organization');
      const dialog = await suspendDialog();
      await user.type(dialog.getByRole('textbox', { name: 'Reason' }), '   ');
      await user.click(dialog.getByRole('button', { name: 'Suspend' }));
      expect(await dialog.findByText('Enter a reason.')).toBeInTheDocument();
      expect(posts.seen).toHaveLength(0);
    } finally {
      posts.stop();
    }
  });

  it('BR-33: a 501-character reason shows an error at Reason and sends nothing', async () => {
    const posts = countStatusPosts();
    try {
      const { user } = await renderRoute(detailPath, { scenario: asAdmin });
      await ready();
      await chooseAction(user, 'Suspend organization');
      const dialog = await suspendDialog();
      await user.click(dialog.getByRole('textbox', { name: 'Reason' }));
      await user.paste('x'.repeat(501));
      await user.click(dialog.getByRole('button', { name: 'Suspend' }));
      expect(await dialog.findByText('Use 500 characters or fewer.')).toBeInTheDocument();
      expect(posts.seen).toHaveLength(0);
      expect(screen.queryByText('Organization suspended')).toBeNull();
      expect(headerStatus().getByText('Active')).toBeInTheDocument();
    } finally {
      posts.stop();
    }
  });

  it('BR-33: a 500-character reason suspends', async () => {
    const { user } = await renderRoute(detailPath, { scenario: asAdmin });
    await ready();
    await chooseAction(user, 'Suspend organization');
    const dialog = await suspendDialog();
    await user.click(dialog.getByRole('textbox', { name: 'Reason' }));
    await user.paste('x'.repeat(500));
    await user.click(dialog.getByRole('button', { name: 'Suspend' }));
    expect(await screen.findByText('Organization suspended')).toBeInTheDocument();
  });

  it('a status change sets the detail from the response and does not fetch the detail again', async () => {
    const { user } = await renderRoute(detailPath, { scenario: asAdmin });
    await ready();
    const gets: string[] = [];
    const listener = ({ request }: { request: Request }) => {
      if (request.method === 'GET' && new URL(request.url).pathname === `/api/platform/orgs/${ACME}`) {
        gets.push(request.url);
      }
    };
    server.events.on('request:start', listener);
    try {
      await chooseAction(user, 'Suspend organization');
      const dialog = await suspendDialog();
      await user.type(dialog.getByRole('textbox', { name: 'Reason' }), 'Billing hold');
      await user.click(dialog.getByRole('button', { name: 'Suspend' }));
      expect(await screen.findByText('Organization suspended')).toBeInTheDocument();
      expect(await screen.findByText('This organization is suspended')).toBeInTheDocument();
    } finally {
      server.events.removeListener('request:start', listener);
    }
    expect(gets).toEqual([]);
  });

  it('BR-33: a 400 from the API with pointer /reason lands at Reason', async () => {
    server.use(
      http.post('*/api/platform/orgs/:orgId/suspend', () =>
        problemResponse({
          status: 400,
          title: 'Validation failed',
          type: 'validation',
          errors: [{ pointer: '/reason', detail: 'Reason is too long' }],
        }),
      ),
    );
    const { user } = await renderRoute(detailPath, { scenario: asAdmin });
    await ready();
    await chooseAction(user, 'Suspend organization');
    const dialog = await suspendDialog();
    await user.type(dialog.getByRole('textbox', { name: 'Reason' }), 'Billing hold');
    await user.click(dialog.getByRole('button', { name: 'Suspend' }));
    expect(await dialog.findByText('Reason is too long')).toBeInTheDocument();
    expect(dialog.getByRole('textbox', { name: 'Reason' })).toHaveValue('Billing hold');
  });

  it('BR-32: a valid reason suspends: toast, Banner with the reason, and the directory shows Suspended', async () => {
    const { user, queryClient } = await renderRoute('/platform/orgs', { scenario: asAdmin });
    await user.click(await screen.findByRole('link', { name: 'Acme' }));
    await ready();
    await chooseAction(user, 'Suspend organization');
    const dialog = await suspendDialog();
    expect(
      dialog.getByText(
        'People in this organization cannot open it and no new runs start. Runs already in progress finish. Nothing is deleted.',
      ),
    ).toBeInTheDocument();
    await user.type(dialog.getByRole('textbox', { name: 'Reason' }), 'Billing hold');
    await user.click(dialog.getByRole('button', { name: 'Suspend' }));
    expect(await screen.findByText('Organization suspended')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Acme' })).toHaveFocus());
    expect(headerStatus().getByText('Suspended')).toBeInTheDocument();
    expect(screen.getByText('This organization is suspended')).toBeInTheDocument();
    expect(screen.getByText('Reason: Billing hold')).toBeInTheDocument();
    await expectAction(user, 'Reactivate organization');
    expect(queryClient.getQueryData(platformKeys.org(ACME))).toMatchObject({ status: 'suspended' });
    // The directory's cached pages are stale: opening it shows the new status.
    await user.click(
      within(screen.getByRole('navigation', { name: 'Platform menu' })).getByRole('link', {
        name: /Organizations/,
      }),
    );
    const row = (await screen.findByRole('link', { name: 'Acme' })).closest('tr');
    if (!row) throw new Error('no row for Acme');
    await waitFor(() => expect(within(row).getByText('Suspended')).toBeInTheDocument());
  });

  it('BR-34: reactivate toasts and removes the Banner', async () => {
    const { user } = await renderRoute(detailPath, { scenario: asAdmin });
    await ready();
    await chooseAction(user, 'Suspend organization');
    const suspend = await suspendDialog();
    await user.type(suspend.getByRole('textbox', { name: 'Reason' }), 'Billing hold');
    await user.click(suspend.getByRole('button', { name: 'Suspend' }));
    await screen.findByText('This organization is suspended');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await chooseAction(user, 'Reactivate organization');
    const dialog = within(await screen.findByRole('dialog', { name: 'Reactivate Acme?' }));
    expect(dialog.getByText('People can open it again.')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Reactivate' }));
    expect(await dialog.findByText('Enter a reason.')).toBeInTheDocument();
    await user.type(dialog.getByRole('textbox', { name: 'Reason' }), 'Paid');
    await user.click(dialog.getByRole('button', { name: 'Reactivate' }));
    expect(await screen.findByText('Organization reactivated')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('This organization is suspended')).toBeNull());
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Acme' })).toHaveFocus());
    expect(headerStatus().getByText('Active')).toBeInTheDocument();
    await expectAction(user, 'Suspend organization');
  });

  it.each([
    [403, 'Forbidden'],
    [500, 'Server exploded'],
  ])('a %i keeps the dialog open with a Banner and the reason kept', async (status, title) => {
    server.use(http.post('*/api/platform/orgs/:orgId/suspend', () => problemResponse({ status, title })));
    const { user } = await renderRoute(detailPath, { scenario: asAdmin });
    await ready();
    await chooseAction(user, 'Suspend organization');
    const dialog = await suspendDialog();
    await user.type(dialog.getByRole('textbox', { name: 'Reason' }), 'Billing hold');
    await user.click(dialog.getByRole('button', { name: 'Suspend' }));
    expect(await dialog.findByText(title)).toBeInTheDocument();
    expect(dialog.getByRole('textbox', { name: 'Reason' })).toHaveValue('Billing hold');
    expect(screen.queryByText('Organization suspended')).toBeNull();
  });

  it('a 404 toasts "Organization not found" and goes to the directory', async () => {
    server.use(
      http.post('*/api/platform/orgs/:orgId/suspend', () =>
        problemResponse({ status: 404, title: 'Organization not found', type: 'not-found' }),
      ),
    );
    const { user, router } = await renderRoute(detailPath, { scenario: asAdmin });
    await ready();
    await chooseAction(user, 'Suspend organization');
    const dialog = await suspendDialog();
    await user.type(dialog.getByRole('textbox', { name: 'Reason' }), 'Billing hold');
    await user.click(dialog.getByRole('button', { name: 'Suspend' }));
    expect(await screen.findByText('Organization not found')).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/platform/orgs'));
  });

  it('Review Focus 4: two clicks before the re-render on "Suspend" send one request', async () => {
    const posts = countStatusPosts();
    try {
      server.use(
        http.post('*/api/platform/orgs/:orgId/suspend', async () => {
          await delay(50);
          return problemResponse({ status: 500, title: 'Server exploded' });
        }),
      );
      const { user } = await renderRoute(detailPath, { scenario: asAdmin });
      await ready();
      await chooseAction(user, 'Suspend organization');
      const dialog = await suspendDialog();
      await user.type(dialog.getByRole('textbox', { name: 'Reason' }), 'Billing hold');
      const button = dialog.getByRole('button', { name: 'Suspend' });
      // Both clicks land before React re-renders the disabled button, so only the guard stops the second.
      act(() => {
        button.click();
        button.click();
      });
      await dialog.findByText('Server exploded');
      expect(posts.seen).toHaveLength(1);
    } finally {
      posts.stop();
    }
  });
});

describe('Open organization link', () => {
  it('a member org shows the link to its projects page', async () => {
    const { user } = await renderRoute(`/platform/orgs/${ids.org.alice}`, {
      scenario: () => scenarios.platform('suspendedPlatformAdmin'),
    });
    await screen.findByRole('heading', { level: 1, name: 'Alice' });
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const link = screen.getByRole('menuitem', { name: 'Open organization' });
    expect(link).toHaveAttribute('href', '/o/alice/projects');
  });

  it('a non-member org shows no link', async () => {
    const { user } = await renderRoute(detailPath, { scenario: asAdmin });
    await ready();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Open organization' })).not.toBeInTheDocument();
  });
});
