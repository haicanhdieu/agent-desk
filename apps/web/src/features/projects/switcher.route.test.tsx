import { act, screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { applyShellScenario } from '@/mocks/msw/shellScenarios';
import { renderRoute } from '@/test/renderRoute';

const base = `/o/alice/p/${ids.project.invoicerApi}`;
const switcher = () => screen.getByRole('button', { name: /^Switch project/ });

describe('project switcher in the top bar', () => {
  it('does not request the project list until the menu opens', async () => {
    const { user } = await renderRoute(`${base}/runs`);
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    expect(mockDb.requests('GET', '/api/projects')).toBe(0);

    await user.click(switcher());

    const menu = await screen.findByRole('dialog', { name: 'Projects' });
    await within(menu).findAllByRole('link');
    expect(mockDb.requests('GET', '/api/projects')).toBe(1);
  });

  it('opens a list of the org projects, marks the current one and links to the others', async () => {
    const { user } = await renderRoute(`${base}/runs`);
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    expect(switcher()).toHaveAttribute('aria-expanded', 'false');

    await user.click(switcher());

    expect(switcher()).toHaveAttribute('aria-expanded', 'true');
    const menu = await screen.findByRole('dialog', { name: 'Projects' });
    const seeded = mockDb.state.projects.filter((p) => p.orgId === ids.org.alice);
    expect(seeded.length).toBeGreaterThanOrEqual(2);
    for (const p of seeded) {
      const link = await within(menu).findByRole('link', { name: new RegExp(p.name) });
      expect(link).toHaveAttribute('href', `/o/alice/p/${p.id}/runs`);
      if (p.id === ids.project.invoicerApi) expect(link).toHaveAttribute('aria-current');
      else expect(link).not.toHaveAttribute('aria-current');
    }
  });

  it('shows an error with retry when the project list fails', async () => {
    const { user } = await renderRoute(`${base}/runs`, { scenario: () => scenarios.serverError('projects.list') });
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    await user.click(switcher());
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('project switcher navigation', () => {
  it('picking another project navigates to its runs and closes the menu', async () => {
    const { user, router } = await renderRoute(`${base}/runs`);
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    await user.click(switcher());
    const other = mockDb.state.projects.find((p) => p.orgId === ids.org.alice && p.id !== ids.project.invoicerApi);
    if (!other) throw new Error('seed has no second project');
    await user.click(await screen.findByRole('link', { name: new RegExp(other.name) }));
    expect(router.state.location.pathname).toBe(`/o/alice/p/${other.id}/runs`);
    expect(screen.queryByRole('dialog', { name: 'Projects' })).toBeNull();
  });
});

describe('project switcher with many projects', () => {
  function seed(total: number) {
    const [template] = mockDb.state.projects.filter((p) => p.orgId === ids.org.alice);
    if (!template) throw new Error('seed has no alice project');
    mockDb.state.projects = [
      template,
      ...Array.from({ length: total - 1 }, (_, i) => ({
        ...template,
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
        name: `extra-${String(i + 1).padStart(3, '0')}`,
        repoPath: `dev/extra-${i + 1}`,
        createdAt: new Date(Date.UTC(2026, 11, 1, 0, 0, i)).toISOString(),
      })),
    ];
  }

  // The menu's footer holds "All projects" and "New project" (shell spec BR-48); the count is of the projects.
  const projectLinks = (menu: HTMLElement) =>
    within(menu)
      .getAllByRole('link')
      .filter((a) => !/^(All projects|New project)$/.test(a.textContent ?? ''));

  it('lists all 26 projects with one request for 100 rows', async () => {
    seed(26);
    const { user } = await renderRoute(`${base}/runs`);
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    await user.click(switcher());
    const menu = await screen.findByRole('dialog', { name: 'Projects' });
    await within(menu).findAllByRole('link');
    expect(projectLinks(menu)).toHaveLength(26);
    expect(mockDb.requests('GET', '/api/projects')).toBe(1);
  });

  it('lists 100 of 101 projects', async () => {
    seed(101);
    const { user } = await renderRoute(`${base}/runs`);
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    await user.click(switcher());
    const menu = await screen.findByRole('dialog', { name: 'Projects' });
    await within(menu).findAllByRole('link');
    expect(projectLinks(menu)).toHaveLength(100);
  });
});

// --- BR-68: nothing typed or opened for the old project outlives the switch (Task 32, Step 1) -------------------
const P1 = ids.project.invoicerApi;
const P2 = ids.project.invoicerWeb;
const at = (id: string, page: string) => `/o/alice/p/${id}/desk/${page}`;
const FAKE_TOKEN = 'sk-fake-canary-0068';
const distinct = () => applyShellScenario('distinctProjects');

/** What the switcher does: the target project's page, with no search. */
async function switchTo(router: { navigate(o: { to: string }): Promise<void> }, to: string) {
  await act(async () => {
    await router.navigate({ to });
  });
}

/** Every request the app sends from now on: its URL and body. */
const sentLog: string[] = [];
const logListener = ({ request }: { request: Request }) => {
  void request
    .clone()
    .text()
    .then((body) => sentLog.push(`${request.method} ${request.url} ${body}`));
};
afterEach(() => {
  server.events.removeListener('request:start', logListener);
  sentLog.length = 0;
});
const startLog = () => server.events.on('request:start', logListener);

describe('switching project drops drafts (BR-68)', () => {
  it('an unsaved setup draft of P1 is gone on P2: P2 shows its saved script and saving sends nothing of P1', async () => {
    startLog();
    const { user, router } = await renderRoute(at(P1, 'setup'), { scenario: distinct });
    const editor = () => screen.getByRole('textbox', { name: 'Setup script' });
    await screen.findByText(/Version 1, saved by/);
    expect(editor()).toHaveValue('echo "setup of invoicer-api"');
    await user.type(editor(), '\nP1-DRAFT-MARKER');
    expect(editor()).toHaveValue('echo "setup of invoicer-api"\nP1-DRAFT-MARKER');

    await switchTo(router, at(P2, 'setup'));

    await waitFor(() => expect(editor()).toHaveValue('echo "setup of invoicer-web"'));
    expect(document.body.textContent).not.toContain('P1-DRAFT-MARKER');
    expect(screen.getByRole('button', { name: 'Save version 2' })).toBeDisabled();
    expect(sentLog.filter((l) => l.startsWith('PUT ') && l.includes('setup-script'))).toEqual([]);
  });

  it('an open member dialog of P1 is closed on P2', async () => {
    const { user, router } = await renderRoute(at(P1, 'members'), { scenario: distinct });
    await screen.findByRole('heading', { level: 1, name: 'Members' });
    await user.click(screen.getAllByRole('button', { name: 'Add member' })[0] as HTMLElement);
    await screen.findByRole('dialog', { name: /Add member to/ });

    await switchTo(router, at(P2, 'members'));

    await screen.findByRole('heading', { level: 1, name: 'Members' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('an unsaved skills edit of P1 is gone on P2: the same-named skill shows its own text', async () => {
    const { user, router } = await renderRoute(`${at(P1, 'skills')}?skill=shared-skill`, { scenario: distinct });
    const source = () => screen.getByLabelText<HTMLTextAreaElement>('SKILL.md source');
    await screen.findByLabelText('SKILL.md source');
    await user.type(source(), '\nP1-SKILL-DRAFT');
    expect(source().value).toContain('P1-SKILL-DRAFT');

    await switchTo(router, `${at(P2, 'skills')}?skill=shared-skill`);

    await waitFor(() => expect(source().value).toContain('Different text of the skill'));
    expect(document.body.textContent).not.toContain('P1-SKILL-DRAFT');
    expect(screen.queryByText('Unsaved changes')).toBeNull();
  });

  it('an unsaved rule agent pick of P1 is not carried to the rule pane of P2', async () => {
    const { user, router } = await renderRoute(`${at(P1, 'rules')}?rule=new`, { scenario: distinct });
    const form = await screen.findByRole('complementary', { name: 'New rule' });
    const select = (root: HTMLElement) => within(root).getByRole('combobox', { name: 'With agent' });
    await waitFor(() => expect(within(select(form)).getAllByRole('option').length).toBeGreaterThan(1));
    const mine = mockDb.state.agents.find((a) => a.projectId === P1);
    if (!mine) throw new Error('P1 has no agent');
    await user.selectOptions(select(form), mine.id);
    expect(select(form)).toHaveValue(mine.id);

    await switchTo(router, at(P2, 'rules'));
    await screen.findByRole('heading', { level: 1, name: 'Routing rules' });
    expect(screen.queryByRole('complementary')).toBeNull();
    await switchTo(router, `${at(P2, 'rules')}?rule=new`);

    const again = await screen.findByRole('complementary', { name: 'New rule' });
    await waitFor(() => expect(within(select(again)).getAllByRole('option').length).toBeGreaterThan(1));
    expect(select(again)).toHaveValue('');
    expect(document.body.innerHTML).not.toContain(mine.id);
  });
});

describe('switching project from Agent & settings (BR-68)', () => {
  const agentsHeading = () => screen.findByRole('heading', { level: 1, name: 'Agent & settings' });
  const selectedTab = () => screen.getByRole('tab', { selected: true }).textContent;

  it('a typed token in the add pane is in no DOM node, no cache entry and no later request', async () => {
    const { user, router, queryClient } = await renderRoute(`${at(P1, 'agent')}?agent=new`, { scenario: distinct });
    await screen.findByRole('heading', { level: 2, name: 'Add agent' });
    await user.click(await screen.findByRole('radio', { name: 'Claude Code' }));
    await user.type(screen.getByLabelText('Subscription token'), FAKE_TOKEN);
    expect(screen.getByLabelText('Subscription token')).toHaveValue(FAKE_TOKEN);
    startLog();

    await switchTo(router, at(P2, 'agent'));

    await agentsHeading();
    expect(selectedTab()).toBe('Agents');
    expect(screen.queryByRole('heading', { level: 2, name: 'Add agent' })).toBeNull();
    expect(screen.queryByLabelText('Subscription token')).toBeNull();
    expect(router.state.location.search).toEqual({});
    await screen.findByText('Claude - invoicer-web');
    expect(document.body.innerHTML).not.toContain(FAKE_TOKEN);
    expect(
      JSON.stringify(
        queryClient
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain(FAKE_TOKEN);
    expect(
      JSON.stringify(
        queryClient
          .getMutationCache()
          .getAll()
          .map((m) => [m.state.variables, m.state.data]),
      ),
    ).not.toContain(FAKE_TOKEN);
    // Opening the pane and the tabs again shows only P2's saved values.
    await user.click(screen.getByRole('button', { name: 'Add agent' }));
    await screen.findByRole('heading', { level: 2, name: 'Add agent' });
    await user.click(await screen.findByRole('radio', { name: 'Claude Code' }));
    expect(screen.getByLabelText('Subscription token')).toHaveValue('');
    expect(sentLog.join('\n')).not.toContain(FAKE_TOKEN);
    expect(sentLog.join('\n')).not.toContain(ids.agent.invoicerApi);
  });

  it('an edit pane of a P1 agent is closed on P2, which lists only its own agent', async () => {
    const { router } = await renderRoute(`${at(P1, 'agent')}?agent=${ids.agent.invoicerApi}`, { scenario: distinct });
    await screen.findByRole('heading', { level: 2, name: 'Edit agent' });
    startLog();

    await switchTo(router, at(P2, 'agent'));

    await agentsHeading();
    expect(screen.queryByRole('heading', { level: 2, name: 'Edit agent' })).toBeNull();
    expect(screen.queryByText('Claude - invoicer-api')).toBeNull();
    await screen.findByText('Claude - invoicer-web');
    expect(sentLog.join('\n')).not.toContain(ids.agent.invoicerApi);
  });

  it('an unsaved Limits value of P1 is gone: P2 shows its saved limit on Limits', async () => {
    const { user, router } = await renderRoute(`${at(P1, 'agent')}?tab=limits`, { scenario: distinct });
    await agentsHeading();
    const timeout = () => screen.getByLabelText('Run time limit');
    expect(timeout()).toHaveValue('24');
    await user.clear(timeout());
    await user.type(timeout(), '5');
    expect(timeout()).toHaveValue('5');

    await switchTo(router, at(P2, 'agent'));
    await agentsHeading();
    await user.click(screen.getByRole('tab', { name: 'Limits' }));

    expect(timeout()).toHaveValue('2');
  });

  it("an unsaved trigger pick of P1 on GitHub connection shows P2's saved choice, not the pick", async () => {
    // P1's trigger save is held: the pick shows at once and stays until the save settles.
    server.use(http.patch(`*/api/projects/${P1}`, () => new Promise<Response>(() => undefined)));
    const { user, router } = await renderRoute(`${at(P1, 'agent')}?tab=github`, { scenario: distinct });
    await agentsHeading();
    expect(await screen.findByRole('radio', { name: 'Webhook' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Polling' }));
    expect(screen.getByRole('radio', { name: 'Polling' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '5 min' })).toBeChecked();

    await switchTo(router, at(P2, 'agent'));
    await agentsHeading();
    expect(selectedTab()).toBe('Agents');
    await user.click(screen.getByRole('tab', { name: 'GitHub connection' }));

    expect(await screen.findByRole('radio', { name: 'Polling' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '30 min' })).toBeChecked();
  });
});

describe('the project layout keeps the page for the same project (BR-68)', () => {
  it('changing only the search does not remount the page', async () => {
    const { router } = await renderRoute(at(P1, 'agent'), { scenario: distinct });
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Agent & settings' });
    await act(async () => {
      await router.navigate({ to: at(P1, 'agent'), search: { tab: 'limits' } });
    });
    await screen.findByLabelText('Run time limit');
    expect(screen.getByRole('heading', { level: 1, name: 'Agent & settings' })).toBe(h1);
  });
});

describe('the switcher keeps the page (BR-48 to BR-52)', () => {
  const openSwitcher = async (user: Awaited<ReturnType<typeof renderRoute>>['user']) => {
    await user.click(switcher());
    const menu = await screen.findByRole('dialog', { name: 'Projects' });
    await within(menu).findAllByRole('link');
    return menu;
  };
  const href = (menu: HTMLElement, name: string) =>
    within(menu)
      .getByRole('link', { name: new RegExp(name) })
      .getAttribute('href');

  it('BR-51: from Routing rules the other project opens on its Routing rules, with no search', async () => {
    const { user } = await renderRoute(`${at(P1, 'rules')}?rule=new`, { scenario: distinct });
    await screen.findByRole('heading', { level: 1, name: 'Routing rules' });
    const menu = await openSwitcher(user);
    expect(href(menu, 'invoicer-web')).toBe(at(P2, 'rules'));
  });

  it.each([
    ['skills', 'skills'],
    ['setup', 'setup'],
    ['members', 'members'],
    ['audit', 'audit'],
  ])('BR-51: from %s the other project opens on the same page', async (page, target) => {
    const { user } = await renderRoute(at(P1, page), { scenario: distinct });
    await screen.findByRole('navigation', { name: 'Project menu' });
    const menu = await openSwitcher(user);
    expect(href(menu, 'invoicer-web')).toBe(at(P2, target));
  });

  it('BR-51: from an Agent & settings tab or pane the target is the agent page with no search', async () => {
    const { user } = await renderRoute(`${at(P1, 'agent')}?tab=limits`, { scenario: distinct });
    await screen.findByRole('heading', { level: 1, name: 'Agent & settings' });
    const menu = await openSwitcher(user);
    expect(href(menu, 'invoicer-web')).toBe(at(P2, 'agent'));
  });

  it('BR-51: where the person may not open the page on the target, the target opens on Runs', async () => {
    const { user } = await renderRoute(at(P1, 'rules'), { scenario: () => applyShellScenario('adminP1ViewerP2') });
    await screen.findByRole('heading', { level: 1, name: 'Routing rules' });
    const menu = await openSwitcher(user);
    expect(href(menu, 'invoicer-web')).toBe(`/o/alice/p/${P2}/runs`);
  });

  it('BR-52: from a run page the other project opens on its Runs', async () => {
    const { user } = await renderRoute(`/o/alice/p/${P1}/runs/62`, { scenario: distinct });
    await screen.findByRole('button', { name: /^Switch project/ });
    const menu = await openSwitcher(user);
    expect(href(menu, 'invoicer-web')).toBe(`/o/alice/p/${P2}/runs`);
  });

  it('BR-48: lists only the projects the caller can see, the current one checked, and "All projects"', async () => {
    const { user } = await renderRoute(`/o/alice/p/${P1}/runs`, {
      scenario: () => applyShellScenario('adminP1ViewerP2'),
    });
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    const menu = await openSwitcher(user);
    expect(
      within(menu)
        .getAllByRole('link')
        .map((a) => a.textContent?.replace(/\d+ needs you$/, '').trim()),
    ).toEqual(['invoicer-api', 'invoicer-web', 'All projects']);
    expect(within(menu).getByRole('link', { name: /invoicer-api/ })).toHaveAttribute('aria-current');
    expect(within(menu).getByRole('link', { name: 'All projects' })).toHaveAttribute('href', '/o/alice/projects');
  });

  it('BR-49: "New project" shows only with org-level project:create', async () => {
    const owner = await renderRoute(`/o/alice/p/${P1}/runs`);
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    const menu = await openSwitcher(owner.user);
    expect(within(menu).getByRole('link', { name: 'New project' })).toHaveAttribute(
      'href',
      '/o/alice/projects/new/repo',
    );
  });

  it('BR-49: a person without it sees no "New project"', async () => {
    const { user } = await renderRoute(`/o/alice/p/${P1}/runs`, {
      scenario: () => applyShellScenario('memberP1ViewerP2'),
    });
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    const menu = await openSwitcher(user);
    expect(within(menu).queryByRole('link', { name: 'New project' })).toBeNull();
  });
});
