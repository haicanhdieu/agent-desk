import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ORG_SWITCHED_MESSAGE } from '@/features/auth/orgResync';
import { formatShortDate } from '@/features/invitations/dates';
import { mockDb } from '@/mocks/msw/db';
import { problemResponse, routeDef } from '@/mocks/msw/http';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

// The created invitation expires 2 days after "now": pin the clock so its date does not move.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-21T12:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

const createOrg = routeDef('platform.createOrg');
const createInvitation = routeDef('platform.createInvitation');
const orgPosts = () => mockDb.requests(createOrg.method, createOrg.path);
const orgByName = (name: string) => mockDb.state.orgs.find((o) => o.name === name);
// Counted on the wire, so a one-shot override handler (which the mock log does not see) counts too.
let sent: string[] = [];
let wire: string[] = [];
const onRequest = ({ request }: { request: Request }) => {
  const path = new URL(request.url).pathname;
  wire.push(`${request.method} ${path}`);
  if (request.method === 'POST') sent.push(path);
};
beforeEach(() => {
  sent = [];
  wire = [];
  server.events.on('request:start', onRequest);
});
afterEach(() => server.events.removeListener('request:start', onRequest));
const invitationPosts = (orgId: string) =>
  sent.filter((p) => p === createInvitation.path.replace(':orgId', orgId)).length;
const allInvitationPosts = () => mockDb.state.orgs.reduce((n, o) => n + invitationPosts(o.id), 0);
const orgCount = () => mockDb.state.orgs.length;

type Rendered = Awaited<ReturnType<typeof renderRoute>>;
type Scenario = Parameters<typeof scenarios.onboarding>[0];

const open = async (scenario: Scenario = 'platformAdminNoOrg'): Promise<Rendered> => {
  const rendered = await renderRoute('/orgs/new', { scenario: () => scenarios.onboarding(scenario) });
  await screen.findByRole('heading', { level: 1, name: 'Create an organization' });
  return rendered;
};

const typeInto = async (rendered: Rendered, label: string, text: string) => {
  const field = screen.getByRole('textbox', { name: new RegExp(`^${label}`) });
  await rendered.user.click(field);
  // Select the old text so the paste replaces it in one change.
  if (field instanceof HTMLInputElement) field.select();
  if (text === '') await rendered.user.keyboard('{Delete}');
  else await rendered.user.paste(text);
};
const fill = async (rendered: Rendered, v: { name?: string; slug?: string; email?: string }) => {
  if (v.name !== undefined) await typeInto(rendered, 'Name', v.name);
  if (v.slug !== undefined) await typeInto(rendered, 'URL', v.slug);
  if (v.email !== undefined) await typeInto(rendered, 'First owner email', v.email);
};
const submit = (rendered: Rendered) => rendered.user.click(screen.getByRole('button', { name: 'Create organization' }));

const FORMAT = 'Use lowercase letters, numbers and dashes, with no dash at the start or end.';
const emailOfLength = (length: number): string => {
  const tail = length - 64 - 1 - 63 - 1 - 63 - 1;
  return `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(tail)}`;
};

describe('BR-35 a platform admin creates an org', () => {
  it('fills the URL from the name, shows the created card with the link, and Done goes to /', async () => {
    const rendered = await open();
    await fill(rendered, { name: 'E2E Acme 1', email: 'Owner@Dev.Local' });
    expect(screen.getByRole('textbox', { name: /^URL/ })).toHaveValue('e2e-acme-1');
    await submit(rendered);

    expect(await screen.findByRole('heading', { name: 'Organization created' })).toBeInTheDocument();
    const org = orgByName('E2E Acme 1');
    expect(org?.slug).toBe('e2e-acme-1');
    const invitation = mockDb.state.invitations.find((i) => i.orgId === org?.id);
    expect(invitation?.role.key).toBe('owner');
    expect(invitation?.scope).toEqual({ type: 'org' });
    expect(
      screen.getByText(
        `Send this link to owner@dev.local. It works only for that email and expires on ${formatShortDate(invitation?.expiresAt ?? '')}.`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTitle(`${window.location.origin}/invitations/${invitation?.id}`)).toBeInTheDocument();
    expect(orgPosts()).toBe(1);

    const visited: string[] = [];
    rendered.router.subscribe('onBeforeNavigate', (e) => visited.push(e.toLocation.pathname));
    await rendered.user.click(screen.getByRole('button', { name: 'Done' }));
    // `/` sends a person with no org on to the welcome page.
    await waitFor(() => expect(rendered.router.state.location.pathname).toBe('/invitations'));
    expect(visited[0]).toBe('/');
  });

  it('keeps an edited URL', async () => {
    const rendered = await open();
    await fill(rendered, { name: 'Edited Org', slug: 'my-own-url', email: 'o@dev.local' });
    await fill(rendered, { name: 'Edited Org Two' });
    expect(screen.getByRole('textbox', { name: /^URL/ })).toHaveValue('my-own-url');
    await submit(rendered);
    await screen.findByRole('heading', { name: 'Organization created' });
    expect(orgByName('Edited Org Two')?.slug).toBe('my-own-url');
  });

  it('copies the link from the created card', async () => {
    const rendered = await open();
    await fill(rendered, { name: 'Copy Org', email: 'c@dev.local' });
    await submit(rendered);
    await screen.findByRole('heading', { name: 'Organization created' });
    const before = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      await rendered.user.click(screen.getByRole('button', { name: 'Copy link' }));
      const id = mockDb.state.invitations.find((i) => i.email === 'c@dev.local')?.id;
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/invitations/${id}`);
      expect(await screen.findByText('Link copied')).toBeInTheDocument();
    } finally {
      if (before) Object.defineProperty(navigator, 'clipboard', before);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('shows a Toast when the clipboard refuses', async () => {
    const rendered = await open();
    await fill(rendered, { name: 'Refuse Org', email: 'r@dev.local' });
    await submit(rendered);
    await screen.findByRole('heading', { name: 'Organization created' });
    const before = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn(() => Promise.reject(new Error('denied')));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      await rendered.user.click(screen.getByRole('button', { name: 'Copy link' }));
      expect(await screen.findByText('Could not copy. Select the link and copy it.')).toBeInTheDocument();
    } finally {
      if (before) Object.defineProperty(navigator, 'clipboard', before);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('invalidates the memberships list after the create', async () => {
    const rendered = await open();
    const spy = vi.spyOn(rendered.queryClient, 'invalidateQueries');
    await fill(rendered, { name: 'Fresh Org', email: 'f@dev.local' });
    await submit(rendered);
    await screen.findByRole('heading', { name: 'Organization created' });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['session', 'orgs'] }));
  });

  it('holds the form read-only while the create is in flight', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.post(
        createOrg.path,
        async () => {
          await gate;
          return undefined;
        },
        { once: true },
      ),
    );
    const rendered = await open();
    await fill(rendered, { name: 'Slow Org', email: 's@dev.local' });
    await submit(rendered);
    const busy = await screen.findByRole('button', { name: 'Creating…' });
    expect(busy).toBeDisabled();
    expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveAttribute('readonly');
    await rendered.user.click(busy);
    await act(async () => release());
    await screen.findByRole('heading', { name: 'Organization created' });
    expect(orgPosts()).toBe(1);
  });
});

describe('BR-36 field errors create nothing', () => {
  const none = (before: number) => {
    expect(orgPosts()).toBe(0);
    expect(orgCount()).toBe(before);
  };

  it('an empty name shows "Enter a name."', async () => {
    const rendered = await open();
    const before = orgCount();
    await fill(rendered, { slug: 'valid-url', email: 'o@dev.local' });
    await submit(rendered);
    expect(await screen.findByText('Enter a name.')).toBeInTheDocument();
    none(before);
  });

  it('a 100 character name is accepted', async () => {
    const rendered = await open();
    await fill(rendered, { name: 'n'.repeat(100), slug: 'valid-url', email: 'o@dev.local' });
    await submit(rendered);
    expect(await screen.findByRole('heading', { name: 'Organization created' })).toBeInTheDocument();
    expect(screen.queryByText('Use 100 characters or fewer.')).not.toBeInTheDocument();
  });

  it('a 101 character name shows a Name error', async () => {
    const rendered = await open();
    const before = orgCount();
    await fill(rendered, { name: 'n'.repeat(101), slug: 'valid-url', email: 'o@dev.local' });
    await submit(rendered);
    expect(await screen.findByText('Use 100 characters or fewer.')).toBeInTheDocument();
    none(before);
  });

  it.each([['Bad_Slug'], ['-abc'], ['abc-'], ['a'.repeat(64)]])('the URL %s shows the format error', async (slug) => {
    const rendered = await open();
    const before = orgCount();
    await fill(rendered, { name: 'Valid Name', slug, email: 'o@dev.local' });
    await submit(rendered);
    expect(await screen.findByText(FORMAT)).toBeInTheDocument();
    none(before);
  });

  it('a 63 character URL is accepted', async () => {
    const rendered = await open();
    await fill(rendered, { name: 'Valid Name', slug: 'a'.repeat(63), email: 'o@dev.local' });
    await submit(rendered);
    expect(await screen.findByRole('heading', { name: 'Organization created' })).toBeInTheDocument();
    expect(screen.queryByText(FORMAT)).not.toBeInTheDocument();
  });

  it('a taken URL shows "This URL is taken. Try another." and keeps the input', async () => {
    const rendered = await open();
    const before = orgCount();
    await fill(rendered, { name: 'Valid Name', slug: 'acme', email: 'o@dev.local' });
    await submit(rendered);
    expect(await screen.findByText('This URL is taken. Try another.')).toBeInTheDocument();
    expect(orgPosts()).toBe(1);
    expect(orgCount()).toBe(before);
    expect(screen.getByRole('textbox', { name: /^URL/ })).toHaveValue('acme');
    expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue('Valid Name');
    expect(screen.getByRole('button', { name: 'Create organization' })).toBeEnabled();
    expect(allInvitationPosts()).toBe(0);
    // Changing the URL drops the message and the next press creates the org.
    await fill(rendered, { slug: 'acme-two' });
    await waitFor(() => expect(screen.queryByText('This URL is taken. Try another.')).not.toBeInTheDocument());
    await submit(rendered);
    expect(await screen.findByRole('heading', { name: 'Organization created' })).toBeInTheDocument();
  });

  it('an email without a domain shows "Enter a valid email address."', async () => {
    const rendered = await open();
    const before = orgCount();
    await fill(rendered, { name: 'Valid Name', slug: 'valid-url', email: 'nope' });
    await submit(rendered);
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    none(before);
  });

  it('a 255 character email shows an Email error, a 254 character one is accepted', async () => {
    const rendered = await open();
    const before = orgCount();
    await fill(rendered, { name: 'Valid Name', slug: 'valid-url', email: emailOfLength(255) });
    await submit(rendered);
    expect(await screen.findByText('Use 254 characters or fewer.')).toBeInTheDocument();
    none(before);
    await fill(rendered, { email: emailOfLength(254) });
    await submit(rendered);
    expect(await screen.findByRole('heading', { name: 'Organization created' })).toBeInTheDocument();
  });

  it('shows the server detail on a field the form knows, input kept', async () => {
    server.use(
      http.post(createOrg.path, () =>
        problemResponse({
          status: 422,
          title: 'Validation failed',
          type: 'validation',
          errors: [{ pointer: '/name', detail: 'Name is reserved.' }],
        }),
      ),
    );
    const rendered = await open();
    await fill(rendered, { name: 'Reserved', email: 'o@dev.local' });
    await submit(rendered);
    expect(await screen.findByText('Name is reserved.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue('Reserved');
    expect(screen.queryByText('Validation failed')).not.toBeInTheDocument();
  });

  it('shows the problem title in a Banner for an answer that names no field', async () => {
    server.use(
      http.post(createOrg.path, () => problemResponse({ status: 422, title: 'Cannot create', type: 'validation' })),
    );
    const rendered = await open();
    await fill(rendered, { name: 'Odd', email: 'o@dev.local' });
    await submit(rendered);
    expect(await screen.findByText('Cannot create')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create organization' })).toBeEnabled();
  });

  it('a 5xx on the org create shows a Banner, keeps the input and re-enables the button', async () => {
    server.use(
      http.post(
        createOrg.path,
        () => problemResponse({ status: 500, title: 'Internal server error', type: 'internal' }),
        { once: true },
      ),
    );
    const rendered = await open();
    await fill(rendered, { name: 'Flaky', email: 'o@dev.local' });
    await submit(rendered);
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue('Flaky');
    expect(screen.getByRole('textbox', { name: /^First owner email/ })).toHaveValue('o@dev.local');
    expect(screen.getByRole('button', { name: 'Create organization' })).toBeEnabled();
    expect(allInvitationPosts()).toBe(0);
    await submit(rendered);
    expect(await screen.findByRole('heading', { name: 'Organization created' })).toBeInTheDocument();
  });

  it('a network failure on the org create shows the generic Banner and keeps the input', async () => {
    server.use(http.post(createOrg.path, () => HttpResponse.error(), { once: true }));
    const rendered = await open();
    await fill(rendered, { name: 'Offline', email: 'o@dev.local' });
    await submit(rendered);
    expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue('Offline');
    expect(screen.getByRole('button', { name: 'Create organization' })).toBeEnabled();
  });

  it('the org-mismatch answer shows the switched-tab Toast, sends one request, keeps the input; a second press creates', async () => {
    let refused = 0;
    server.use(
      http.post(
        createOrg.path,
        () => {
          refused += 1;
          return problemResponse({ status: 409, title: 'Conflict', type: 'org-mismatch' });
        },
        { once: true },
      ),
    );
    const rendered = await open();
    await fill(rendered, { name: 'Mismatch', email: 'o@dev.local' });
    await submit(rendered);
    expect(await screen.findByText(ORG_SWITCHED_MESSAGE)).toBeInTheDocument();
    expect(refused).toBe(1);
    expect(orgPosts()).toBe(0);
    expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue('Mismatch');
    expect(screen.getByRole('button', { name: 'Create organization' })).toBeEnabled();
    await submit(rendered);
    expect(await screen.findByRole('heading', { name: 'Organization created' })).toBeInTheDocument();
    expect(orgPosts()).toBe(1);
  });
});

describe('BR-39 retry after the owner invitation failed', () => {
  const failed = async () => {
    const rendered = await open('ownerInvitationFailsOnce');
    await fill(rendered, { name: 'Half Done', slug: 'half-done', email: 'owner@dev.local' });
    await submit(rendered);
    await screen.findByText('The organization was created. Retry to create the owner invitation.');
    return rendered;
  };

  it('shows the Banner with Retry, hides Create, locks Name and URL; Retry sends one invitation and no org', async () => {
    const rendered = await failed();
    expect(screen.getByText('Internal server error')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create organization' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: /^URL/ })).toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: /^First owner email/ })).not.toHaveAttribute('readonly');
    const org = orgByName('Half Done');
    expect(org).toBeDefined();
    expect(orgPosts()).toBe(1);
    expect(invitationPosts(org?.id ?? '')).toBe(1);

    await rendered.user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Organization created' })).toBeInTheDocument();
    expect(orgPosts()).toBe(1);
    expect(invitationPosts(org?.id ?? '')).toBe(2);
    expect(mockDb.state.orgs.filter((o) => o.slug === 'half-done')).toHaveLength(1);
    expect(mockDb.state.invitations.filter((i) => i.orgId === org?.id)).toHaveLength(1);
  });

  it('Retry sends the email as edited', async () => {
    const rendered = await failed();
    await fill(rendered, { email: 'other@dev.local' });
    await rendered.user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('heading', { name: 'Organization created' });
    expect(mockDb.state.invitations.some((i) => i.email === 'other@dev.local')).toBe(true);
  });

  it('keeps Retry, and sends nothing, while the edited email is invalid', async () => {
    const rendered = await failed();
    const org = orgByName('Half Done');
    await fill(rendered, { email: 'nope' });
    await rendered.user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(invitationPosts(org?.id ?? '')).toBe(1);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    await fill(rendered, { email: emailOfLength(255) });
    await rendered.user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Use 254 characters or fewer.')).toBeInTheDocument();
    expect(invitationPosts(org?.id ?? '')).toBe(1);
  });

  it('an invitation 4xx on the email shows the email field error and Retry works after the fix', async () => {
    server.use(
      http.post(
        createInvitation.path,
        () =>
          problemResponse({
            status: 409,
            title: 'Already a member',
            type: 'conflict',
            errors: [{ pointer: '/email', detail: 'This email is already a member.' }],
          }),
        { once: true },
      ),
    );
    const rendered = await open();
    await fill(rendered, { name: 'Member Clash', email: 'member@x.dev' });
    await submit(rendered);
    expect(await screen.findByText('This email is already a member.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: /^First owner email/ })).toHaveValue('member@x.dev');
    const org = orgByName('Member Clash');

    await fill(rendered, { email: 'fixed@dev.local' });
    await waitFor(() => expect(screen.queryByText('This email is already a member.')).not.toBeInTheDocument());
    await rendered.user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Organization created' })).toBeInTheDocument();
    expect(orgPosts()).toBe(1);
    expect(invitationPosts(org?.id ?? '')).toBe(2);
  });

  it('a failed Retry keeps the Banner, and Retry stays locked while it is in flight', async () => {
    const rendered = await failed();
    const org = orgByName('Half Done');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.post(
        createInvitation.path,
        async () => {
          await gate;
          return problemResponse({ status: 500, title: 'Still broken', type: 'internal' });
        },
        { once: true },
      ),
    );
    await rendered.user.click(screen.getByRole('button', { name: 'Retry' }));
    const busy = await screen.findByRole('button', { name: 'Retrying…' });
    expect(busy).toBeDisabled();
    expect(screen.getByRole('textbox', { name: /^First owner email/ })).toHaveAttribute('readonly');
    await act(async () => release());
    expect(await screen.findByText('Still broken')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(invitationPosts(org?.id ?? '')).toBe(2);
    expect(orgPosts()).toBe(1);
  });

  it('a network failure on Retry shows the generic title', async () => {
    const rendered = await failed();
    server.use(http.post(createInvitation.path, () => HttpResponse.error(), { once: true }));
    await rendered.user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await within(await screen.findByRole('alert')).findByText('Something went wrong. Try again.')).toBeVisible();
  });

  it('an org-mismatch answer on Retry shows the Toast and keeps Retry', async () => {
    const rendered = await failed();
    const org = orgByName('Half Done');
    server.use(
      http.post(
        createInvitation.path,
        () => problemResponse({ status: 409, title: 'Conflict', type: 'org-mismatch' }),
        {
          once: true,
        },
      ),
    );
    await rendered.user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(ORG_SWITCHED_MESSAGE)).toBeInTheDocument();
    expect(invitationPosts(org?.id ?? '')).toBe(2);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    await rendered.user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Organization created' })).toBeInTheDocument();
    expect(invitationPosts(org?.id ?? '')).toBe(3);
  });

  it('an org-mismatch answer on the first invitation keeps the created org on the Retry state; Retry sends one more invitation and no org', async () => {
    server.use(
      http.post(
        createInvitation.path,
        () => problemResponse({ status: 409, title: 'Conflict', type: 'org-mismatch' }),
        { once: true },
      ),
    );
    const rendered = await open();
    await fill(rendered, { name: 'First Mismatch', slug: 'first-mismatch', email: 'o@dev.local' });
    await submit(rendered);
    expect(await screen.findByText(ORG_SWITCHED_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText('The organization was created. Retry to create the owner invitation.')).toBeInTheDocument();
    const org = orgByName('First Mismatch');
    expect(org).toBeDefined();
    expect(orgPosts()).toBe(1);
    expect(invitationPosts(org?.id ?? '')).toBe(1);
    expect(screen.queryByRole('button', { name: 'Create organization' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: /^URL/ })).toHaveAttribute('readonly');

    await rendered.user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Organization created' })).toBeInTheDocument();
    expect(orgPosts()).toBe(1);
    expect(invitationPosts(org?.id ?? '')).toBe(2);
  });

  it('shows the Retry state when the owner role cannot be loaded, and Retry loads it again', async () => {
    server.use(
      http.get(
        routeDef('platform.listRoles').path,
        () => problemResponse({ status: 503, title: 'Unavailable', type: 'internal' }),
        {
          once: true,
        },
      ),
    );
    const rendered = await open();
    await fill(rendered, { name: 'No Roles', email: 'o@dev.local' });
    await submit(rendered);
    expect(await screen.findByText('Unavailable')).toBeInTheDocument();
    await rendered.user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Organization created' })).toBeInTheDocument();
    expect(orgPosts()).toBe(1);
  });

  it('shows the Retry state when the role list has no owner role', async () => {
    server.use(http.get(routeDef('platform.listRoles').path, () => HttpResponse.json([]), { once: true }));
    const rendered = await open();
    await fill(rendered, { name: 'No Owner', email: 'o@dev.local' });
    await submit(rendered);
    expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });
});

describe('BR-46 a non-admin has no create-org form', () => {
  it('shows Forbidden and sends no create request', async () => {
    await renderRoute('/orgs/new', { scenario: () => scenarios.onboarding('noOrgUninvited') });
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Create an organization' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(orgPosts()).toBe(0);
    // Nothing reached the wire that creates an org, loads its roles or invites an owner.
    expect(wire.filter((r) => r.startsWith('POST /api/platform/orgs'))).toEqual([]);
    expect(wire.filter((r) => /^\S+ \/api\/platform\/orgs\/[^/]+\/roles/.test(r))).toEqual([]);
    expect(allInvitationPosts()).toBe(0);
  });

  it('shows a retryable error when the access check fails', async () => {
    server.use(
      http.get(routeDef('me.access').path, () => problemResponse({ status: 500, title: 'Boom', type: 'internal' })),
    );
    await renderRoute('/orgs/new', { scenario: () => scenarios.onboarding('platformAdminNoOrg') });
    expect(await screen.findByText('Boom')).toBeInTheDocument();
    expect(orgPosts()).toBe(0);
  });
});

describe('create organization under the app bar', () => {
  it('BR-43 shows the org crumb and no tabs', async () => {
    await open('platformAdminOneOrg');
    expect(screen.getByRole('button', { name: /^Switch organization, currently/ })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('BR-43 a platform admin with no org sees "Switch organization" and no tabs', async () => {
    await open('platformAdminNoOrg');
    expect(screen.getByRole('button', { name: /^Switch organization/ })).toHaveTextContent('No organization');
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });
});
