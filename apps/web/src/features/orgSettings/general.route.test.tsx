import { act, screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orgAccessQuery } from '@/features/access/queries';
import { GENERAL_ERRORS } from '@/features/orgSettings/general.form';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { applyTenantAdminScenario, type TenantAdminScenario } from '@/mocks/msw/tenantAdminScenarios';
import { renderRoute } from '@/test/renderRoute';

// Real routes, real `can()` over the mock API's grants and the real orgs.update handler; only the data is faked.
const asRole = (scenario: TenantAdminScenario) => () => applyTenantAdminScenario(mockDb, scenario);
const ready = () => screen.findByRole('heading', { level: 1, name: 'General' });
const noAccess = () => screen.findByText("You don't have access");
const nameInput = () => screen.getByLabelText('Name');
const urlInput = () => screen.getByLabelText('URL');
const save = () => screen.getByRole('button', { name: 'Save' });
const orgButton = (name: string) =>
  screen.getByRole('button', { name: `Switch scope, currently organization ${name}` });
const orgPath = `/api/orgs/${ids.org.alice}`;
const patches = () => mockDb.requests('PATCH', orgPath);

// Counted on the wire: every request with its method and path.
let wire: string[] = [];
const onRequest = ({ request }: { request: Request }) =>
  wire.push(`${request.method} ${new URL(request.url).pathname}`);
beforeEach(() => {
  wire = [];
  server.events.on('request:start', onRequest);
});
afterEach(() => server.events.removeListener('request:start', onRequest));
const orgListFetches = () => wire.filter((r) => r === 'GET /auth/organization/list').length;
const patchesOnWire = () => wire.filter((r) => r === `PATCH ${orgPath}`).length;

type Rendered = Awaited<ReturnType<typeof renderRoute>>;
const open = async (scenario: TenantAdminScenario = 'soleOwner'): Promise<Rendered> => {
  const rendered = await renderRoute('/o/alice/settings/general', { scenario: asRole(scenario) });
  await ready();
  return rendered;
};
const replaceText = async (r: Rendered, field: HTMLElement, text: string) => {
  await r.user.click(field);
  if (field instanceof HTMLInputElement) field.select();
  if (text === '') await r.user.keyboard('{Delete}');
  else await r.user.paste(text);
};
/** Records, from now on, whether any DOM change showed "Page not found" or left the page without the General form. */
function watchScreen() {
  const seen = { notFound: false, blank: false, stop: () => {} };
  const check = () => {
    if (document.body.textContent?.includes('Page not found')) seen.notFound = true;
    if (screen.queryByLabelText('Name') === null) seen.blank = true;
  };
  const observer = new MutationObserver(check);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  seen.stop = () => {
    check();
    observer.disconnect();
  };
  return seen;
}
const savedName = () => mockDb.state.orgs.find((o) => o.id === ids.org.alice)?.name;
const savedSlug = () => mockDb.state.orgs.find((o) => o.id === ids.org.alice)?.slug;

describe('General: rename (BR-14)', () => {
  it('shows the saved name and URL, with Save disabled while nothing changed', async () => {
    await open();
    expect(nameInput()).toHaveValue('Alice');
    expect(urlInput()).toHaveValue('alice');
    expect(save()).toBeDisabled();
  });

  it('TC-14.1: a new name is saved, the toast shows, the org list is refetched and the crumb shows it', async () => {
    const r = await open();
    const before = orgListFetches();
    await replaceText(r, nameInput(), 'Harbor Labs');
    expect(save()).toBeEnabled();
    await r.user.click(save());
    expect(await screen.findByText('Organization updated')).toBeInTheDocument();
    expect(savedName()).toBe('Harbor Labs');
    expect(patches()).toBe(1);
    await waitFor(() => expect(orgListFetches()).toBeGreaterThan(before));
    expect(orgButton('Harbor Labs')).toBeInTheDocument();
    expect(nameInput()).toHaveValue('Harbor Labs');
    expect(save()).toBeDisabled();
  });

  it('sends only the changed field and never refills the URL from the name', async () => {
    const r = await open();
    await replaceText(r, nameInput(), 'Harbor Labs');
    expect(urlInput()).toHaveValue('alice');
    await r.user.click(save());
    await screen.findByText('Organization updated');
    expect(savedSlug()).toBe('alice');
    expect(r.router.state.location.pathname).toBe('/o/alice/settings/general');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders a name with markup as text', async () => {
    const r = await open();
    await replaceText(r, nameInput(), '<img src=x onerror=alert(1)>');
    await r.user.click(save());
    await screen.findByText('Organization updated');
    expect(orgButton('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('General: name validation (BR-15)', () => {
  it('TC-15.1: an empty name shows the error on Name, keeps the input empty and focused, sends nothing', async () => {
    const r = await open();
    await replaceText(r, nameInput(), '');
    await r.user.click(save());
    expect(await screen.findByText(GENERAL_ERRORS.nameEmpty)).toBeInTheDocument();
    expect(nameInput()).toHaveValue('');
    await waitFor(() => expect(nameInput()).toHaveFocus());
    expect(patches()).toBe(0);
    expect(savedName()).toBe('Alice');
    expect(orgButton('Alice')).toBeInTheDocument();
  });

  it('TC-15.2: 101 characters show the length error, keep the input and send nothing', async () => {
    const r = await open();
    const long = 'a'.repeat(101);
    await replaceText(r, nameInput(), long);
    await r.user.click(save());
    expect(await screen.findByText(GENERAL_ERRORS.nameLong)).toBeInTheDocument();
    expect(nameInput()).toHaveValue(long);
    expect(patches()).toBe(0);
    expect(orgButton('Alice')).toBeInTheDocument();
  });

  it.each([
    ['TC-15.3', 100],
    ['TC-15.4', 1],
  ])('%s: a name of %i characters is saved', async (_tc, length) => {
    const r = await open();
    await replaceText(r, nameInput(), 'a'.repeat(length));
    await r.user.click(save());
    expect(await screen.findByText('Organization updated')).toBeInTheDocument();
    expect(savedName()).toBe('a'.repeat(length));
  });

  it('after an error the form revalidates on every change and clears the message once fixed', async () => {
    const r = await open();
    await replaceText(r, nameInput(), '');
    await r.user.click(save());
    await screen.findByText(GENERAL_ERRORS.nameEmpty);
    await r.user.paste('Fixed');
    await waitFor(() => expect(screen.queryByText(GENERAL_ERRORS.nameEmpty)).not.toBeInTheDocument());
  });
});

describe('General: change the URL (BR-16)', () => {
  it('TC-16.1: Save opens the warning dialog with the old and new URL and focus on "Change URL"', async () => {
    const r = await open();
    await replaceText(r, urlInput(), 'acme');
    await r.user.click(save());
    const dialog = await screen.findByRole('dialog', { name: 'Change the organization URL?' });
    expect(dialog).toHaveTextContent(
      '/o/alice becomes /o/acme. Links that use /o/alice will show "not found". Share the new link with your members.',
    );
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Change URL' })).toHaveFocus();
    expect(urlInput()).toHaveAccessibleDescription('/o/ Links that use the old URL will show "not found".');
    expect(patches()).toBe(0);
  });

  it('TC-16.2: Cancel closes the dialog, stays on the page, sends nothing and returns focus to Save', async () => {
    const r = await open();
    await replaceText(r, urlInput(), 'acme');
    await r.user.click(save());
    await screen.findByRole('dialog', { name: 'Change the organization URL?' });
    await r.user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(r.router.state.location.pathname).toBe('/o/alice/settings/general');
    expect(patches()).toBe(0);
    expect(urlInput()).toHaveValue('acme');
    expect(save()).toHaveFocus();
  });

  it('Escape cancels the dialog like Cancel', async () => {
    const r = await open();
    await replaceText(r, urlInput(), 'acme');
    await r.user.click(save());
    await screen.findByRole('dialog');
    await r.user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(patches()).toBe(0);
  });

  // TC-16.3 + Review Focus 4. Every DOM change between the Change URL click and landing is checked, not just the end
  // state: a transient not-found or blank page between the cache write and the route commit must fail it.
  it('after a slug change the page lands on the new URL without rendering not found', async () => {
    const r = await open();
    const seen = watchScreen();
    // The old slug has cached org data (the access query of the page).
    expect(r.queryClient.getQueryCache().findAll({ queryKey: ['org', 'alice'] }).length).toBeGreaterThan(0);
    const historyLength = r.router.history.length;
    await replaceText(r, urlInput(), 'acme-new');
    await r.user.click(save());
    await r.user.click(await screen.findByRole('button', { name: 'Change URL' }));
    await waitFor(() => expect(r.router.state.location.pathname).toBe('/o/acme-new/settings/general'));
    await ready();
    seen.stop();
    expect(seen.notFound).toBe(false);
    expect(seen.blank).toBe(false);
    expect(screen.queryByText('Page not found')).not.toBeInTheDocument();
    expect(savedSlug()).toBe('acme-new');
    expect(patches()).toBe(1);
    expect(r.router.history.length).toBe(historyLength);
    expect(urlInput()).toHaveValue('acme-new');
    expect(save()).toBeDisabled();
    await waitFor(() => expect(r.queryClient.getQueryCache().findAll({ queryKey: ['org', 'alice'] })).toHaveLength(0));
    expect(r.queryClient.getQueryCache().findAll({ queryKey: ['org', 'acme-new'] }).length).toBeGreaterThan(0);
  });

  it('keeps the form and the toast while the new URL loads its access over a slow network', async () => {
    const r = await open();
    let holding = false;
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.get('*/api/me/access', async () => {
        if (holding) await gate;
        return undefined;
      }),
    );
    await replaceText(r, urlInput(), 'acme-new');
    await r.user.click(save());
    const confirmButton = await screen.findByRole('button', { name: 'Change URL' });
    // From here the only access request is the one for the new slug, and it is held.
    holding = true;
    try {
      await r.user.click(confirmButton);
      await waitFor(() => expect(savedSlug()).toBe('acme-new'));
      // The orgs cache holds the new slug, the route has not committed: the form must still be on screen, not blank.
      await waitFor(() => expect(r.router.state.status).toBe('pending'));
      expect(r.router.state.resolvedLocation?.pathname).toBe('/o/alice/settings/general');
      expect(screen.getByLabelText('Name')).toBeInTheDocument();
      expect(screen.queryByText('Page not found')).not.toBeInTheDocument();
    } finally {
      await act(async () => release());
    }
    await waitFor(() => expect(r.router.state.location.pathname).toBe('/o/acme-new/settings/general'));
    await ready();
    expect(await screen.findByText('Organization updated')).toBeInTheDocument();
    expect(urlInput()).toHaveValue('acme-new');
  });

  it('TC-16.4 (client part): the old slug is not found at once and another org of the caller can take it', async () => {
    // The caller also owns a second org, whose URL is changed to the freed one at the end.
    const r = await renderRoute('/o/alice/settings/general', {
      scenario: () => {
        applyTenantAdminScenario(mockDb, 'soleOwner');
        mockDb.state.memberships.push({ userId: ids.user.alice, orgId: ids.org.acme, roleKey: 'owner' });
      },
    });
    await ready();
    await replaceText(r, urlInput(), 'acme-new');
    await r.user.click(save());
    await r.user.click(await screen.findByRole('button', { name: 'Change URL' }));
    await waitFor(() => expect(r.router.state.location.pathname).toBe('/o/acme-new/settings/general'));
    await r.router.navigate({ to: '/o/$org/projects', params: { org: 'alice' } });
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    await r.router.navigate({ to: '/o/$org/projects', params: { org: 'acme-new' } });
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(mockDb.state.orgs.some((o) => o.slug === 'alice')).toBe(false);
    // Free again: another org of the caller takes the old URL through the same form and the real orgs.update (no 409).
    await r.router.navigate({ to: '/o/$org/settings/general', params: { org: 'acme' } });
    await ready();
    await replaceText(r, urlInput(), 'alice');
    await r.user.click(save());
    await r.user.click(await screen.findByRole('button', { name: 'Change URL' }));
    await waitFor(() => expect(r.router.state.location.pathname).toBe('/o/alice/settings/general'));
    expect(screen.queryByText(GENERAL_ERRORS.slugTaken)).not.toBeInTheDocument();
    expect(mockDb.state.orgs.find((o) => o.id === ids.org.acme)?.slug).toBe('alice');
  });

  it('one Save covers the name and the URL: both are sent after the confirmation', async () => {
    const r = await open();
    await replaceText(r, nameInput(), 'Acme New');
    await replaceText(r, urlInput(), 'acme-new');
    await r.user.click(save());
    expect(patches()).toBe(0);
    await r.user.click(await screen.findByRole('button', { name: 'Change URL' }));
    await waitFor(() => expect(r.router.state.location.pathname).toBe('/o/acme-new/settings/general'));
    expect(savedName()).toBe('Acme New');
    expect(savedSlug()).toBe('acme-new');
    await waitFor(() => expect(orgButton('Acme New')).toBeInTheDocument());
  });

  it('a rename alone never opens the dialog', async () => {
    const r = await open();
    await replaceText(r, nameInput(), 'Only Name');
    await r.user.click(save());
    await screen.findByText('Organization updated');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('General: URL validation (BR-17)', () => {
  it.each(['Acme', '-acme', 'acme-', 'my_org', 'my org', 'a'.repeat(64), ''])(
    'TC-17.1/17.2/17.3/17.5: URL %j shows the format error on URL, no dialog, nothing sent',
    async (slug) => {
      const r = await open();
      await replaceText(r, urlInput(), slug);
      await r.user.click(save());
      expect(await screen.findByText(GENERAL_ERRORS.slugFormat)).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(urlInput()).toHaveValue(slug);
      await waitFor(() => expect(urlInput()).toHaveFocus());
      expect(patches()).toBe(0);
      expect(r.router.state.location.pathname).toBe('/o/alice/settings/general');
      expect(savedSlug()).toBe('alice');
    },
  );

  it.each([
    ['TC-17.4', 63],
    ['one character', 1],
  ])('%s: a URL of %i characters is saved and the page moves', async (_tc, length) => {
    const r = await open();
    const slug = 'b'.repeat(length);
    await replaceText(r, urlInput(), slug);
    await r.user.click(save());
    await r.user.click(await screen.findByRole('button', { name: 'Change URL' }));
    await waitFor(() => expect(r.router.state.location.pathname).toBe(`/o/${slug}/settings/general`));
    expect(savedSlug()).toBe(slug);
  });

  it('TC-17.6: a taken URL shows "This URL is taken. Try another." on URL, keeps the input and the page', async () => {
    const r = await open();
    await replaceText(r, urlInput(), 'taken');
    await r.user.click(save());
    await r.user.click(await screen.findByRole('button', { name: 'Change URL' }));
    expect(await screen.findByText(GENERAL_ERRORS.slugTaken)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(urlInput()).toHaveValue('taken');
    await waitFor(() => expect(urlInput()).toHaveFocus());
    expect(r.router.state.location.pathname).toBe('/o/alice/settings/general');
    expect(savedSlug()).toBe('alice');
    // Typing again drops the server message.
    await r.user.type(urlInput(), 'x');
    await waitFor(() => expect(screen.queryByText(GENERAL_ERRORS.slugTaken)).not.toBeInTheDocument());
  });
});

describe('General: API answers the form does not map (spec error handling)', () => {
  it('an unmapped problem shows a Banner with the request id; the input is kept', async () => {
    const r = await open();
    scenarios.problem('orgs.update', { status: 500, title: 'Internal server error', requestId: 'req-g-1' });
    await replaceText(r, nameInput(), 'Harbor');
    await r.user.click(save());
    const banner = await screen.findByText('Internal server error');
    expect(banner).toBeInTheDocument();
    expect(screen.getByText('Request ID: req-g-1')).toBeInTheDocument();
    expect(nameInput()).toHaveValue('Harbor');
    expect(save()).toBeEnabled();
  });

  it('a 403 from the API shows the Banner with the request id and changes nothing', async () => {
    const r = await open();
    scenarios.problem('orgs.update', { status: 403, title: 'Forbidden', type: 'forbidden', requestId: 'req-g-2' });
    await replaceText(r, nameInput(), 'Harbor');
    await r.user.click(save());
    expect(await screen.findByText('Forbidden')).toBeInTheDocument();
    expect(screen.getByText('Request ID: req-g-2')).toBeInTheDocument();
    expect(orgButton('Alice')).toBeInTheDocument();
  });

  it('a 400 with a field pointer shows the server message under that field', async () => {
    const r = await open();
    scenarios.problem('orgs.update', {
      status: 400,
      title: 'Validation failed',
      type: 'validation',
      errors: [{ pointer: '/name', detail: 'The server dislikes this name.' }],
    });
    await replaceText(r, nameInput(), 'Harbor');
    await r.user.click(save());
    expect(await screen.findByText('The server dislikes this name.')).toBeInTheDocument();
    expect(screen.queryByText('Validation failed')).not.toBeInTheDocument();
    await waitFor(() => expect(nameInput()).toHaveFocus());
  });

  it('the Banner goes away on the next save attempt', async () => {
    const r = await open();
    scenarios.problem('orgs.update', { status: 500, title: 'Internal server error' });
    await replaceText(r, nameInput(), 'Harbor');
    await r.user.click(save());
    await screen.findByText('Internal server error');
    server.resetHandlers();
    applyTenantAdminScenario(mockDb, 'soleOwner');
    await r.user.click(save());
    expect(await screen.findByText('Organization updated')).toBeInTheDocument();
    expect(screen.queryByText('Internal server error')).not.toBeInTheDocument();
  });
});

describe('General: who may open it (BR-2, BR-25; org:update is org-level)', () => {
  it('an org admin may rename', async () => {
    const r = await open('admin');
    await replaceText(r, nameInput(), 'Admin Rename');
    await r.user.click(save());
    expect(await screen.findByText('Organization updated')).toBeInTheDocument();
  });

  it.each<[TenantAdminScenario]>([['projectAdmin'], ['member'], ['viewer']])(
    'BR-2 (%s): the no-access state, no form, and orgs.update is never called',
    async (scenario) => {
      await renderRoute('/o/alice/settings/general', { scenario: asRole(scenario) });
      await noAccess();
      expect(screen.queryByRole('heading', { level: 1, name: 'General' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
      expect(patches()).toBe(0);
      expect(patchesOnWire()).toBe(0);
    },
  );

  it('rights lost while the page is open: it turns to no-access and nothing is sent', async () => {
    const r = await open();
    await replaceText(r, nameInput(), 'Harbor Labs');
    // The owner becomes an admin of one project only (org:update is org level) behind the open page; the grants
    // refresh without a navigation, so the page itself must refuse (the route guard already ran).
    const seat = mockDb.state.memberships.find((m) => m.userId === ids.user.alice && m.orgId === ids.org.alice);
    if (!seat) throw new Error('no seat');
    seat.roleKey = 'admin';
    seat.projectIds = [ids.project.invoicerApi];
    await act(async () => {
      await r.queryClient.invalidateQueries({ queryKey: orgAccessQuery('alice').queryKey });
    });
    await noAccess();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(patches()).toBe(0);
    expect(patchesOnWire()).toBe(0);
  });

  it("BR-25: another org's slug shows not found, never its form", async () => {
    await renderRoute('/o/acme/settings/general', { scenario: asRole('soleOwner') });
    await screen.findByText('Page not found');
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(patches()).toBe(0);
  });
});

describe('General: the saved toast', () => {
  it('shows "Organization updated" after a URL change too, and dismisses', async () => {
    const r = await open();
    await replaceText(r, urlInput(), 'acme-new');
    await r.user.click(save());
    await r.user.click(await screen.findByRole('button', { name: 'Change URL' }));
    expect(await screen.findByText('Organization updated')).toBeInTheDocument();
    expect(r.router.state.location.pathname).toBe('/o/acme-new/settings/general');
    await r.user.click(screen.getByRole('button', { name: /dismiss|close/i }));
    await waitFor(() => expect(screen.queryByText('Organization updated')).not.toBeInTheDocument());
  });
});
