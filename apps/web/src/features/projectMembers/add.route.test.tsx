import { act, screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { applyProjectSpace, type ProjectSpaceRole, type ProjectSpaceScenario } from '@/mocks/msw/projectSpaceScenarios';
import { renderRoute } from '@/test/renderRoute';

const P = ids.project.invoicerApi;
const page = `/o/alice/p/${P}/desk/members`;

const as = (role: ProjectSpaceRole, scenario?: ProjectSpaceScenario) => () =>
  applyProjectSpace(mockDb, scenario === undefined ? { role } : { role, scenario });

// jsdom has no layout: give the picker's scroll container a viewport so the virtualizer renders rows.
const stubbed = ['clientHeight', 'clientWidth'] as const;
const originals = new Map<string, PropertyDescriptor | undefined>();
beforeEach(() => {
  for (const key of stubbed) {
    originals.set(key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key));
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      value: key === 'clientHeight' ? 288 : 300,
    });
  }
});
afterEach(() => {
  for (const key of stubbed) {
    const was = originals.get(key);
    if (was) Object.defineProperty(HTMLElement.prototype, key, was);
    else Reflect.deleteProperty(HTMLElement.prototype, key);
  }
});

/** Every request the page sends to the picker (`members.list`) and to the add endpoint. */
function watch() {
  const picker: URL[] = [];
  const adds: string[] = [];
  const lists: string[] = [];
  const listener = ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    if (request.method === 'GET' && /^\/api\/orgs\/[^/]+\/members$/.test(url.pathname)) picker.push(url);
    if (request.method === 'POST' && /^\/api\/projects\/[^/]+\/members$/.test(url.pathname)) adds.push(request.url);
    if (request.method === 'GET' && /^\/api\/projects\/[^/]+\/members$/.test(url.pathname)) lists.push(request.url);
  };
  server.events.on('request:start', listener);
  return { picker, adds, lists, stop: () => server.events.removeListener('request:start', listener) };
}

const ready = () => screen.findByRole('heading', { level: 1, name: 'Members' });
const combobox = () => screen.getByRole('combobox');
const dialog = () => screen.getByRole('dialog');

async function openAdd(scenario: Parameters<typeof as>[1] = undefined, role: ProjectSpaceRole = 'projectAdmin') {
  const view = await renderRoute(page, { scenario: as(role, scenario) });
  await ready();
  await view.user.click(screen.getAllByRole('button', { name: 'Add member' })[0] as HTMLElement);
  await screen.findByRole('dialog', { name: /Add member to/ });
  return view;
}
const pickPerson = async (user: Awaited<ReturnType<typeof openAdd>>['user'], name: string) => {
  await user.click(combobox());
  await user.click(await screen.findByRole('option', { name: new RegExp(name) }));
};
const submit = (user: Awaited<ReturnType<typeof openAdd>>['user']) =>
  user.click(within(dialog()).getByRole('button', { name: 'Add member' }));

describe('Add member: the picker (BR-7)', () => {
  it('sends one request on open, without q, excluding the project', async () => {
    const w = watch();
    try {
      await openAdd();
      await screen.findByRole('option', { name: /Person 04/ });
      expect(w.picker).toHaveLength(1);
      const q = w.picker[0]?.searchParams;
      expect(q?.has('q')).toBe(false);
      expect(q?.get('excludeProject')).toBe(P);
      expect(q?.get('pageSize')).toBe('20');
    } finally {
      w.stop();
    }
  });

  it('waits for the typing to pause before it searches', async () => {
    const w = watch();
    try {
      const { user } = await openAdd();
      await screen.findByRole('option', { name: /Person 04/ });
      await user.type(combobox(), 'person4');
      await waitFor(() => expect(w.picker.some((u) => u.searchParams.get('q') === 'person4')).toBe(true));
      // The keystrokes in between never became requests.
      expect(w.picker.map((u) => u.searchParams.get('q'))).toEqual([null, 'person4']);
    } finally {
      w.stop();
    }
  });

  it('never shows a slower earlier search under a newer one (Review Focus 2)', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: string[] = [];
    let delivered: () => void = () => undefined;
    const slowDelivered = new Promise<void>((resolve) => {
      delivered = resolve;
    });
    const onResponse = ({ request }: { request: Request }) => {
      if (new URL(request.url).searchParams.get('q') === 'person1') delivered();
    };
    server.events.on('response:mocked', onResponse);
    const { user } = await renderRoute(page, {
      scenario: () => {
        applyProjectSpace(mockDb, { role: 'projectAdmin', scenario: 'pickerMany' });
        server.use(
          http.get('*/api/orgs/:orgId/members', async ({ request }) => {
            const q = new URL(request.url).searchParams.get('q');
            if (q !== null) seen.push(q);
            if (q === 'person1') await held;
            return undefined;
          }),
        );
      },
    });
    await ready();
    await user.click(screen.getAllByRole('button', { name: 'Add member' })[0] as HTMLElement);
    await user.type(combobox(), 'person1');
    await waitFor(() => expect(seen).toContain('person1'));
    await user.type(combobox(), '2');
    await waitFor(() => expect(seen).toContain('person12'));
    await screen.findByRole('option', { name: /Person 12/ });
    await act(async () => {
      release();
      await slowDelivered;
    });
    server.events.removeListener('response:mocked', onResponse);
    // The slow "person1" answer has landed; the options still belong to "person12".
    await screen.findByRole('option', { name: /Person 12/ });
    expect(screen.getByRole('option', { name: /Person 12/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Person 10/ })).not.toBeInTheDocument();
  });
});

describe('Add member: submit (BR-5, BR-6)', () => {
  it('offers Admin, Member and Viewer with nothing preselected', async () => {
    await openAdd();
    const cards = within(dialog()).getAllByRole('radio');
    expect(cards.map((c) => (c as HTMLInputElement).checked)).toEqual([false, false, false]);
    expect(within(dialog()).queryByText('Owner')).not.toBeInTheDocument();
  });

  it('an empty submit shows both field errors and sends nothing', async () => {
    const w = watch();
    try {
      const { user } = await openAdd();
      await submit(user);
      expect(await screen.findByText('Choose a person.')).toBeInTheDocument();
      expect(screen.getByText('Choose a role.')).toBeInTheDocument();
      expect(w.adds).toEqual([]);
    } finally {
      w.stop();
    }
  });

  it('adds the person: toast, list refetched, focus back on Add member', async () => {
    const w = watch();
    try {
      const { user } = await openAdd();
      await pickPerson(user, 'Person 04');
      await user.click(within(dialog()).getByRole('radio', { name: /^Member/ }));
      const before = w.lists.length;
      await submit(user);
      expect(await screen.findByText('Person 04 added as Member')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(await screen.findByText('Person 04')).toBeInTheDocument();
      expect(w.lists.length).toBeGreaterThan(before);
      expect(document.activeElement).toBe(screen.getAllByRole('button', { name: 'Add member' })[0]);
    } finally {
      w.stop();
    }
  });

  it('typing after a pick drops the pick: Choose a person, nothing is sent', async () => {
    const w = watch();
    try {
      const { user } = await openAdd();
      await pickPerson(user, 'Person 04');
      await user.type(combobox(), 'bo');
      await user.click(within(dialog()).getByRole('radio', { name: /^Member/ }));
      await submit(user);
      expect(await screen.findByText('Choose a person.')).toBeInTheDocument();
      expect(w.adds).toEqual([]);
    } finally {
      w.stop();
    }
  });

  it('a failed roles load shows a banner and sends nothing', async () => {
    const w = watch();
    try {
      const { user } = await renderRoute(page, {
        scenario: () => {
          applyProjectSpace(mockDb, { role: 'projectAdmin' });
          server.use(http.get('*/api/orgs/:orgId/roles', () => new Response(null, { status: 500 })));
        },
      });
      await ready();
      await user.click(screen.getAllByRole('button', { name: 'Add member' })[0] as HTMLElement);
      expect(await within(dialog()).findByText('Could not load the roles.')).toBeInTheDocument();
      await pickPerson(user, 'Person 04');
      await submit(user);
      expect(w.adds).toEqual([]);
    } finally {
      w.stop();
    }
  });

  it('refetches the members, picker and audit lists after an add', async () => {
    const view = await openAdd();
    const spy = vi.spyOn(view.queryClient, 'invalidateQueries');
    await pickPerson(view.user, 'Person 04');
    await view.user.click(within(dialog()).getByRole('radio', { name: /^Member/ }));
    await submit(view.user);
    await screen.findByText('Person 04 added as Member');
    const keys = spy.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
    expect(keys).toContain(JSON.stringify(['org', 'alice', 'projects', P, 'members', 'list']));
    expect(keys).toContain(JSON.stringify(['org', 'alice', 'members']));
    expect(keys).toContain(JSON.stringify(['org', 'alice', 'projects', P, 'audit', 'list']));
  });

  it('two quick clicks send one request', async () => {
    const w = watch();
    try {
      const { user } = await openAdd();
      await pickPerson(user, 'Person 04');
      await user.click(within(dialog()).getByRole('radio', { name: /^Viewer/ }));
      const button = within(dialog()).getByRole('button', { name: 'Add member' });
      await user.dblClick(button);
      await screen.findByText('Person 04 added as Viewer');
      expect(w.adds).toHaveLength(1);
    } finally {
      w.stop();
    }
  });

  it('a person who got a role meanwhile: 409 banner, person cleared, role kept, lists refetched (BR-12)', async () => {
    const w = watch();
    try {
      const { user } = await openAdd('roleAddedMeanwhile');
      await pickPerson(user, 'Reliable Rae');
      await user.click(within(dialog()).getByRole('radio', { name: /^Viewer/ }));
      const pickerReads = w.picker.length;
      await submit(user);
      expect(await screen.findByText('This person already has a role on this project.')).toBeInTheDocument();
      expect(screen.getByText('Use Change role to change it.')).toBeInTheDocument();
      expect(combobox()).toHaveValue('');
      expect(within(dialog()).getByRole('radio', { name: /^Viewer/ })).toBeChecked();
      await waitFor(() => expect(w.picker.length).toBeGreaterThan(pickerReads));
    } finally {
      w.stop();
    }
  });

  it('a person who left the org meanwhile: field error and the picker refetches (BR-12)', async () => {
    const w = watch();
    try {
      const { user } = await openAdd('goneFromOrg');
      await pickPerson(user, 'Reliable Rae');
      await user.click(within(dialog()).getByRole('radio', { name: /^Member/ }));
      const pickerReads = w.picker.length;
      await submit(user);
      expect(await screen.findByText('This person is no longer in the organization.')).toBeInTheDocument();
      await waitFor(() => expect(w.picker.length).toBeGreaterThan(pickerReads));
    } finally {
      w.stop();
    }
  });

  it('a demoted caller gets a banner with the request id and keeps the input (BR-25)', async () => {
    const { user } = await openAdd('demotedMeanwhile');
    await pickPerson(user, 'Person 04');
    await user.click(within(dialog()).getByRole('radio', { name: /^Member/ }));
    await submit(user);
    expect(await screen.findByText(/^Request ID: /)).toBeInTheDocument();
    expect(dialog()).toBeInTheDocument();
    expect(within(dialog()).getByRole('radio', { name: /^Member/ })).toBeChecked();
  });

  it('cannot be closed while the request is in flight', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { user } = await renderRoute(page, {
      scenario: () => {
        applyProjectSpace(mockDb, { role: 'projectAdmin' });
        server.use(
          http.post('*/api/projects/:projectId/members', async () => {
            await held;
            return undefined;
          }),
        );
      },
    });
    await ready();
    await user.click(screen.getAllByRole('button', { name: 'Add member' })[0] as HTMLElement);
    await pickPerson(user, 'Person 04');
    await user.click(within(dialog()).getByRole('radio', { name: /^Member/ }));
    await submit(user);
    expect(await within(dialog()).findByRole('button', { name: 'Adding…' })).toBeDisabled();
    expect(within(dialog()).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(dialog()).toBeInTheDocument();
    await act(async () => release());
    await screen.findByText('Person 04 added as Member');
  });
});
