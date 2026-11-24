import type { PlatformAdminDto } from '@agentdesk/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { accessKeys } from '@/features/access/keys';
import { mockDb } from '@/mocks/msw/db';
import { problemResponse } from '@/mocks/msw/http';
import { server } from '@/mocks/msw/node';
import { seedPlatformAdmins } from '@/mocks/msw/platformAdmins';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

// Real routes and the real guard of the platform shell; only the data behind the API is the mock.
const ready = () => screen.findByRole('heading', { level: 1, name: 'Platform admins' });
const rows = () => screen.getAllByRole('row').slice(1);
const rowOf = (email: string): HTMLElement => {
  const row = rows().find((r) => within(r).queryByText(email) !== null);
  if (!row) throw new Error(`no row for ${email}`);
  return row;
};
const asAdmin = () => scenarios.platform('platformAdminOrgs');
const uuid = (n: number) => `c2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const entry = (n: number, over: Partial<PlatformAdminDto> = {}): PlatformAdminDto => ({
  id: uuid(n),
  email: `admin${n}@example.com`,
  userId: `user-${n}`,
  name: `Admin ${n}`,
  handle: `admin${n}`,
  grantedAt: '2026-10-05T10:30:00.000Z',
  grantedBy: null,
  lastWorkingAdmin: false,
  ...over,
});
const signedInUser = () => {
  const me = mockDb.currentUser();
  if (!me) throw new Error('no signed-in user');
  return me;
};
const withEntries = (entries: PlatformAdminDto[]) => () => {
  asAdmin();
  seedPlatformAdmins(entries);
};

async function openAdd(user: { click: (e: Element) => Promise<void> }) {
  await user.click(screen.getByRole('button', { name: 'Add platform admin' }));
  return screen.findByRole('dialog', { name: 'Add platform admin' });
}

describe('Platform admins page: the list', () => {
  it('BR-5: shows the entries with name, email, handle, added and added by', async () => {
    await renderRoute('/platform/admins', { scenario: asAdmin });
    await ready();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Name',
      'Email',
      'Handle',
      'Added',
      'Added by',
      'Actions',
    ]);
    const pat = within(rowOf('pat@example.com'));
    expect(pat.getByText('Pat')).toBeInTheDocument();
    expect(pat.getByText('pat')).toBeInTheDocument();
    expect(pat.getByText('Dev Admin')).toBeInTheDocument();
  });

  it('BR-5: ?page=2 shows the second page', async () => {
    const many = Array.from({ length: 25 }, (_, i) => entry(i + 1));
    await renderRoute('/platform/admins?page=2', { scenario: withEntries(many) });
    await ready();
    expect(rows()).toHaveLength(5);
    expect(screen.getByText('admin21@example.com')).toBeInTheDocument();
    expect(screen.queryByText('admin1@example.com')).toBeNull();
  });

  it('BR-6, BR-7: tags the own entry "You" and an entry with no account "Not signed in yet"', async () => {
    await renderRoute('/platform/admins', {
      scenario: () => {
        asAdmin();
        const me = signedInUser();
        seedPlatformAdmins([
          entry(1, { userId: me.id, email: me.email.toLowerCase(), name: me.name }),
          entry(2, { userId: null, name: null, handle: null, email: 'seeded@example.com' }),
        ]);
      },
    });
    await ready();
    expect(within(rowOf(signedInUser().email.toLowerCase())).getByText('You')).toBeInTheDocument();
    expect(within(rowOf('seeded@example.com')).getByText('Not signed in yet')).toBeInTheDocument();
  });

  it('BR-4: shows the empty state', async () => {
    await renderRoute('/platform/admins', { scenario: () => scenarios.platform('platformEmpty') });
    expect(await screen.findByText('No platform admins')).toBeInTheDocument();
  });

  it('BR-4: shows the loading state while the list is requested', async () => {
    server.use(
      http.get('/api/platform/admins', async () => {
        await new Promise((r) => setTimeout(r, 200));
        return HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 20 });
      }),
    );
    await renderRoute('/platform/admins', { scenario: asAdmin });
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(await screen.findByText('No platform admins')).toBeInTheDocument();
  });

  it('BR-4: a failing list shows the problem title and Retry loads it again', async () => {
    const { user } = await renderRoute('/platform/admins', {
      scenario: () => {
        asAdmin();
        scenarios.serverError('platform.listAdmins');
      },
    });
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await ready();
    expect(screen.getByText('pat@example.com')).toBeInTheDocument();
  });

  it('shows an admin name that holds markup as text', async () => {
    await renderRoute('/platform/admins', {
      scenario: withEntries([entry(1, { name: '<img src=x onerror=alert(1)>' })]),
    });
    await ready();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('main img')).toBeNull();
  });
});

describe('Platform admins page: grant', () => {
  it('BR-8: a granted email closes the dialog, toasts and refetches', async () => {
    const { user } = await renderRoute('/platform/admins', {
      scenario: () => {
        asAdmin();
        mockDb.state.users.push({ ...signedInUser(), id: 'user-new', email: 'new@example.com', name: 'New One' });
      },
    });
    await ready();
    const dialog = await openAdd(user);
    await user.type(within(dialog).getByLabelText('Email'), 'new@example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Platform admin added')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(rowOf('new@example.com')).toBeInTheDocument();
  });

  it('BR-9: a 400 shows its message under Email and keeps the input', async () => {
    server.use(
      http.post('/api/platform/admins', () =>
        problemResponse({
          status: 400,
          title: 'Validation failed',
          type: 'validation',
          errors: [{ pointer: '/email', detail: 'Enter a valid email address.' }],
        }),
      ),
    );
    const { user } = await renderRoute('/platform/admins', { scenario: asAdmin });
    await ready();
    const dialog = await openAdd(user);
    await user.type(within(dialog).getByLabelText('Email'), 'a@b.co');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(await within(dialog).findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Email')).toHaveValue('a@b.co');
  });

  it('BR-9: an empty or malformed email shows the error and sends nothing', async () => {
    const { user } = await renderRoute('/platform/admins', { scenario: asAdmin });
    await ready();
    const sent = vi.fn();
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST') sent();
    });
    const dialog = await openAdd(user);
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(await within(dialog).findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(sent).not.toHaveBeenCalled();
  });

  it('BR-10: an unknown email shows "No account has this email yet." under Email', async () => {
    const { user } = await renderRoute('/platform/admins', { scenario: asAdmin });
    await ready();
    const dialog = await openAdd(user);
    await user.type(within(dialog).getByLabelText('Email'), 'nobody@example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(await within(dialog).findByText('No account has this email yet.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Email')).toHaveValue('nobody@example.com');
  });

  it('BR-11: an unverified email shows "This email is not verified yet." under Email', async () => {
    server.use(
      http.post('/api/platform/admins', () =>
        problemResponse({
          status: 422,
          title: 'Email not verified',
          type: 'unprocessable',
          errors: [{ pointer: '/email', detail: 'this account has no verified email' }],
        }),
      ),
    );
    const { user } = await renderRoute('/platform/admins', { scenario: asAdmin });
    await ready();
    const dialog = await openAdd(user);
    await user.type(within(dialog).getByLabelText('Email'), 'raw@example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(await within(dialog).findByText('This email is not verified yet.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Email')).toHaveValue('raw@example.com');
  });

  it.each([403, 500])('a %i shows a Banner in the dialog and keeps it open', async (status) => {
    server.use(http.post('/api/platform/admins', () => problemResponse({ status, title: 'Nope', type: 'x' })));
    const { user } = await renderRoute('/platform/admins', { scenario: asAdmin });
    await ready();
    const dialog = await openAdd(user);
    await user.type(within(dialog).getByLabelText('Email'), 'pat@example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(await within(dialog).findByText('Nope')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Email')).toHaveValue('pat@example.com');
  });

  it('BR-12: a repeat grant closes the dialog with no error and the entry shows once', async () => {
    const { user } = await renderRoute('/platform/admins', { scenario: asAdmin });
    await ready();
    const dialog = await openAdd(user);
    await user.type(within(dialog).getByLabelText('Email'), 'pat@example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getAllByText('pat@example.com')).toHaveLength(1);
  });
});

describe('Platform admins page: revoke', () => {
  const revokeButton = (email: string) => screen.getByRole('button', { name: `Revoke platform access for ${email}` });

  it('BR-13: confirming toasts, refetches and focuses the h1', async () => {
    const { user } = await renderRoute('/platform/admins', { scenario: asAdmin });
    await ready();
    await user.click(revokeButton('pat@example.com'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('Platform admin revoked')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('pat@example.com')).toBeNull());
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Platform admins' })).toHaveFocus());
  });

  it('BR-14: Cancel keeps the row and sends nothing', async () => {
    const { user } = await renderRoute('/platform/admins', { scenario: asAdmin });
    await ready();
    await user.click(revokeButton('pat@example.com'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('pat@example.com')).toBeInTheDocument();
  });

  it('BR-15: revoking your own entry drops the access caches and lands outside /platform', async () => {
    const { router, queryClient, user } = await renderRoute('/platform/admins', {
      scenario: () => {
        asAdmin();
        const me = signedInUser();
        seedPlatformAdmins([entry(1, { userId: me.id, email: me.email.toLowerCase(), name: me.name }), entry(2)]);
      },
    });
    await ready();
    const removed = vi.spyOn(queryClient, 'removeQueries');
    await user.click(revokeButton(signedInUser().email.toLowerCase()));
    const dialog = await screen.findByRole('dialog', { name: 'Revoke your own platform access?' });
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(router.state.location.pathname.startsWith('/platform')).toBe(false));
    expect(removed).toHaveBeenCalledWith({ queryKey: accessKeys.session(), exact: true });
    expect(removed).toHaveBeenCalledWith({ queryKey: accessKeys.platform(), exact: true });
  });

  it('BR-16: lastAdmin disables Revoke with "Last admin" on page 2 and leaves page 1 enabled', async () => {
    await renderRoute('/platform/admins?page=2', { scenario: () => scenarios.platform('lastAdmin') });
    await ready();
    expect(screen.getByText('Last admin')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: /^Revoke platform access for / });
    expect(buttons.filter((b) => b.hasAttribute('disabled'))).toHaveLength(1);
  });

  it('BR-16: on page 1 every Revoke is enabled when the working admin is on page 2', async () => {
    await renderRoute('/platform/admins', { scenario: () => scenarios.platform('lastAdmin') });
    await ready();
    expect(screen.queryByText('Last admin')).toBeNull();
    for (const b of screen.getAllByRole('button', { name: /^Revoke platform access for / })) expect(b).toBeEnabled();
  });

  it('BR-17: a 409 toasts the problem title and refetches', async () => {
    const { user } = await renderRoute('/platform/admins', { scenario: () => scenarios.platform('revoke409') });
    await ready();
    await user.click(revokeButton('pat@example.com'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('Last working platform admin')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('pat@example.com')).toBeInTheDocument();
  });
});
