import type { CreateRuleRequest, RuleDto } from '@agentdesk/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { checklistKey } from '@/features/onboarding/checklist';
import { checklistFixtures } from '@/mocks/dto/invitations';
import { projectFixtures } from '@/mocks/dto/projects';
import { ruleFixtures } from '@/mocks/dto/rules';
import { mockDb } from '@/mocks/msw/db';
import { jsonResponse, problemResponse } from '@/mocks/msw/http';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';
import { createElement, type ReactNode } from 'react';
import { useReplaceCredential } from '../desk/agent.form';
import { useSaveRule } from '../desk/mutations';
import { useInstallConnection, useSaveAgentStep, useSaveRepoStep, useSaveRulesStep } from '../setup/mutations';

describe('projects route', () => {
  it('lists the org projects linking to their runs, with connection status', async () => {
    await renderRoute('/o/alice/projects');
    const seeded = mockDb.state.projects.filter((p) => p.orgId === ids.org.alice);
    expect(seeded.length).toBeGreaterThanOrEqual(2);
    for (const p of seeded) {
      const link = await screen.findByRole('link', { name: p.name });
      expect(link).toHaveAttribute('href', `/o/alice/p/${p.id}/runs`);
    }
    const row = screen.getByRole('link', { name: 'invoicer-web' }).closest('tr');
    if (!row) throw new Error('row not found');
    expect(within(row).getByText('Polling every 5 min')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /New project/ })).toHaveAttribute('href', '/o/alice/projects/new/repo');
  });

  it('"Switch to polling" on a silent webhook project links to its agent settings', async () => {
    await renderRoute('/o/alice/projects');
    const link = await screen.findByRole('link', { name: 'Switch to polling for docs-site' });
    expect(link).toHaveAttribute('href', `/o/alice/p/${ids.project.docsSite}/desk/agent`);
  });

  it('the More menu of a project offers Runs and Settings links and a disabled Delete', async () => {
    await renderRoute('/o/alice/projects');
    const more = await screen.findByRole('button', { name: 'More for invoicer-api' });
    await userEvent.click(more);
    const menu = screen.getByRole('dialog', { name: 'Actions for invoicer-api' });
    expect(within(menu).getByRole('link', { name: 'Runs' })).toHaveAttribute(
      'href',
      `/o/alice/p/${ids.project.invoicerApi}/runs`,
    );
    expect(within(menu).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      `/o/alice/p/${ids.project.invoicerApi}/desk/agent`,
    );
    const del = within(menu).getByRole('button', { name: 'Delete' });
    expect(del).toBeDisabled();
    await userEvent.click(del);
    expect(screen.getByRole('dialog', { name: 'Actions for invoicer-api' })).toBeInTheDocument();
  });

  it('shows the empty state with a create link when the org has no projects', async () => {
    mockDb.state.projects = [];
    await renderRoute('/o/alice/projects');
    expect(await screen.findByRole('heading', { name: 'Create your first project' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Create project/ })).toHaveAttribute('href', '/o/alice/projects/new/repo');
  });

  it('shows an error with retry when the list fails', async () => {
    scenarios.serverError('projects.list');
    await renderRoute('/o/alice/projects');
    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('shows an error when a connection request fails', async () => {
    scenarios.serverError('projects.connection');
    await renderRoute('/o/alice/projects');
    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

describe('projects route clock', () => {
  it('advances the last-run text on the useNow tick without refetching', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date', 'setInterval', 'clearInterval'] });
    try {
      vi.setSystemTime(new Date('2026-11-12T14:14:00.000Z'));
      mockDb.state.projects = mockDb.state.projects.filter((p) => p.orgId === ids.org.alice).slice(0, 1);
      await renderRoute('/o/alice/projects');
      // Seed: last run 14:12Z for invoicer-api.
      expect(await screen.findByText('2 min ago')).toBeInTheDocument();
      const requests = mockDb.requests('GET', '/api/projects');
      await act(async () => {
        vi.setSystemTime(new Date('2026-11-12T14:24:00.000Z'));
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(await screen.findByText('12 min ago')).toBeInTheDocument();
      expect(mockDb.requests('GET', '/api/projects')).toBe(requests);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** Replaces the alice projects with `total` rows created one second apart. */
function seedProjects(total: number) {
  const [template] = mockDb.state.projects.filter((p) => p.orgId === ids.org.alice);
  if (!template) throw new Error('seed has no alice project');
  mockDb.state.projects = Array.from({ length: total }, (_, i) => ({
    ...template,
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    name: `project-${String(i + 1).padStart(2, '0')}`,
    repoPath: `dev/project-${String(i + 1).padStart(2, '0')}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
  }));
}
/** The wide page list comes first; jsdom shows both lists, the CSS container query picks one. */
function pageButton(n: number): HTMLElement {
  const [button] = screen.getAllByRole('button', { name: `Page ${n}` });
  if (!button) throw new Error(`no Page ${n} button`);
  return button;
}
const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

describe('projects route paging', () => {
  afterEach(() => localStorage.clear());

  it('shows 20 of 26 rows with the range, and page 2 the other 6 with ?page=2', async () => {
    seedProjects(26);
    const { user, router } = await renderRoute('/o/alice/projects');
    expect(await screen.findByText('Showing')).toBeInTheDocument();
    expect(screen.getByText('1–20')).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(20);

    await user.click(pageButton(2));

    await waitFor(() => expect(bodyRows()).toHaveLength(6));
    expect(router.state.location.search).toEqual({ page: '2' });
    expect(screen.getByText('21–26')).toBeInTheDocument();
  });

  it('replaces a page past the last with the last page', async () => {
    seedProjects(26);
    const { router } = await renderRoute('/o/alice/projects?page=9');
    await waitFor(() => expect(router.state.location.search).toEqual({ page: '2' }));
    await waitFor(() => expect(bodyRows()).toHaveLength(6));
    expect(router.history.length).toBe(1);
  });

  it('shows page 1 for a page number the API would refuse', async () => {
    seedProjects(26);
    const { router } = await renderRoute('/o/alice/projects?page=99999999999');
    expect(await screen.findByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(20);
    expect(router.state.location.search).toEqual({});
  });

  it('shows no pagination with 20 projects', async () => {
    seedProjects(20);
    await renderRoute('/o/alice/projects');
    await screen.findByRole('link', { name: 'project-20' });
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  });

  it('a new page size shows that many rows and returns to page 1', async () => {
    seedProjects(26);
    const { user, router } = await renderRoute('/o/alice/projects?page=2');
    await waitFor(() => expect(bodyRows()).toHaveLength(6));
    await user.selectOptions(screen.getByLabelText('Rows per page'), '50');
    await waitFor(() => expect(bodyRows()).toHaveLength(26));
    expect(router.state.location.search).toEqual({});
    expect(localStorage.getItem('agentdesk.pageSize')).toBe('50');
  });

  it('while page 2 is held, the control still reads "Showing 1–20" with Page 1 current; then the new range', async () => {
    seedProjects(26);
    const page2 = await (await fetch('http://localhost:3000/api/projects?page=2')).json();
    const { user } = await renderRoute('/o/alice/projects');
    await screen.findByText('1–20');
    const nav = () => screen.getByRole('navigation', { name: 'Pagination' });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('*/api/projects', async () => {
        await held;
        return jsonResponse(page2);
      }),
    );
    await user.click(pageButton(2));
    await waitFor(() => expect(nav()).toHaveAttribute('aria-busy', 'true'));
    expect(nav()).toHaveTextContent('Showing 1–20 of 26');
    expect(pageButton(1)).toHaveAttribute('aria-current', 'page');
    release();
    await waitFor(() => expect(nav()).toHaveAttribute('aria-busy', 'false'));
    expect(nav()).toHaveTextContent('Showing 21–26 of 26');
    expect(pageButton(2)).toHaveAttribute('aria-current', 'page');
  });

  it('keeps page 1 on screen, busy, while page 2 loads', async () => {
    seedProjects(26);
    const page2 = await (await fetch('http://localhost:3000/api/projects?page=2')).json();
    const { user } = await renderRoute('/o/alice/projects');
    await screen.findByText('1–20');
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('*/api/projects', async () => {
        await held;
        return jsonResponse(page2);
      }),
    );

    await user.click(pageButton(2));

    await waitFor(() => expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true'));
    expect(bodyRows()).toHaveLength(20);
    release();
    await waitFor(() => expect(bodyRows()).toHaveLength(6));
    expect(screen.getByRole('table')).not.toHaveAttribute('aria-busy');
  });
});

/** The first user (the signed-in one) is invited by n pending invitations, as a user in an org gets them. */
function inviteMe(n: number): void {
  const user = mockDb.state.users[0];
  const template = mockDb.state.invitations.find((i) => i.status === 'pending');
  if (!user || !template) throw new Error('scenario has no user or pending invitation');
  mockDb.state.invitations = Array.from({ length: n }, (_, i) => ({
    ...template,
    id: `b7000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    email: user.email.toLowerCase(),
    expiresAt: '2099-01-01T00:00:00.000Z',
  }));
}

describe('projects route invitations banner', () => {
  it('BR-3: shows the pending count and View goes to /invitations', async () => {
    const { router, user } = await renderRoute('/o/acme/projects', {
      scenario: () => {
        scenarios.onboarding('owner');
        inviteMe(2);
      },
    });
    expect(await screen.findByText('You have 2 pending invitations.')).toBeInTheDocument();
    const view = screen.getByRole('link', { name: 'View' });
    expect(view).toHaveAttribute('href', '/invitations');
    await user.click(view);
    expect(router.state.location.pathname).toBe('/invitations');
  });

  it('BR-3: says "1 pending invitation" (singular) for exactly one', async () => {
    await renderRoute('/o/acme/projects', {
      scenario: () => {
        scenarios.onboarding('owner');
        inviteMe(1);
      },
    });
    expect(await screen.findByText('You have 1 pending invitation.')).toBeInTheDocument();
  });

  it('BR-3: is hidden at 0 pending invitations', async () => {
    await renderRoute('/o/acme/projects', {
      scenario: () => {
        scenarios.onboarding('owner');
        inviteMe(0);
      },
    });
    await screen.findByRole('link', { name: 'invoicer-api' });
    expect(screen.queryByText(/pending invitation/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'View' })).toBeNull();
  });

  it('BR-3: is hidden when the invitations list fails, and the page still renders', async () => {
    await renderRoute('/o/acme/projects', {
      scenario: () => {
        scenarios.onboarding('owner');
        inviteMe(2);
        scenarios.serverError('me.listInvitations');
      },
    });
    expect(await screen.findByRole('link', { name: 'invoicer-api' })).toBeInTheDocument();
    await waitFor(() => expect(mockDb.requests('GET', '/api/me/invitations')).toBeGreaterThan(0));
    expect(screen.queryByText(/pending invitation/)).toBeNull();
  });
});

describe('projects route controls by role', () => {
  /** The Projects header (h1 and its actions): no Settings or Invitations button, whatever the role. */
  const expectNoHeaderButtons = () => {
    const main = screen.getByRole('main');
    expect(within(main).queryByRole('link', { name: /^(Settings|Invitations)$/ })).toBeNull();
    expect(within(main).queryByRole('button', { name: /^(Settings|Invitations)$/ })).toBeNull();
  };
  const mainTabs = () => within(screen.getByRole('banner')).getByRole('navigation', { name: 'Main' });

  it.each(['owner', 'orgAdmin', 'projectAdmin'] as const)(
    'TC-43.1, TC-49.1 to TC-49.3: a %s sees the Projects and Settings tabs, Projects active, and no header button',
    async (name) => {
      await renderRoute('/o/acme/projects', { scenario: () => scenarios.onboarding(name) });
      await screen.findByRole('link', { name: 'invoicer-api' });
      const settings = await within(mainTabs()).findByRole('link', { name: 'Settings' });
      expect(settings).toHaveAttribute('href', '/o/acme/settings');
      expect(within(mainTabs()).getAllByRole('link')).toHaveLength(2);
      expect(within(mainTabs()).getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
      expectNoHeaderButtons();
    },
  );

  it.each(['member', 'viewer'] as const)(
    'TC-43.3, TC-49.4, TC-49.5, BR-20: a %s sees only the Projects tab, no Settings, no Invitations and no New project',
    async (name) => {
      await renderRoute('/o/acme/projects', { scenario: () => scenarios.onboarding(name) });
      await screen.findByRole('link', { name: 'invoicer-api' });
      expect(within(mainTabs()).getAllByRole('link')).toHaveLength(1);
      expect(within(mainTabs()).getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
      expect(screen.queryByRole('link', { name: /^(Settings|Invitations)$/ })).toBeNull();
      expect(screen.queryByRole('link', { name: /New project/ })).toBeNull();
    },
  );

  it('TC-49.6: an owner of an org with no projects sees no Settings or Invitations button', async () => {
    await renderRoute('/o/acme/projects', { scenario: () => scenarios.onboarding('checklistNoProject') });
    await screen.findByRole('heading', { name: 'Create your first project' });
    await within(mainTabs()).findByRole('link', { name: 'Settings' });
    expect(within(screen.getByRole('main')).queryByRole('link', { name: /^(Settings|Invitations)$/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Create project/ })).toBeVisible();
  });

  it('BR-20: an owner sees New project', async () => {
    await renderRoute('/o/acme/projects', { scenario: () => scenarios.onboarding('owner') });
    expect(await screen.findByRole('link', { name: /New project/ })).toHaveAttribute(
      'href',
      '/o/acme/projects/new/repo',
    );
  });
});

const checklistPath = `/api/orgs/${ids.org.acme}/checklist`;
const checklistCard = () => screen.queryByRole('heading', { name: 'Get started' });
/** The card's row of one step: its label's list item. */
const row = (label: string): HTMLElement => {
  const item = screen.getByText(label).closest('li');
  if (!item) throw new Error(`no row ${label}`);
  return item;
};

describe('projects route first-run checklist', () => {
  it('BR-13: an owner with no project sees Get started with four Not done rows in place of the step cards', async () => {
    await renderRoute('/o/acme/projects', { scenario: () => scenarios.onboarding('checklistNoProject') });
    expect(await screen.findByRole('heading', { name: 'Get started' })).toBeInTheDocument();
    for (const label of ['Connect a code host', 'Create a project', 'Add an agent', 'Add a rule']) {
      const item = row(label);
      expect(within(item).getByRole('img', { name: 'Not done' })).toBeInTheDocument();
      expect(within(item).getByRole('link', { name: 'Start' })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('img', { name: 'Not done' })).toHaveLength(4);
    // The static step cards give way to the checklist: each label shows once.
    expect(screen.getAllByText('Connect a code host')).toHaveLength(1);
    expect(screen.getAllByText('Add a rule')).toHaveLength(1);
  });

  it('BR-13 BR-14: a partial checklist shows above the project table, with done and not done rows', async () => {
    await renderRoute('/o/acme/projects', { scenario: () => scenarios.onboarding('checklistPartial') });
    const heading = await screen.findByRole('heading', { name: 'Get started' });
    const table = await screen.findByRole('table');
    expect(heading.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(row('Connect a code host')).getByRole('img', { name: 'Done' })).toBeInTheDocument();
    expect(within(row('Create a project')).getByRole('img', { name: 'Done' })).toBeInTheDocument();
    expect(within(row('Add an agent')).getByRole('img', { name: 'Not done' })).toBeInTheDocument();
    expect(within(row('Add a rule')).getByRole('img', { name: 'Not done' })).toBeInTheDocument();
    expect(within(row('Connect a code host')).queryByRole('link', { name: 'Start' })).toBeNull();
  });

  it('TC-15.1 TC-15.2 BR-15: with no project every Start opens the new-project wizard', async () => {
    await renderRoute('/o/acme/projects', { scenario: () => scenarios.onboarding('checklistNoProject') });
    await screen.findByRole('heading', { name: 'Get started' });
    for (const label of ['Connect a code host', 'Create a project']) {
      expect(within(row(label)).getByRole('link', { name: 'Start' })).toHaveAttribute(
        'href',
        '/o/acme/projects/new/repo',
      );
    }
  });

  it('TC-15.3 TC-15.4 BR-15: Start on a partial checklist opens the agent and rule setup of its project', async () => {
    await renderRoute('/o/acme/projects', { scenario: () => scenarios.onboarding('checklistPartial') });
    await screen.findByRole('heading', { name: 'Get started' });
    expect(within(row('Add an agent')).getByRole('link', { name: 'Start' })).toHaveAttribute(
      'href',
      `/o/acme/p/${ids.project.invoicerApi}/desk/agent`,
    );
    expect(within(row('Add a rule')).getByRole('link', { name: 'Start' })).toHaveAttribute(
      'href',
      `/o/acme/p/${ids.project.invoicerApi}/desk/rules`,
    );
  });

  it('TC-15.5 BR-15: with two projects Start on "Add a rule" opens the rules of P1, the furthest along', async () => {
    const { user, router } = await renderRoute('/o/acme/projects', {
      scenario: () => scenarios.onboarding('checklistTwoProjects'),
    });
    await screen.findByRole('heading', { name: 'Get started' });
    const start = within(row('Add a rule')).getByRole('link', { name: 'Start' });
    expect(start).toHaveAttribute('href', `/o/acme/p/${ids.project.invoicerApi}/desk/rules`);
    await user.click(start);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/o/acme/p/${ids.project.invoicerApi}/desk/rules`));
  });

  it('TC-16.1 BR-16: a complete checklist shows no card', async () => {
    await renderRoute('/o/acme/projects', { scenario: () => scenarios.onboarding('checklistComplete') });
    await screen.findByRole('table');
    await waitFor(() => expect(mockDb.requests('GET', checklistPath)).toBeGreaterThan(0));
    expect(checklistCard()).toBeNull();
  });

  it.each(['projectAdmin', 'member', 'viewer'] as const)(
    'BR-17: a %s sees no checklist card and the checklist is never requested',
    async (name) => {
      await renderRoute('/o/acme/projects', { scenario: () => scenarios.onboarding(name) });
      await screen.findByRole('link', { name: 'invoicer-api' });
      expect(checklistCard()).toBeNull();
      expect(mockDb.requests('GET', checklistPath)).toBe(0);
    },
  );

  it('a failing checklist shows the error card with Retry while the project list still renders', async () => {
    const { user } = await renderRoute('/o/acme/projects', {
      scenario: () => {
        scenarios.onboarding('checklistPartial');
        scenarios.serverError('orgs.checklist');
      },
    });
    expect(await screen.findByRole('link', { name: 'invoicer-api' })).toBeInTheDocument();
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    expect(screen.queryByText('Add an agent')).toBeNull();
    const before = mockDb.requests('GET', checklistPath);
    // The next answer succeeds.
    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Add an agent')).toBeInTheDocument();
    expect(mockDb.requests('GET', checklistPath)).toBeGreaterThan(before);
  });

  it('shows the loading state while the checklist is pending', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await renderRoute('/o/acme/projects', {
      scenario: () => {
        scenarios.onboarding('checklistPartial');
        server.use(
          http.get('*/api/orgs/*/checklist', async () => {
            await held;
            return jsonResponse(checklistFixtures.partial);
          }),
        );
      },
    });
    await screen.findByRole('link', { name: 'invoicer-api' });
    expect(screen.getByText('Loading checklist')).toBeInTheDocument();
    release();
    expect(await screen.findByText('Add an agent')).toBeInTheDocument();
  });

  it('BR-16: an invalidated checklist does not show its stale incomplete card while it refetches', async () => {
    const { queryClient } = await renderRoute('/o/acme/projects', {
      scenario: () => scenarios.onboarding('checklistPartial'),
    });
    expect(await screen.findByText('Add a rule')).toBeInTheDocument();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('*/api/orgs/*/checklist', async () => {
        await held;
        return jsonResponse(checklistFixtures.complete);
      }),
    );
    // The last step was completed elsewhere, so the cached card is known to be out of date.
    void queryClient.invalidateQueries({ queryKey: checklistKey('acme') });
    expect(await screen.findByText('Loading checklist')).toBeInTheDocument();
    expect(screen.queryByText('Add a rule')).toBeNull();
    release();
    await waitFor(() => expect(checklistCard()).toBeNull());
    expect(screen.queryByText('Loading checklist')).toBeNull();
  });
});

describe('checklist refresh after a step completes', () => {
  async function setup() {
    const { queryClient } = await renderRoute('/o/acme/projects', {
      scenario: () => scenarios.onboarding('checklistPartial'),
    });
    await screen.findByText('Add an agent');
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    return { wrapper, count: () => mockDb.requests('GET', checklistPath) };
  }
  const P1 = ids.project.invoicerApi;
  const refetchedPast = (count: () => number, before: number) => waitFor(() => expect(count()).toBeGreaterThan(before));

  it('BR-14: creating a rule refetches the checklist', async () => {
    const { wrapper, count } = await setup();
    const { result } = renderHook(() => useSaveRule('acme', P1), { wrapper });
    const before = count();
    await act(() =>
      result.current.mutateAsync({
        body: {
          kind: 'prompt',
          command: 'triage',
          labelFilter: [],
          target: 'issue',
          enabled: true,
          prompt: 'Triage it',
        },
      }),
    );
    await refetchedPast(count, before);
  });

  it('BR-14: a rule saved in the setup wizard refetches the checklist', async () => {
    const { wrapper, count } = await setup();
    const { result } = renderHook(() => useSaveRulesStep('acme'), { wrapper });
    const project = projectFixtures.find((p) => p.id === P1);
    if (!project) throw new Error('no project');
    const before = count();
    await act(() =>
      result.current.mutateAsync({
        project,
        rules: [{ kind: 'prompt', command: 'wizard', labelFilter: [], target: 'any', enabled: true, prompt: 'Do it' }],
      }),
    );
    await refetchedPast(count, before);
  });

  it('BR-14: a project created refetches the checklist', async () => {
    const { wrapper, count } = await setup();
    const { result } = renderHook(() => useSaveRepoStep('acme'), { wrapper });
    const connection = mockDb.state.connections.find((c) => c.orgId === ids.org.acme);
    if (!connection) throw new Error('no connection');
    const repo = (mockDb.state.repos[connection.id] ?? []).find(
      (r) => !mockDb.state.projects.some((p) => p.repoPath === r.repoPath),
    );
    if (!repo) throw new Error('no free repo');
    const before = count();
    await act(() =>
      result.current.mutateAsync({
        kind: 'create',
        body: { connectionId: connection.id, repoPath: repo.repoPath, triggerMode: 'polling' },
      }),
    );
    await refetchedPast(count, before);
  });

  it('BR-14: setting the agent credential refetches the checklist', async () => {
    const { wrapper, count } = await setup();
    const agent = mockDb.state.agents.find((a) => a.projectId === P1);
    if (!agent) throw new Error('no agent');
    const { result } = renderHook(() => useReplaceCredential('acme', P1, agent.id), { wrapper });
    const before = count();
    await act(() => result.current.replace('oauth_token', 'sk-ant-oat-123'));
    await refetchedPast(count, before);
  });

  it('BR-14: linking a code host connection refetches the checklist', async () => {
    const { wrapper, count } = await setup();
    const { result } = renderHook(() => useInstallConnection('acme'), { wrapper });
    const connection = mockDb.state.connections.find((c) => c.orgId === ids.org.acme);
    if (!connection) throw new Error('no connection');
    mockDb.state.connections = mockDb.state.connections.filter((c) => c.id !== connection.id);
    server.use(http.post(`*/api/connections/${connection.provider}/sync`, () => jsonResponse([connection])));
    const before = count();
    await act(() => result.current.mutateAsync(connection.provider));
    await refetchedPast(count, before);
  });
});

describe('checklist is not refetched when a write does not complete a step', () => {
  async function setup() {
    const { queryClient } = await renderRoute('/o/acme/projects', {
      scenario: () => scenarios.onboarding('checklistPartial'),
    });
    await screen.findByText('Add an agent');
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const count = () => mockDb.requests('GET', checklistPath);
    // The hooks await their invalidations, so a refetch has finished by the time a write resolves.
    const expectUntouched = (before: number) => {
      expect(count()).toBe(before);
      expect(queryClient.getQueryState(checklistKey('acme'))?.isInvalidated).toBe(false);
    };
    return { wrapper, count, expectUntouched };
  }
  const P1 = ids.project.invoicerApi;
  const promptRule = (command: string): CreateRuleRequest => ({
    kind: 'prompt',
    command,
    labelFilter: [],
    target: 'any',
    enabled: true,
    prompt: 'Do it',
  });

  it('BR-14: updating an existing rule does not refetch the checklist', async () => {
    const { wrapper, count, expectUntouched } = await setup();
    const { result } = renderHook(() => useSaveRule('acme', P1), { wrapper });
    let rule: RuleDto | undefined;
    await act(async () => {
      rule = await result.current.mutateAsync({ body: promptRule('to-update') });
    });
    if (!rule) throw new Error('no rule');
    const before = count();
    await act(() => result.current.mutateAsync({ id: rule?.id ?? '', body: { enabled: false } }));
    expectUntouched(before);
  });

  it('BR-14: updating a project in the setup wizard does not refetch the checklist', async () => {
    const { wrapper, count, expectUntouched } = await setup();
    const project = projectFixtures.find((p) => p.id === P1);
    if (!project) throw new Error('no project');
    const { result } = renderHook(() => useSaveRepoStep('acme'), { wrapper });
    const before = count();
    await act(() =>
      result.current.mutateAsync({
        kind: 'update',
        project,
        body: { name: 'renamed', triggerMode: project.triggerMode, pollIntervalSeconds: project.pollIntervalSeconds },
      }),
    );
    expectUntouched(before);
  });

  it('BR-14: a failed credential save in the desk does not refetch the checklist', async () => {
    const { wrapper, count, expectUntouched } = await setup();
    const agent = mockDb.state.agents.find((a) => a.projectId === P1);
    if (!agent) throw new Error('no agent');
    scenarios.serverError('agents.putCredential');
    const { result } = renderHook(() => useReplaceCredential('acme', P1, agent.id), { wrapper });
    const before = count();
    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.replace('oauth_token', 'sk-ant-oat-123');
    });
    expect(saved).toBe(false);
    expectUntouched(before);
  });

  it('BR-14: a failed credential save in the setup wizard does not refetch the checklist', async () => {
    const { wrapper, count, expectUntouched } = await setup();
    const project = projectFixtures.find((p) => p.id === P1);
    const agent = mockDb.state.agents.find((a) => a.projectId === P1);
    if (!project || !agent) throw new Error('no project or agent');
    scenarios.serverError('agents.putCredential');
    const { result } = renderHook(() => useSaveAgentStep('acme'), { wrapper });
    const before = count();
    await act(async () => {
      await expect(
        result.current.save(project, agent, {
          model: agent.model,
          maxConcurrentRuns: 1,
          credentialType: 'oauth_token',
          credential: 'sk-ant-oat-123',
        }),
      ).rejects.toBeDefined();
    });
    expectUntouched(before);
  });

  it('BR-14: a rule save that fails partway does not refetch the checklist', async () => {
    const { wrapper, count, expectUntouched } = await setup();
    const project = projectFixtures.find((p) => p.id === P1);
    const template = ruleFixtures[0];
    if (!project || !template) throw new Error('no project or rule');
    let calls = 0;
    server.use(
      http.post('*/api/projects/*/rules', () => {
        calls += 1;
        return calls === 1
          ? jsonResponse({ ...template, command: 'first-new' })
          : problemResponse({ status: 500, title: 'Internal server error', type: 'internal' });
      }),
    );
    const { result } = renderHook(() => useSaveRulesStep('acme'), { wrapper });
    const before = count();
    await act(async () => {
      await expect(
        result.current.mutateAsync({ project, rules: [promptRule('first-new'), promptRule('second-new')] }),
      ).rejects.toBeDefined();
    });
    expect(calls).toBe(2);
    expectUntouched(before);
  });
});
