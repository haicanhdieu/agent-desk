import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ORG_SWITCHED_MESSAGE } from '@/features/auth/orgResync';
import { formatShortDate } from '@/features/invitations/dates';
import { ids } from '@/mocks/dto/ids';
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

const clipboardBefore = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  if (clipboardBefore) Object.defineProperty(navigator, 'clipboard', clipboardBefore);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

const create = routeDef('invitations.create');
const posts = () => mockDb.requests(create.method, create.path.replace(':orgId', ids.org.acme));
const pending = (email: string) => mockDb.state.invitations.find((i) => i.email === email && i.orgId === ids.org.acme);

type Rendered = Awaited<ReturnType<typeof renderRoute>>;

const open = async (scenario: Parameters<typeof scenarios.onboarding>[0]): Promise<Rendered> => {
  const rendered = await renderRoute('/o/acme/invitations', { scenario: () => scenarios.onboarding(scenario) });
  await screen.findByRole('heading', { level: 1, name: 'Invitations' });
  return rendered;
};

const openDialog = async (rendered: Rendered) => {
  await rendered.user.click(screen.getAllByRole('button', { name: 'Invite people' })[0] as HTMLElement);
  const dialog = await screen.findByRole('dialog', { name: 'Invite people' });
  // The role choices load with the dialog.
  await within(dialog).findByRole('option', { name: 'Member' });
  return dialog;
};

const submit = (rendered: Rendered) => rendered.user.click(screen.getByRole('button', { name: 'Create invitation' }));
const typeEmail = async (rendered: Rendered, email: string) => {
  await rendered.user.click(screen.getByRole('textbox', { name: 'Email' }));
  await rendered.user.paste(email);
};
const chooseRole = (rendered: Rendered, name: string) =>
  rendered.user.selectOptions(screen.getByRole('combobox', { name: 'Role' }), name);
const optionNames = () =>
  within(screen.getByRole('combobox', { name: 'Role' }))
    .getAllByRole('option')
    .map((o) => o.textContent)
    .filter((t) => t !== 'Choose a role');

/** An address of exactly `length` characters whose parts are within the 64 and 63 character limits. */
const emailOfLength = (length: number): string => {
  const tail = length - 64 - 1 - 63 - 1 - 63 - 1;
  return `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(tail)}`;
};

describe('BR-27 an owner invites people', () => {
  it('creates a whole-org invitation, shows the link, and the list shows it pending', async () => {
    const rendered = await open('owner');
    await openDialog(rendered);
    await typeEmail(rendered, 'New.Person@dev.local');
    await chooseRole(rendered, 'Member');
    await rendered.user.click(screen.getByRole('radio', { name: 'Whole organization' }));
    await submit(rendered);

    const dialog = await screen.findByRole('dialog', { name: 'Invitation created' });
    const row = pending('new.person@dev.local');
    expect(row).toBeDefined();
    expect(row?.status).toBe('pending');
    expect(dialog).toHaveTextContent(
      `Send this link to new.person@dev.local. It works only for that email and expires on ${formatShortDate(row?.expiresAt ?? '')}.`,
    );
    expect(within(dialog).getByTitle(`${window.location.origin}/invitations/${row?.id}`)).toBeInTheDocument();

    await rendered.user.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const listed = (await screen.findAllByText('new.person@dev.local', { selector: 'span' }))
      .map((el) => el.closest('tr'))
      .find((tr) => tr !== null);
    expect(listed).toHaveTextContent('Pending');
    expect(listed).toHaveTextContent('Whole organization');
    // BR-27: it expires 2 days after the (pinned) clock.
    expect(listed).toHaveTextContent('Expires in 2 days');
  });

  it('creates a some-projects invitation that names both projects', async () => {
    const rendered = await open('owner');
    await openDialog(rendered);
    await typeEmail(rendered, 'two@dev.local');
    await chooseRole(rendered, 'Member');
    await rendered.user.click(screen.getByRole('radio', { name: 'Some projects' }));
    await rendered.user.click(screen.getByRole('checkbox', { name: 'invoicer-api' }));
    await rendered.user.click(screen.getByRole('checkbox', { name: 'invoicer-web' }));
    await submit(rendered);

    await screen.findByRole('dialog', { name: 'Invitation created' });
    expect(pending('two@dev.local')?.scope).toEqual({
      type: 'project',
      projects: [
        { id: ids.project.invoicerApi, name: 'invoicer-api' },
        { id: ids.project.invoicerWeb, name: 'invoicer-web' },
      ],
    });
    await rendered.user.click(screen.getByRole('button', { name: 'Done' }));
    const listed = (await screen.findAllByText('two@dev.local', { selector: 'span' }))
      .map((el) => el.closest('tr'))
      .find((tr) => tr !== null);
    expect(listed).toHaveTextContent('invoicer-api');
    expect(listed).toHaveTextContent('invoicer-web');
    expect(listed).toHaveTextContent('Expires in 2 days');
  });

  it('copies the link from the created step', async () => {
    const rendered = await open('owner');
    await openDialog(rendered);
    await typeEmail(rendered, 'copy@dev.local');
    await chooseRole(rendered, 'Viewer');
    await submit(rendered);
    await screen.findByRole('dialog', { name: 'Invitation created' });
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    await rendered.user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/invitations/${pending('copy@dev.local')?.id}`);
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
  });
});

describe('BR-28 field errors create nothing', () => {
  const countBefore = () => mockDb.state.invitations.length;

  it('an invalid email shows an Email error, with no request', async () => {
    const rendered = await open('owner');
    const before = countBefore();
    await openDialog(rendered);
    await typeEmail(rendered, 'not-an-email');
    await chooseRole(rendered, 'Member');
    await submit(rendered);

    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeInvalid();
    expect(posts()).toBe(0);
    expect(countBefore()).toBe(before);
  });

  it('a 255 character email shows an Email error, with no request', async () => {
    const rendered = await open('owner');
    const before = countBefore();
    await openDialog(rendered);
    await typeEmail(rendered, emailOfLength(255));
    await chooseRole(rendered, 'Member');
    await submit(rendered);

    expect(await screen.findByText('Use 254 characters or fewer.')).toBeInTheDocument();
    expect(posts()).toBe(0);
    expect(countBefore()).toBe(before);
  });

  it('a 254 character email is accepted', async () => {
    const rendered = await open('owner');
    await openDialog(rendered);
    await typeEmail(rendered, emailOfLength(254));
    await chooseRole(rendered, 'Member');
    await submit(rendered);

    expect(await screen.findByRole('dialog', { name: 'Invitation created' })).toBeInTheDocument();
    expect(posts()).toBe(1);
  });

  it('some projects with none ticked shows a project error, with no request', async () => {
    const rendered = await open('owner');
    const before = countBefore();
    await openDialog(rendered);
    await typeEmail(rendered, 'none@dev.local');
    await chooseRole(rendered, 'Member');
    await rendered.user.click(screen.getByRole('radio', { name: 'Some projects' }));
    await submit(rendered);

    expect(await screen.findByText('Choose at least one project.')).toBeInTheDocument();
    expect(posts()).toBe(0);
    expect(countBefore()).toBe(before);
  });

  it('shows no role error text until submit, then clears an error when the field changes', async () => {
    const rendered = await open('owner');
    await openDialog(rendered);
    expect(screen.queryByText('Choose a role.')).not.toBeInTheDocument();
    await typeEmail(rendered, 'role@dev.local');
    await submit(rendered);
    expect(await screen.findByText('Choose a role.')).toBeInTheDocument();
    await chooseRole(rendered, 'Member');
    await waitFor(() => expect(screen.queryByText('Choose a role.')).not.toBeInTheDocument());
  });

  it('an email that is already a member shows the server detail on Email, input kept', async () => {
    const rendered = await open('owner');
    const before = countBefore();
    await openDialog(rendered);
    await typeEmail(rendered, 'member@x.dev');
    await chooseRole(rendered, 'Member');
    await rendered.user.click(screen.getByRole('radio', { name: 'Whole organization' }));
    await submit(rendered);

    expect(await screen.findByText('This email is already a member.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('member@x.dev');
    expect(screen.getByRole('button', { name: 'Create invitation' })).toBeEnabled();
    expect(countBefore()).toBe(before);
  });

  it('an email already invited (other case) shows the pending-invitation error on Email', async () => {
    const rendered = await open('owner');
    const before = countBefore();
    await openDialog(rendered);
    await typeEmail(rendered, 'P@X.dev');
    await chooseRole(rendered, 'Member');
    await rendered.user.click(screen.getByRole('radio', { name: 'Whole organization' }));
    await submit(rendered);

    expect(await screen.findByText('This email already has a pending invitation.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('P@X.dev');
    expect(countBefore()).toBe(before);
  });
});

describe('server answers other than a created invitation', () => {
  const answer = (respond: () => Response) => server.use(http.post(create.path, respond));
  const fillValid = async (rendered: Rendered) => {
    await openDialog(rendered);
    await typeEmail(rendered, 'keep@dev.local');
    await chooseRole(rendered, 'Viewer');
    await rendered.user.click(screen.getByRole('radio', { name: 'Whole organization' }));
  };
  const kept = () => {
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('keep@dev.local');
    expect(screen.getByRole('combobox', { name: 'Role' })).toHaveDisplayValue('Viewer');
    expect(screen.getByRole('button', { name: 'Create invitation' })).toBeEnabled();
  };

  it('the org-mismatch answer shows the switched-tab Toast, keeps the input, sends one request and a second press creates it', async () => {
    const rendered = await open('owner');
    let refused = 0;
    server.use(
      http.post(
        create.path,
        () => {
          refused += 1;
          return problemResponse({ status: 409, title: 'Conflict', type: 'org-mismatch' });
        },
        { once: true },
      ),
    );
    await fillValid(rendered);
    await submit(rendered);

    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent(ORG_SWITCHED_MESSAGE);
    expect(within(screen.getByRole('dialog')).queryByText(ORG_SWITCHED_MESSAGE)).not.toBeInTheDocument();
    kept();
    // No automatic retry: the one refused request is the only one sent, and nothing was created.
    expect(refused).toBe(1);
    expect(posts()).toBe(0);
    expect(pending('keep@dev.local')).toBeUndefined();

    await submit(rendered);
    expect(await screen.findByRole('dialog', { name: 'Invitation created' })).toBeInTheDocument();
    expect(refused).toBe(1);
    expect(posts()).toBe(1);
    expect(pending('keep@dev.local')).toBeDefined();
  });

  it('a 403 shows the detail in the form Banner and keeps the input', async () => {
    const rendered = await open('owner');
    answer(() => problemResponse({ status: 403, title: 'Forbidden', type: 'forbidden', detail: 'You cannot invite.' }));
    await fillValid(rendered);
    await submit(rendered);

    expect(await within(screen.getByRole('dialog')).findByText('You cannot invite.')).toBeInTheDocument();
    kept();
  });

  it('a network failure shows the generic message in the form Banner and keeps the input', async () => {
    const rendered = await open('owner');
    answer(() => HttpResponse.error());
    await fillValid(rendered);
    await submit(rendered);

    expect(await within(screen.getByRole('dialog')).findByText('Something went wrong. Try again.')).toBeInTheDocument();
    kept();
  });

  it('a 422 maps its JSON pointers to the Role and project fields', async () => {
    const rendered = await open('owner');
    answer(() =>
      problemResponse({
        status: 422,
        title: 'Validation failed',
        type: 'validation',
        errors: [{ pointer: '/roleId', detail: 'This role cannot be given here.' }],
      }),
    );
    await fillValid(rendered);
    await submit(rendered);

    expect(await screen.findByText('This role cannot be given here.')).toBeInTheDocument();
    kept();
  });

  it('a 400 on a project index maps to the project field', async () => {
    const rendered = await open('owner');
    answer(() =>
      problemResponse({
        status: 400,
        title: 'Bad request',
        type: 'validation',
        errors: [{ pointer: '/scope/projectIds/0', detail: 'Pick a project of this organization.' }],
      }),
    );
    await fillValid(rendered);
    await rendered.user.click(screen.getByRole('radio', { name: 'Some projects' }));
    await rendered.user.click(screen.getByRole('checkbox', { name: 'invoicer-api' }));
    await submit(rendered);

    const message = await screen.findByText('Pick a project of this organization.');
    // On the projects field (the Access group is described by it), not in the form Banner.
    expect(screen.getByRole('group', { name: 'Access' })).toHaveAccessibleDescription(
      'Pick a project of this organization.',
    );
    expect(message.closest('[role="alert"], [role="status"]')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'invoicer-api' })).toBeChecked();
    kept();
  });

  it('a request in flight disables the buttons and ignores Escape', async () => {
    const rendered = await open('owner');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(create.path, async () => {
        await gate;
        return problemResponse({ status: 403, title: 'Forbidden', type: 'forbidden' });
      }),
    );
    await fillValid(rendered);
    await submit(rendered);

    expect(await screen.findByRole('button', { name: 'Creating…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await rendered.user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Invite people' })).toBeInTheDocument();

    await act(async () => release());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create invitation' })).toBeEnabled());
  });
});

describe('BR-29 options per inviter', () => {
  it('an owner is offered owner, admin, member and viewer, and both scopes', async () => {
    const rendered = await open('owner');
    await openDialog(rendered);
    expect(optionNames()).toEqual(['Owner', 'Admin', 'Member', 'Viewer']);
    expect(screen.getByRole('radio', { name: 'Whole organization' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Some projects' })).toBeInTheDocument();
  });

  it('an org admin is not offered owner', async () => {
    const rendered = await open('orgAdmin');
    await openDialog(rendered);
    expect(optionNames()).toEqual(['Admin', 'Member', 'Viewer']);
    expect(screen.getByRole('radio', { name: 'Whole organization' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Some projects' })).toBeInTheDocument();
  });

  it('a project admin of P1 has no Whole organization and is offered only P1', async () => {
    const rendered = await open('projectAdmin');
    await openDialog(rendered);
    expect(optionNames()).toEqual(['Admin', 'Member', 'Viewer']);
    expect(screen.queryByRole('radio', { name: 'Whole organization' })).not.toBeInTheDocument();
    expect(screen.getByText('Some projects')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual(['invoicer-api']);
  });
});

describe('closing the dialog', () => {
  it('Cancel closes without a request', async () => {
    const rendered = await open('owner');
    const before = mockDb.state.invitations.length;
    await openDialog(rendered);
    await typeEmail(rendered, 'cancel@dev.local');
    await rendered.user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(posts()).toBe(0);
    expect(mockDb.state.invitations).toHaveLength(before);
  });

  it('reopening starts from an empty form', async () => {
    const rendered = await open('owner');
    await openDialog(rendered);
    await typeEmail(rendered, 'gone@dev.local');
    await rendered.user.click(screen.getByRole('button', { name: 'Cancel' }));
    await openDialog(rendered);
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('');
  });
});

describe('loading the role and project choices', () => {
  const LOAD_FAILED = 'Could not load the roles and projects. Close the dialog and try again.';
  const listProjects = routeDef('projects.list');
  const projectRequests = () => mockDb.requests(listProjects.method, listProjects.path);

  /** Replaces acme's projects with `count` generated ones. */
  const setAcmeProjects = (count: number) => {
    const template = mockDb.state.projects.find((p) => p.orgId === ids.org.acme);
    if (!template) throw new Error('no acme project to copy');
    const others = mockDb.state.projects.filter((p) => p.orgId !== ids.org.acme);
    const base = Date.parse('2026-01-01T00:00:00.000Z');
    const generated = Array.from({ length: count }, (_, i) => ({
      ...template,
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      name: `gen-${String(i).padStart(3, '0')}`,
      repoPath: `acme/gen-${i}`,
      createdAt: new Date(base + i * 1000).toISOString(),
    }));
    mockDb.state.projects = [...others, ...generated];
  };
  const chooseSomeProjects = (rendered: Rendered) =>
    rendered.user.click(screen.getByRole('radio', { name: 'Some projects' }));
  const openInvite = (rendered: Rendered) =>
    rendered.user.click(screen.getAllByRole('button', { name: 'Invite people' })[0] as HTMLElement);

  it('shows a form Banner when the roles do not load, and Create sends nothing', async () => {
    const rendered = await open('owner');
    server.use(
      http.get(routeDef('roles.list').path, () => problemResponse({ status: 500, title: 'Boom', type: 'internal' })),
    );
    await openInvite(rendered);
    const dialog = await screen.findByRole('dialog', { name: 'Invite people' });
    expect(await within(dialog).findByText(LOAD_FAILED)).toBeInTheDocument();
    await typeEmail(rendered, 'x@dev.local');
    await submit(rendered);
    expect(posts()).toBe(0);
  });

  it('shows a form Banner when the projects do not load, and Create sends nothing', async () => {
    const rendered = await open('owner');
    server.use(http.get(listProjects.path, () => problemResponse({ status: 500, title: 'Boom', type: 'internal' })));
    await openInvite(rendered);
    const dialog = await screen.findByRole('dialog', { name: 'Invite people' });
    expect(await within(dialog).findByText(LOAD_FAILED)).toBeInTheDocument();
    await typeEmail(rendered, 'x@dev.local');
    await submit(rendered);
    expect(posts()).toBe(0);
  });

  it('reopening the dialog after a failed load retries, and then Create works', async () => {
    const rendered = await open('owner');
    // A 5xx is retried twice, so the failure stays until the dialog has given up on it.
    server.use(http.get(listProjects.path, () => problemResponse({ status: 500, title: 'Boom', type: 'internal' })));
    await openInvite(rendered);
    const failed = await screen.findByRole('dialog', { name: 'Invite people' });
    expect(await within(failed).findByText(LOAD_FAILED)).toBeInTheDocument();
    await rendered.user.click(within(failed).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    server.resetHandlers();

    const dialog = await openDialog(rendered);
    expect(within(dialog).queryByText(LOAD_FAILED)).not.toBeInTheDocument();
    await typeEmail(rendered, 'retry@dev.local');
    await chooseRole(rendered, 'Member');
    await rendered.user.click(screen.getByRole('radio', { name: 'Whole organization' }));
    await submit(rendered);
    expect(await screen.findByRole('dialog', { name: 'Invitation created' })).toBeInTheDocument();
    expect(pending('retry@dev.local')).toBeDefined();
  });

  it('offers every project of an org with more than 100, across two pages', async () => {
    const rendered = await open('owner');
    setAcmeProjects(150);
    const before = projectRequests();
    await openDialog(rendered);
    await chooseSomeProjects(rendered);
    expect(screen.getAllByRole('checkbox')).toHaveLength(150);
    expect(screen.getByRole('checkbox', { name: 'gen-149' })).toBeInTheDocument();
    expect(projectRequests() - before).toBe(2);
  });

  it('stops after one request for exactly 100 projects', async () => {
    const rendered = await open('owner');
    setAcmeProjects(100);
    const before = projectRequests();
    await openDialog(rendered);
    await chooseSomeProjects(rendered);
    expect(screen.getAllByRole('checkbox')).toHaveLength(100);
    expect(projectRequests() - before).toBe(1);
  });

  it('stops after one request for no projects', async () => {
    const rendered = await open('owner');
    setAcmeProjects(0);
    const before = projectRequests();
    await openDialog(rendered);
    await chooseSomeProjects(rendered);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(projectRequests() - before).toBe(1);
  });
});
