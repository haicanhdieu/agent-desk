import { screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GENERAL_ERRORS } from '@/features/orgSettings/general.form';
import { problemResponse } from '@/mocks/msw/http';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

// Real routes and the real guard of the platform shell; only the data behind the API is the mock.
const ACME = 'b9100000-0000-4000-8000-000000000001';
const detailPath = `/platform/orgs/${ACME}`;
const asEditable = () => scenarios.platform('platformOrgEdit');
const asSuspended = () => scenarios.platform('platformOrgEditSuspended');
const ready = (name = 'Acme') => screen.findByRole('heading', { level: 1, name });
const nameInput = () => screen.getByLabelText('Name');
const urlInput = () => screen.getByLabelText('URL');
const save = () => screen.getByRole('button', { name: 'Save' });

let patches: { url: string; body: unknown }[] = [];
const onRequest = ({ request }: { request: Request }) => {
  if (request.method === 'PATCH' && new URL(request.url).pathname === `/api/platform/orgs/${ACME}`) {
    void request
      .clone()
      .json()
      .then((body: unknown) => patches.push({ url: request.url, body }));
  }
};
beforeEach(() => {
  patches = [];
  server.events.on('request:start', onRequest);
});
afterEach(() => server.events.removeListener('request:start', onRequest));

type Rendered = Awaited<ReturnType<typeof renderRoute>>;
const open = async (scenario = asEditable): Promise<Rendered> => {
  const r = await renderRoute(detailPath, { scenario });
  await ready();
  await r.user.click(screen.getByRole('button', { name: 'Edit organization' }));
  await screen.findByRole('dialog', { name: 'Edit organization' });
  return r;
};
const replaceText = async (r: Rendered, field: HTMLElement, text: string) => {
  await r.user.click(field);
  if (field instanceof HTMLInputElement) field.select();
  if (text === '') await r.user.keyboard('{Delete}');
  else await r.user.paste(text);
};

describe('Platform org edit', () => {
  it('prefills the dialog and keeps Save disabled until a value differs; back to the current values disables it again (BR-59)', async () => {
    const r = await open();
    expect(nameInput()).toHaveValue('Acme');
    expect(urlInput()).toHaveValue('acme');
    expect(save()).toBeDisabled();
    await replaceText(r, nameInput(), 'Acme Inc');
    expect(save()).toBeEnabled();
    await replaceText(r, nameInput(), 'Acme');
    expect(save()).toBeDisabled();
    await r.user.keyboard('{Enter}');
    expect(patches).toHaveLength(0);
  });

  it('a name-only save sends only the name, shows no confirm, toasts, stays put and updates header and directory (BR-53, BR-57)', async () => {
    const r = await open();
    await replaceText(r, nameInput(), 'Acme Inc');
    await r.user.click(save());
    expect(await screen.findByText('Organization updated')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await ready('Acme Inc')).toBeInTheDocument();
    expect(r.router.state.location.pathname).toBe(detailPath);
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]?.body).toEqual({ name: 'Acme Inc' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit organization' })).toHaveFocus());
    await r.router.navigate({ to: '/platform/orgs' });
    expect(await screen.findByRole('link', { name: 'Acme Inc' })).toBeInTheDocument();
  });

  it('a slug change asks first; Cancel returns to the dialog with the input kept and sends nothing; Change URL saves (BR-57)', async () => {
    const r = await open();
    await replaceText(r, urlInput(), 'acme-inc');
    await r.user.click(save());
    const confirm = await screen.findByRole('dialog', { name: 'Change the organization URL?' });
    expect(confirm).toHaveTextContent('Share the new link with its members.');
    expect(patches).toHaveLength(0);
    await r.user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('dialog', { name: 'Edit organization' })).toBeInTheDocument();
    expect(urlInput()).toHaveValue('acme-inc');
    expect(patches).toHaveLength(0);
    await r.user.click(save());
    await r.user.click(await screen.findByRole('button', { name: 'Change URL' }));
    expect(await screen.findByText('Organization updated')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('/o/acme-inc', { selector: 'span' })).toBeInTheDocument());
    expect(patches[0]?.body).toEqual({ slug: 'acme-inc' });
  });

  it.each([
    ['', '', GENERAL_ERRORS.nameEmpty, 'Name'],
    ['', 'a'.repeat(101), GENERAL_ERRORS.nameLong, 'Name'],
    ['bad slug', '', GENERAL_ERRORS.slugFormat, 'URL'],
  ])(
    'BR-54/55: shows the field message and focuses the first invalid field (%#)',
    async (slug, longName, message, label) => {
      const r = await open();
      if (label === 'URL') await replaceText(r, urlInput(), slug);
      else await replaceText(r, nameInput(), longName);
      await r.user.click(save());
      expect(await screen.findByText(message)).toBeInTheDocument();
      await waitFor(() => expect(screen.getByLabelText(label)).toHaveFocus());
      expect(patches).toHaveLength(0);
    },
  );

  it('BR-56: a 409 lands "This URL is taken. Try another." at URL with the input kept', async () => {
    const r = await open();
    await replaceText(r, urlInput(), 'beta');
    await r.user.click(save());
    await r.user.click(await screen.findByRole('button', { name: 'Change URL' }));
    expect(await screen.findByText(GENERAL_ERRORS.slugTaken)).toBeInTheDocument();
    expect(urlInput()).toHaveValue('beta');
    expect(screen.getByRole('dialog', { name: 'Edit organization' })).toBeInTheDocument();
  });

  it('a 404 toasts "Organization not found" and goes to the directory', async () => {
    const r = await open();
    server.use(http.patch('*/api/platform/orgs/:orgId', () => problemResponse({ status: 404, title: 'Not found' })));
    await replaceText(r, nameInput(), 'Acme Inc');
    await r.user.click(save());
    expect(await screen.findByText('Organization not found')).toBeInTheDocument();
    await waitFor(() => expect(r.router.state.location.pathname).toBe('/platform/orgs'));
  });

  it.each([403, 500])('a %i shows the Banner with the request id and keeps the dialog', async (status) => {
    const r = await open();
    server.use(
      http.patch('*/api/platform/orgs/:orgId', () =>
        problemResponse({ status, title: 'Nope', requestId: 'req-edit-1' }),
      ),
    );
    await replaceText(r, nameInput(), 'Acme Inc');
    await r.user.click(save());
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit organization' }));
    expect(await dialog.findByText('Nope')).toBeInTheDocument();
    expect(dialog.getByText('Request ID: req-edit-1')).toBeInTheDocument();
    expect(nameInput()).toHaveValue('Acme Inc');
  });

  it('Escape cancels and focus returns to "Edit organization"', async () => {
    const r = await open();
    await r.user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Edit organization' })).toHaveFocus();
    expect(patches).toHaveLength(0);
  });

  it('BR-62: on a suspended org Edit is enabled and the header keeps Suspended after save', async () => {
    const r = await open(asSuspended);
    await replaceText(r, nameInput(), 'Acme Inc');
    await r.user.click(save());
    expect(await ready('Acme Inc')).toBeInTheDocument();
    const header = screen.getByRole('heading', { level: 1, name: 'Acme Inc' }).parentElement;
    if (!header) throw new Error('no header');
    expect(within(header).getByText('Suspended')).toBeInTheDocument();
  });
});
