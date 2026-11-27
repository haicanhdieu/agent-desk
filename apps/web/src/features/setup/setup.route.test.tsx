import { focusManager, QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENT_KIND_CAPABILITIES } from '@agentdesk/contracts';
import { ids } from '@/mocks/dto/ids';
import { projectFixtures } from '@/mocks/dto/projects';
import { mockDb } from '@/mocks/msw/db';
import { jsonResponse, problemResponse, routeHandler } from '@/mocks/msw/http';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';
import { browserLocation } from './location';
import { useSaveAgentStep } from './mutations';
import { createElement, type ReactNode } from 'react';

const base = '/o/alice/projects/new';
const TOKEN = 'sk-ant-oat01-very-secret-token';

function projectRow(id: string) {
  const row = mockDb.state.projects.find((p) => p.id === id);
  if (!row) throw new Error(`project ${id} not in the mock store`);
  return row;
}

/** Puts a seeded project back at `step`, as if setup stopped there. */
function seedAt(step: 'agent' | 'setup' | 'skills' | 'rules') {
  const row = projectRow(ids.project.invoicerApi);
  row.setupStep = step;
  return row.id;
}

/** Everything the Query client holds: query data and mutation variables. */
const cacheText = (qc: QueryClient) =>
  JSON.stringify([
    qc
      .getQueryCache()
      .getAll()
      .map((q) => q.state.data),
    qc
      .getMutationCache()
      .getAll()
      .map((m) => m.state.variables),
  ]);

let stopListening: (() => void) | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  stopListening?.();
  stopListening = undefined;
});

type User = Awaited<ReturnType<typeof renderRoute>>['user'];

/** The Agent step starts with nothing picked; picks Claude Code (the project's agent) unless it is already shown. */
async function openClaude(user: User) {
  const claude = await screen.findByRole('radio', { name: 'Claude Code' });
  if (!(claude instanceof HTMLInputElement) || !claude.checked) await user.click(claude);
}
const token = () => screen.getByLabelText('Subscription token', { selector: 'input[type="password"]' });
async function tokenBox(user: User) {
  await openClaude(user);
  return token();
}
async function addressBox(user: User) {
  await openClaude(user);
  return screen.getByLabelText('API address');
}

const INSTALL_URL = 'https://github.com/apps/agent-desk/installations/new';

/** `window.open` answers with a blank tab the test can read; jsdom has no tabs. */
function stubTab() {
  const tab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
  // The stand-in has only the members the app touches (opener, location.href, close), so it is cast to Window.
  const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
  return { tab, open };
}

describe('setup flow', () => {
  it('BR-43: the wizard shows the org bar with Projects active and the Settings tab for an owner', async () => {
    await renderRoute(`${base}/repo`);
    await screen.findByRole('heading', { level: 1, name: 'Connect a repository' });
    const bar = screen.getByRole('banner');
    const tabs = within(bar).getByRole('navigation', { name: 'Organization sections' });
    expect(within(tabs).getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
    expect(await within(tabs).findByRole('link', { name: 'Org settings' })).toHaveAttribute(
      'href',
      '/o/alice/settings',
    );
    expect(within(bar).getByRole('button', { name: /^Switch scope/ })).toBeVisible();
  });

  it('saves each step on Continue and moves on with the project in the URL', async () => {
    const log = vi.spyOn(console, 'log');
    const { router, queryClient, user } = await renderRoute(`${base}/repo`);

    // Step repo: dev/demo, polling every 10 min.
    await user.click(await screen.findByRole('radio', { name: 'dev/demo' }));
    const modes = screen.getByRole('radiogroup', { name: 'How Agent Desk hears about new comments' });
    await user.click(within(modes).getByRole('radio', { name: 'Polling' }));
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Check every' })).getByRole('radio', { name: '10 min' }),
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/agent`));
    const created = mockDb.state.projects.find((p) => p.repoPath === 'dev/demo');
    expect(created).toMatchObject({
      codeConnectionId: ids.connection.dev,
      triggerMode: 'polling',
      pollIntervalSeconds: 600,
      setupStep: 'agent',
    });
    if (!created) throw new Error('project not created');
    expect(router.state.location.search).toEqual({ project: created.id });

    // Step agent: the credential is saved, then the project moves on to setup.
    await user.type(await tokenBox(user), TOKEN);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/setup`));
    expect(router.state.location.searchStr).toBe(`?project=${created.id}`);
    expect(projectRow(created.id).setupStep).toBe('setup');
    const agent = mockDb.state.agents.find((a) => a.projectId === created.id);
    expect(agent?.credential).toMatchObject({ set: true, type: 'oauth_token' });
    expect(cacheText(queryClient)).not.toContain(TOKEN);
    expect(JSON.stringify(mockDb.snapshot())).not.toContain(TOKEN);
    expect(log.mock.calls.flat().map(String).join(' ')).not.toContain(TOKEN);

    // Step setup: skipped, nothing saved, the project moves on to skills.
    await user.click(await screen.findByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/skills`));
    expect(mockDb.state.setupScripts[created.id]).toBeUndefined();
    expect(projectRow(created.id).setupStep).toBe('skills');

    // Step skills: both templates are committed.
    await user.click(await screen.findByRole('button', { name: 'Commit 2 skills and continue' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/rules`));
    expect((mockDb.state.skills[created.id] ?? []).map((s) => s.name)).toEqual(['code-build', 'code-review']);
    expect(projectRow(created.id).setupStep).toBe('rules');

    // Step rules: the first rule and the follow-up rule.
    await user.click(await screen.findByRole('button', { name: 'Save rules and finish' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/ready`));
    const rules = mockDb.state.rules.filter((r) => r.projectId === created.id);
    expect(rules.map((r) => [r.command, r.kind, r.target, r.skillName])).toEqual([
      ['code-build', 'skill', 'issue', 'code-build'],
      ['code-review', 'skill', 'pr', 'code-review'],
    ]);
    expect(projectRow(created.id).setupStep).toBe('ready');

    // Ready reads the project.
    expect(await screen.findByRole('heading', { name: 'Trigger your first run from GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to runs' })).toHaveAttribute('href', `/o/alice/p/${created.id}/runs`);
    expect(screen.getByText('Polling every 10 min')).toBeInTheDocument();
  });

  it('step 5 with 21 existing rules, code-build the 21st: no duplicate, it finishes, no POST for code-build', async () => {
    const id = seedAt('rules');
    const template = mockDb.state.rules.find((r) => r.projectId === id);
    if (!template) throw new Error('no seeded rule');
    mockDb.state.rules = [
      ...mockDb.state.rules.filter((r) => r.projectId !== id),
      ...Array.from({ length: 21 }, (_, i) => ({
        ...template,
        id: ids.created(700 + i),
        command: i === 20 ? 'code-build' : `rule-${String(i + 1).padStart(2, '0')}`,
      })),
    ];
    const posts: unknown[] = [];
    const listener = ({ request }: { request: Request }) => {
      if (request.method === 'POST' && new URL(request.url).pathname === `/api/projects/${id}/rules`)
        void request
          .clone()
          .json()
          .then((b: unknown) => posts.push(b));
    };
    server.events.on('request:start', listener);
    try {
      const { router, user } = await renderRoute(`${base}/rules?project=${id}`);
      await user.click(await screen.findByRole('button', { name: 'Save rules and finish' }));
      await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/ready`));
    } finally {
      server.events.removeListener('request:start', listener);
    }
    expect(posts).not.toContainEqual(expect.objectContaining({ command: 'code-build' }));
    expect(mockDb.state.rules.filter((r) => r.projectId === id && r.command === 'code-build')).toHaveLength(1);
  });

  it('BR-72: the rules step guards link Change to the Limits tab and Runs, Ignored to the Ignored filter', async () => {
    const id = seedAt('rules');
    await renderRoute(`${base}/rules?project=${id}`);
    expect(await screen.findByRole('link', { name: 'Change' })).toHaveAttribute(
      'href',
      `/o/alice/p/${id}/desk/agent?tab=limits`,
    );
    expect(screen.getByRole('link', { name: 'Runs, Ignored' })).toHaveAttribute(
      'href',
      `/o/alice/p/${id}/runs?filter=ignored`,
    );
  });

  it('skipping the first rule creates no rule, marks setup ready and opens the Ready step', async () => {
    const id = seedAt('rules');
    mockDb.state.rules = mockDb.state.rules.filter((r) => r.projectId !== id);
    const { router, user } = await renderRoute(`${base}/rules?project=${id}`);
    await user.click(await screen.findByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/ready`));
    expect(projectRow(id).setupStep).toBe('ready');
    expect(mockDb.state.rules.filter((r) => r.projectId === id)).toHaveLength(0);
  });

  it('a failed Skip on the first rule step shows the error and stays on the step', async () => {
    const id = seedAt('rules');
    server.use(
      routeHandler('projects.update', async () =>
        problemResponse({ status: 500, title: 'Internal server error', type: 'internal' }),
      ),
    );
    const { router, user } = await renderRoute(`${base}/rules?project=${id}`);
    await user.click(await screen.findByRole('button', { name: 'Skip' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`${base}/rules`);
    expect(projectRow(id).setupStep).toBe('rules');
  });

  it('skipping steps 3, 4 and 5 in a row reaches Ready with no script, skills or rule', async () => {
    const id = seedAt('setup');
    mockDb.state.rules = mockDb.state.rules.filter((r) => r.projectId !== id);
    mockDb.state.skills[id] = [];
    const { router, user } = await renderRoute(`${base}/setup?project=${id}`);
    await user.click(await screen.findByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/skills`));
    await user.click(await screen.findByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/rules`));
    await user.click(await screen.findByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/ready`));
    expect(projectRow(id).setupStep).toBe('ready');
    expect(await screen.findByText('No rule yet')).toBeInTheDocument();
    expect(screen.queryByText('/code-build', { selector: 'pre' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Add a rule' })).toHaveAttribute('href', `/o/alice/p/${id}/desk/rules`);
  });

  it('the first rule can be a custom prompt and saves with kind prompt', async () => {
    const id = seedAt('rules');
    const { router, user } = await renderRoute(`${base}/rules?project=${id}`);
    await user.click(await screen.findByRole('radio', { name: 'Custom prompt' }));
    expect(screen.getByText("Added by Agent Desk (can't be edited)")).toBeInTheDocument();
    // The seeded project already has /code-build, and the step skips commands that exist.
    await user.clear(screen.getByLabelText('Command'));
    await user.type(screen.getByLabelText('Command'), 'summarize');
    await user.type(screen.getByLabelText('Prompt'), 'Triage this issue.');
    await user.click(screen.getByRole('button', { name: 'Save rules and finish' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/ready`));
    const rules = mockDb.state.rules.filter((r) => r.projectId === id && r.command === 'summarize');
    expect(rules.map((r) => [r.command, r.kind, r.prompt])).toEqual([['summarize', 'prompt', 'Triage this issue.']]);
  });

  it('a reload of a later step resumes at the step the server has', async () => {
    const id = seedAt('skills');
    const { router } = await renderRoute(`${base}/rules?project=${id}`);
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/skills`));
    expect(router.state.location.search).toEqual({ project: id });
    expect(await screen.findByRole('heading', { name: 'Start from skill templates' })).toBeInTheDocument();
  });

  it('a reload of a later step lands on setup for a project at that step', async () => {
    const id = seedAt('setup');
    const { router } = await renderRoute(`${base}/ready?project=${id}`);
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/setup`));
    expect(router.state.location.search).toEqual({ project: id });
    expect(await screen.findByRole('heading', { name: 'Prepare the workspace' })).toBeInTheDocument();
  });

  it('the setup step shows the five-step stepper', async () => {
    const id = seedAt('setup');
    await renderRoute(`${base}/setup?project=${id}`);
    await screen.findByRole('heading', { name: 'Prepare the workspace' });
    const steps = [...document.querySelectorAll('ol > li')].map((li) => li.textContent ?? '');
    expect(steps).toHaveLength(5);
    expect(steps[2]).toContain('Prepare workspace');
    expect(document.querySelector('[aria-current="step"]')).toHaveTextContent('Prepare workspace');
    expect(screen.getByText('Step 3 of 5, optional')).toBeInTheDocument();
  });

  it('Skip on setup goes to skills without saving a script', async () => {
    const id = seedAt('setup');
    const { router, user } = await renderRoute(`${base}/setup?project=${id}`);
    await user.click(await screen.findByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/skills`));
    expect(mockDb.requests('PUT', `/api/projects/${id}/setup-script`)).toBe(0);
    expect(projectRow(id).setupStep).toBe('skills');
  });

  it('Save and continue on setup stores the script as version 1 and moves on', async () => {
    const id = ids.project.docsSite;
    projectRow(id).setupStep = 'setup';
    const { router, user } = await renderRoute(`${base}/setup?project=${id}`);
    await user.click(await screen.findByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/skills`));
    expect(mockDb.state.setupScripts[id]).toHaveLength(1);
    expect(mockDb.state.setupScripts[id]?.[0]?.version).toBe(1);
    expect(projectRow(id).setupStep).toBe('skills');
  });

  it('Test setup starts a test with the editor text from the step', async () => {
    const id = seedAt('setup');
    const { user } = await renderRoute(`${base}/setup?project=${id}`);
    await user.click(await screen.findByRole('button', { name: 'Test setup' }));
    await waitFor(() => expect(mockDb.state.setupTests).toHaveLength(1));
    expect(await screen.findByText('Testing in a throwaway workspace')).toBeInTheDocument();
  });

  it('an earlier step stays open for a project further along', async () => {
    const id = seedAt('rules');
    const { router } = await renderRoute(`${base}/agent?project=${id}`);
    expect(router.state.location.pathname).toBe(`${base}/agent`);
    expect(await screen.findByRole('heading', { name: 'Add your agent' })).toBeInTheDocument();
  });

  it('a later step without a project goes back to the repo step', async () => {
    const { router } = await renderRoute(`${base}/skills`);
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/repo`));
  });

  it('an unknown step is not found', async () => {
    await renderRoute(`${base}/nope`);
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });

  it('a credential rejected with pointer /value shows on the token field and the step stays', async () => {
    const id = seedAt('agent');
    scenarios.problem('agents.putCredential', {
      status: 400,
      title: 'Validation failed',
      type: 'validation',
      errors: [{ pointer: '/value', detail: 'The token was rejected by Claude.' }],
    });
    const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
    const token = await tokenBox(user);
    await user.type(token, TOKEN);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(token).toHaveAccessibleDescription(/The token was rejected by Claude\./));
    expect(token).toHaveAttribute('aria-invalid', 'true');
    expect(router.state.location.pathname).toBe(`${base}/agent`);
    expect(projectRow(id).setupStep).toBe('agent');
  });

  it('skipping skills saves the step and moves on to rules', async () => {
    const id = seedAt('skills');
    const { router, user } = await renderRoute(`${base}/skills?project=${id}`);
    await user.click(await screen.findByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/rules`));
    expect(projectRow(id).setupStep).toBe('rules');
  });

  it('BR-74: Preview opens that template SKILL.md in a dialog, leaves the picks alone, makes no request and Close returns focus', async () => {
    const id = seedAt('skills');
    const { user } = await renderRoute(`${base}/skills?project=${id}`);
    const preview = await screen.findByRole('button', { name: 'Preview code-review' });
    const tick = (name: string) => screen.getByRole('checkbox', { name: new RegExp('^' + name) });
    const before = [tick('code-build'), tick('code-review')].map((c) => (c as HTMLInputElement).checked);
    const seen: string[] = [];
    const listener = ({ request }: { request: Request }) => void seen.push(request.url);
    server.events.on('request:start', listener);
    try {
      await user.click(preview);
      const dialog = await screen.findByRole('dialog', { name: 'code-review SKILL.md' });
      expect(await within(dialog).findByRole('heading', { name: /Review a pull request/i })).toBeInTheDocument();
      expect(within(dialog).queryByText(/Build an issue/)).not.toBeInTheDocument();
      expect(seen).toEqual([]);
      await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    } finally {
      server.events.removeListener('request:start', listener);
    }
    expect(screen.queryByRole('dialog', { name: 'code-review SKILL.md' })).not.toBeInTheDocument();
    expect([tick('code-build'), tick('code-review')].map((c) => (c as HTMLInputElement).checked)).toEqual(before);
    expect(preview).toHaveFocus();
  });

  it('with no connection, Connect asks the API for the install page and goes there', async () => {
    mockDb.state.connections = mockDb.state.connections.filter((c) => c.orgId !== ids.org.alice);
    const { tab } = stubTab();
    const { user } = await renderRoute(`${base}/repo`);
    await user.click(await screen.findByRole('button', { name: 'Connect GitHub' }));
    await waitFor(() => expect(tab.location.href).toBe(INSTALL_URL));
    expect(mockDb.requests('POST', '/api/connections/github/install')).toBe(1);
  });
});

/** A setup test of the seeded project, finished with `status`. */
function seedTest(projectId: string, status: 'passed' | 'failed', matchesCurrentScript: boolean): void {
  mockDb.state.setupTests.push({
    id: ids.created(900),
    projectId,
    status,
    scriptSha256: 'a'.repeat(64),
    matchesCurrentScript,
    checkoutSha: 'a91c3e2' + '0'.repeat(33),
    plugins: { installed: [], skipped: [], failed: [] },
    exitCode: status === 'failed' ? 1 : null,
    startedBy: 'kim-hale',
    createdAt: '2026-11-12T09:00:00.000Z',
    finishedAt: '2026-11-12T09:01:00.000Z',
    endedAt: '2026-11-12T09:20:00.000Z',
  });
}

describe('setup warnings on the Ready step', () => {
  const warning = (title: RegExp) =>
    screen.findByRole('heading', { name: title }).catch(() => screen.findByText(title));

  it('warns when the latest test failed and Go to runs stays enabled', async () => {
    const id = ids.project.invoicerApi;
    projectRow(id).setupStep = 'ready';
    seedTest(id, 'failed', true);
    await renderRoute(`${base}/ready?project=${id}`);
    expect(await warning(/last workspace setup test failed/)).toBeInTheDocument();
    const go = screen.getByRole('link', { name: 'Go to runs' });
    expect(go).toHaveAttribute('href', `/o/alice/p/${id}/runs`);
    expect(go).not.toHaveAttribute('aria-disabled');
  });

  it('warns when the script changed since the last passing test', async () => {
    const id = ids.project.invoicerApi;
    projectRow(id).setupStep = 'ready';
    seedTest(id, 'passed', false);
    await renderRoute(`${base}/ready?project=${id}`);
    expect(await warning(/changed since the last passing test/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to runs' })).toBeInTheDocument();
  });

  it('warns about a saved script that was never tested', async () => {
    const id = ids.project.invoicerApi;
    projectRow(id).setupStep = 'ready';
    await renderRoute(`${base}/ready?project=${id}`);
    expect(await warning(/has not passed a test yet/)).toBeInTheDocument();
  });

  it('does not warn when the latest test passed on the saved script', async () => {
    const id = ids.project.invoicerApi;
    projectRow(id).setupStep = 'ready';
    seedTest(id, 'passed', true);
    await renderRoute(`${base}/ready?project=${id}`);
    await screen.findByRole('heading', { name: 'Trigger your first run from GitHub' });
    await waitFor(() => expect(mockDb.requests('GET', `/api/projects/${id}/setup-tests/latest`)).toBeGreaterThan(0));
    expect(
      screen.queryByText(/workspace setup test failed|changed since the last passing|has not passed a test/),
    ).toBeNull();
  });

  it('does not warn when the project has no setup script and no test', async () => {
    const id = ids.project.docsSite;
    projectRow(id).setupStep = 'ready';
    await renderRoute(`${base}/ready?project=${id}`);
    await screen.findByRole('heading', { name: 'Add a rule to trigger runs' });
    await waitFor(() => expect(mockDb.requests('GET', `/api/projects/${id}/setup-script`)).toBeGreaterThan(0));
    expect(
      screen.queryByText(/workspace setup test failed|changed since the last passing|has not passed a test/),
    ).toBeNull();
  });
});

describe('setup flow fixes', () => {
  it('Back from agent after creating the project updates it instead of creating it again', async () => {
    const { router, user } = await renderRoute(`${base}/repo`);
    await user.click(await screen.findByRole('radio', { name: 'dev/demo' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/agent`));
    const created = mockDb.state.projects.find((p) => p.repoPath === 'dev/demo');
    if (!created) throw new Error('project not created');
    // The repo entry was replaced (not pushed), so no history entry is left without the project.
    expect(router.history.length).toBe(2);

    router.history.back();
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/repo`));
    expect(router.state.location.search).toEqual({ project: created.id });
    await screen.findByRole('radio', { name: 'dev/demo' });
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/agent`));
    expect(router.state.location.search).toEqual({ project: created.id });
    expect(mockDb.requests('POST', '/api/projects')).toBe(1);
    expect(mockDb.requests('PATCH', `/api/projects/${created.id}`)).toBe(1);
    expect(mockDb.state.projects.filter((p) => p.repoPath === 'dev/demo')).toHaveLength(1);
    expect(screen.queryByText(/already/)).toBeNull();
  });

  it('Connect links an installation the provider already has, lists its repos and never opens the install page', async () => {
    const alreadyInstalled = mockDb.state.connections.filter((c) => c.orgId === ids.org.alice);
    mockDb.state.connections = mockDb.state.connections.filter((c) => c.orgId !== ids.org.alice);
    server.use(
      routeHandler('connections.sync', async () => {
        mockDb.state.connections.push(...alreadyInstalled);
        return jsonResponse(alreadyInstalled, 201);
      }),
    );
    const { tab } = stubTab();
    const { user } = await renderRoute(`${base}/repo`);
    await user.click(await screen.findByRole('button', { name: 'Connect GitHub' }));
    expect(await screen.findByRole('radio', { name: 'harbor-labs/invoicer-api' })).toBeInTheDocument();
    expect(tab.location.href).toBe('');
    expect(tab.close).toHaveBeenCalledTimes(1);
    expect(mockDb.requests('POST', '/api/connections/github/install')).toBe(0);
  });

  it('Connect links an installation the provider re-activates even though the org already had it as revoked', async () => {
    for (const c of mockDb.state.connections) if (c.orgId === ids.org.alice) c.status = 'revoked';
    server.use(
      routeHandler('connections.sync', async () => {
        const mine = mockDb.state.connections.filter((c) => c.orgId === ids.org.alice);
        for (const c of mine) c.status = 'active';
        return jsonResponse(mine, 201);
      }),
    );
    const { tab } = stubTab();
    const { user } = await renderRoute(`${base}/repo`);
    await user.click(await screen.findByRole('button', { name: 'Connect GitHub' }));
    expect(await screen.findByRole('radio', { name: 'harbor-labs/invoicer-api' })).toBeInTheDocument();
    expect(tab.location.href).toBe('');
    expect(tab.close).toHaveBeenCalledTimes(1);
    expect(mockDb.requests('POST', '/api/connections/github/install')).toBe(0);
  });

  it('Change which repositories the app can access links the installation of the picked repo and never starts the install flow', async () => {
    const { open } = stubTab();
    const { user } = await renderRoute(`${base}/repo`);
    const link = await screen.findByRole('link', { name: 'Change which repositories the app can access' });
    expect(link).toHaveAttribute('href', 'https://github.com/organizations/harbor-labs/settings/installations/1001');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await user.click(await screen.findByRole('radio', { name: 'kim-hale/docs-site' }));
    expect(screen.getByRole('link', { name: 'Change which repositories the app can access' })).toHaveAttribute(
      'href',
      'https://github.com/settings/installations/1002',
    );
    expect(open).not.toHaveBeenCalled();
    expect(mockDb.requests('POST', '/api/connections/github/install')).toBe(0);
  });

  it('Connect still opens the install page when linking what the account can see fails', async () => {
    mockDb.state.connections = mockDb.state.connections.filter((c) => c.orgId !== ids.org.alice);
    server.use(routeHandler('connections.sync', async () => jsonResponse({ title: 'boom' }, 500)));
    const { tab } = stubTab();
    const { user } = await renderRoute(`${base}/repo`);
    await user.click(await screen.findByRole('button', { name: 'Connect GitHub' }));
    await waitFor(() => expect(tab.location.href).toBe(INSTALL_URL));
    expect(mockDb.requests('POST', '/api/connections/github/install')).toBe(1);
  });

  it('opening GitHub keeps the setup step in this tab: a blank tab opens on the click, then goes to the install page', async () => {
    mockDb.state.connections = mockDb.state.connections.filter((c) => c.orgId !== ids.org.alice);
    const same = vi.spyOn(browserLocation, 'assign').mockImplementation(() => undefined);
    const { tab, open } = stubTab();
    const { user } = await renderRoute(`${base}/repo`);
    await user.click(await screen.findByRole('button', { name: 'Connect GitHub' }));
    await waitFor(() => expect(tab.location.href).toBe(INSTALL_URL));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(tab.opener).toBeNull();
    expect(tab.close).not.toHaveBeenCalled();
    expect(same).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Connect a repository' })).toBeInTheDocument();
  });

  it('the new tab opens in the click itself, before the install request has answered', async () => {
    mockDb.state.connections = mockDb.state.connections.filter((c) => c.orgId !== ids.org.alice);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      routeHandler('connections.install', async () => {
        await gate;
        return jsonResponse({ url: INSTALL_URL });
      }),
    );
    const { tab, open } = stubTab();
    const { user } = await renderRoute(`${base}/repo`);
    await user.click(await screen.findByRole('button', { name: 'Connect GitHub' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(tab.location.href).toBe('');
    release();
    await waitFor(() => expect(tab.location.href).toBe(INSTALL_URL));
  });

  it('the new tab is closed and the error shows when the install request fails', async () => {
    mockDb.state.connections = mockDb.state.connections.filter((c) => c.orgId !== ids.org.alice);
    server.use(routeHandler('connections.install', async () => jsonResponse({ title: 'GitHub is down' }, 502)));
    const { tab } = stubTab();
    const same = vi.spyOn(browserLocation, 'assign').mockImplementation(() => undefined);
    const { user } = await renderRoute(`${base}/repo`);
    await user.click(await screen.findByRole('button', { name: 'Connect GitHub' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(tab.close).toHaveBeenCalledTimes(1);
    expect(tab.location.href).toBe('');
    expect(same).not.toHaveBeenCalled();
  });

  it('a blocked new tab falls back to this tab', async () => {
    mockDb.state.connections = mockDb.state.connections.filter((c) => c.orgId !== ids.org.alice);
    const same = vi.spyOn(browserLocation, 'assign').mockImplementation(() => undefined);
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { user } = await renderRoute(`${base}/repo`);
    await user.click(await screen.findByRole('button', { name: 'Connect GitHub' }));
    await waitFor(() => expect(same).toHaveBeenCalledWith(INSTALL_URL));
  });

  it('Refresh repositories lists a repository added on GitHub after the page loaded', async () => {
    const { user } = await renderRoute(`${base}/repo`);
    await screen.findByRole('radio', { name: 'harbor-labs/invoicer-api' });
    mockDb.state.repos[ids.connection.harbor]?.push({
      repoPath: 'harbor-labs/new-repo',
      private: true,
      defaultBranch: 'main',
    });
    expect(screen.queryByRole('radio', { name: 'harbor-labs/new-repo' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh repositories' }));
    expect(await screen.findByRole('radio', { name: 'harbor-labs/new-repo' })).toBeInTheDocument();
  });

  it('Refresh repositories links an installation another org already has, then lists its repositories', async () => {
    // Org alice has no connection yet; the same GitHub installation is linked in org acme.
    const acme = mockDb.state.connections.find((c) => c.orgId === ids.org.acme);
    if (!acme) throw new Error('acme connection missing from the mock store');
    mockDb.state.connections = mockDb.state.connections.filter((c) => c.orgId !== ids.org.alice);
    server.use(
      routeHandler('connections.sync', async () => {
        const linked = { ...acme, id: ids.created(700), orgId: ids.org.alice };
        mockDb.state.connections.push(linked);
        mockDb.state.repos[linked.id] = [{ repoPath: 'acme-co/storefront', private: true, defaultBranch: 'main' }];
        return jsonResponse([linked], 201);
      }),
    );
    const { user } = await renderRoute(`${base}/repo`);
    expect(await screen.findByText('No repositories yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh repositories' }));
    expect(await screen.findByRole('radio', { name: 'acme-co/storefront' })).toBeInTheDocument();
    expect(screen.queryByText('No repositories yet')).not.toBeInTheDocument();
    expect(mockDb.requests('POST', '/api/connections/github/sync')).toBe(1);
  });

  it('Refresh repositories that finds nothing keeps the empty state with install guidance and Connect GitHub', async () => {
    mockDb.state.connections = mockDb.state.connections.filter((c) => c.orgId !== ids.org.alice);
    server.use(routeHandler('connections.sync', async () => jsonResponse([], 201)));
    const { user } = await renderRoute(`${base}/repo`);
    await screen.findByText('No repositories yet');
    await user.click(screen.getByRole('button', { name: 'Refresh repositories' }));
    expect(await screen.findByRole('button', { name: 'Refresh repositories' })).toBeEnabled();
    expect(mockDb.requests('POST', '/api/connections/github/sync')).toBe(1);
    expect(screen.getByText('No repositories yet')).toBeInTheDocument();
    expect(screen.getByText(/Install the Agent Desk GitHub App/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect GitHub' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Refresh repositories sends one sync however often it is pressed while it runs', async () => {
    const { user } = await renderRoute(`${base}/repo`);
    await screen.findByRole('radio', { name: 'harbor-labs/invoicer-api' });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      routeHandler('connections.sync', async () => {
        await gate;
        return jsonResponse(
          mockDb.state.connections.filter((c) => c.orgId === ids.org.alice),
          201,
        );
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Refresh repositories' }));
    const busy = await screen.findByRole('button', { name: 'Refreshing repositories' });
    expect(busy).toBeDisabled();
    await user.click(busy);
    release();
    expect(await screen.findByRole('button', { name: 'Refresh repositories' })).toBeEnabled();
    expect(mockDb.requests('POST', '/api/connections/github/sync')).toBe(1);
  });

  it('Refresh repositories reports a failed sync and does not turn it into an empty list', async () => {
    mockDb.state.connections = mockDb.state.connections.filter((c) => c.orgId !== ids.org.alice);
    server.use(routeHandler('connections.sync', async () => jsonResponse({ title: 'GitHub is down' }, 502)));
    const { user } = await renderRoute(`${base}/repo`);
    await screen.findByText('No repositories yet');
    await user.click(screen.getByRole('button', { name: 'Refresh repositories' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh repositories' })).toBeEnabled();
  });

  it('Refresh repositories shows every installation after an install callback narrowed the page to one', async () => {
    const { user } = await renderRoute(`${base}/repo?connection=${ids.connection.harbor}`);
    await screen.findByRole('radio', { name: 'harbor-labs/invoicer-api' });
    expect(screen.queryByRole('radio', { name: 'kim-hale/docs-site' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh repositories' }));
    expect(await screen.findByRole('radio', { name: 'kim-hale/docs-site' })).toBeInTheDocument();
  });

  it('Refresh repositories is disabled while the list loads again', async () => {
    const { user } = await renderRoute(`${base}/repo`);
    await screen.findByRole('radio', { name: 'harbor-labs/invoicer-api' });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      routeHandler('connections.repos', async () => {
        await gate;
        return jsonResponse([]);
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Refresh repositories' }));
    expect(await screen.findByRole('button', { name: 'Refreshing repositories' })).toBeDisabled();
    release();
    expect(await screen.findByRole('button', { name: 'Refresh repositories' })).toBeEnabled();
  });

  it('Refresh repositories says so when the list cannot be loaded again', async () => {
    const { user } = await renderRoute(`${base}/repo`);
    await screen.findByRole('radio', { name: 'harbor-labs/invoicer-api' });
    server.use(routeHandler('connections.repos', async () => jsonResponse({ title: 'GitHub is down' }, 502)));
    await user.click(screen.getByRole('button', { name: 'Refresh repositories' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh repositories' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'harbor-labs/invoicer-api' })).toBeInTheDocument();
  });

  describe('a GitHub account that must be connected again', () => {
    const reauth = () =>
      routeHandler('connections.sync', async () =>
        problemResponse({
          status: 409,
          title: 'Conflict',
          type: 'provider-reauthorization-required',
          detail: 'Your account at the provider must be connected again.',
        }),
      );

    /** Answers the GitHub sign-in the way better-auth does, without sending jsdom anywhere; records what was asked. */
    function captureSignIn() {
      const asked: unknown[] = [];
      server.use(
        http.post('/auth/sign-in/social', async ({ request }) => {
          asked.push(await request.json());
          return HttpResponse.json({ url: '/', redirect: false });
        }),
      );
      return asked;
    }

    it('Refresh repositories offers Reconnect GitHub, which signs in with GitHub again and returns to this step', async () => {
      server.use(reauth());
      const asked = captureSignIn();
      const { user } = await renderRoute(`${base}/repo`);
      await screen.findByRole('radio', { name: 'harbor-labs/invoicer-api' });
      await user.click(screen.getByRole('button', { name: 'Refresh repositories' }));
      const reconnect = await screen.findByRole('button', { name: 'Reconnect GitHub' });
      expect(screen.getByText(/sign in with GitHub again/i)).toBeInTheDocument();
      // The list the page already had stays, and no toast says "Conflict".
      expect(screen.getByRole('radio', { name: 'harbor-labs/invoicer-api' })).toBeInTheDocument();
      expect(screen.queryByText('Conflict')).not.toBeInTheDocument();
      await user.click(reconnect);
      await waitFor(() => expect(asked).toHaveLength(1));
      expect(asked[0]).toMatchObject({
        provider: 'github',
        callbackURL: `${base}/repo`,
        errorCallbackURL: `${base}/repo`,
      });
    });

    it('the reconnect return keeps the search of the step (the project being edited)', async () => {
      server.use(reauth());
      const asked = captureSignIn();
      const { user } = await renderRoute(`${base}/repo?connection=${ids.connection.harbor}`);
      await screen.findByRole('radio', { name: 'harbor-labs/invoicer-api' });
      await user.click(screen.getByRole('button', { name: 'Refresh repositories' }));
      await user.click(await screen.findByRole('button', { name: 'Reconnect GitHub' }));
      await waitFor(() => expect(asked).toHaveLength(1));
      expect(asked[0]).toMatchObject({ callbackURL: `${base}/repo?connection=${ids.connection.harbor}` });
    });

    it('a later successful refresh takes the Reconnect GitHub banner away', async () => {
      server.use(reauth());
      const { user } = await renderRoute(`${base}/repo`);
      await screen.findByRole('radio', { name: 'harbor-labs/invoicer-api' });
      await user.click(screen.getByRole('button', { name: 'Refresh repositories' }));
      await screen.findByRole('button', { name: 'Reconnect GitHub' });
      server.resetHandlers();
      await user.click(screen.getByRole('button', { name: 'Refresh repositories' }));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Reconnect GitHub' })).not.toBeInTheDocument());
    });

    it('Connect GitHub does not hide it behind the install page', async () => {
      mockDb.state.connections = mockDb.state.connections.filter((c) => c.orgId !== ids.org.alice);
      server.use(reauth());
      const { tab } = stubTab();
      const same = vi.spyOn(browserLocation, 'assign').mockImplementation(() => undefined);
      const { user } = await renderRoute(`${base}/repo`);
      await user.click(await screen.findByRole('button', { name: 'Connect GitHub' }));
      expect(await screen.findByRole('button', { name: 'Reconnect GitHub' })).toBeInTheDocument();
      expect(mockDb.requests('POST', '/api/connections/github/install')).toBe(0);
      expect(tab.close).toHaveBeenCalledTimes(1);
      expect(tab.location.href).toBe('');
      expect(same).not.toHaveBeenCalled();
    });

    it('Connect GitHub still falls back to the install page when the lookup fails for another reason', async () => {
      mockDb.state.connections = mockDb.state.connections.filter((c) => c.orgId !== ids.org.alice);
      server.use(routeHandler('connections.sync', async () => jsonResponse({ title: 'GitHub is down' }, 502)));
      const { tab } = stubTab();
      const { user } = await renderRoute(`${base}/repo`);
      await user.click(await screen.findByRole('button', { name: 'Connect GitHub' }));
      await waitFor(() => expect(tab.location.href).toBe(INSTALL_URL));
      expect(screen.queryByRole('button', { name: 'Reconnect GitHub' })).not.toBeInTheDocument();
    });

    it('GitHub being unavailable is a retry-later toast, not a reconnect', async () => {
      server.use(
        routeHandler('connections.sync', async () =>
          problemResponse({
            status: 503,
            title: 'Service Unavailable',
            type: 'provider-unavailable',
            detail: 'The provider is not available right now. Try again later.',
          }),
        ),
      );
      const { user } = await renderRoute(`${base}/repo`);
      await screen.findByRole('radio', { name: 'harbor-labs/invoicer-api' });
      await user.click(screen.getByRole('button', { name: 'Refresh repositories' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Try again later');
      expect(screen.queryByRole('button', { name: 'Reconnect GitHub' })).not.toBeInTheDocument();
    });

    it('a failed Reconnect GitHub says so and can be tried again', async () => {
      server.use(reauth());
      server.use(
        http.post('/auth/sign-in/social', () =>
          HttpResponse.json({ code: 'PROVIDER_ERROR', message: 'GitHub is unavailable' }, { status: 500 }),
        ),
      );
      const { user } = await renderRoute(`${base}/repo`);
      await screen.findByRole('radio', { name: 'harbor-labs/invoicer-api' });
      await user.click(screen.getByRole('button', { name: 'Refresh repositories' }));
      await user.click(await screen.findByRole('button', { name: 'Reconnect GitHub' }));
      expect(await screen.findByText('GitHub is unavailable')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reconnect GitHub' })).toBeEnabled();
    });
  });

  it('coming back to the tab refreshes the repository list on its own', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] });
    try {
      await renderRoute(`${base}/repo`);
      await screen.findByRole('radio', { name: 'harbor-labs/invoicer-api' });
      mockDb.state.repos[ids.connection.harbor]?.push({
        repoPath: 'harbor-labs/new-repo',
        private: true,
        defaultBranch: 'main',
      });
      // The cached list is past its 30 s stale time when the tab comes back.
      vi.setSystemTime(Date.now() + 60_000);
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      expect(await screen.findByRole('radio', { name: 'harbor-labs/new-repo' })).toBeInTheDocument();
    } finally {
      focusManager.setFocused(undefined);
      vi.useRealTimers();
    }
  });

  it('an install URL that is not https is not followed and an error shows', async () => {
    mockDb.state.connections = mockDb.state.connections.filter((c) => c.orgId !== ids.org.alice);
    server.use(routeHandler('connections.install', async () => jsonResponse({ url: 'javascript:alert(1)' })));
    const { tab } = stubTab();
    const same = vi.spyOn(browserLocation, 'assign').mockImplementation(() => undefined);
    const { user } = await renderRoute(`${base}/repo`);
    await user.click(await screen.findByRole('button', { name: 'Connect GitHub' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not a valid https address');
    expect(tab.location.href).toBe('');
    expect(tab.close).toHaveBeenCalledTimes(1);
    expect(same).not.toHaveBeenCalled();
  });
});

/** The agents list answers 500 once the credential write has been answered: the step's refetch fails. */
function failAgentListAfterCredentialWrite() {
  let armed = false;
  const arm = ({ request }: { request: Request }) => {
    if (request.method === 'PUT' && new URL(request.url).pathname.endsWith('/credential')) armed = true;
  };
  server.events.on('response:mocked', arm);
  stopListening = () => server.events.removeListener('response:mocked', arm);
  server.use(
    http.get('*/api/projects/*/agents', () =>
      armed ? problemResponse({ status: 500, title: 'Internal server error', type: 'internal' }) : undefined,
    ),
  );
}

describe('setup agent step and step 4 model wiring', () => {
  const agentId = ids.agent.invoicerApi;
  const credentialPath = `/api/agents/${agentId}/credential`;
  const agentRow = () => {
    const row = mockDb.state.agents.find((a) => a.id === agentId);
    if (!row) throw new Error('agent not in the mock store');
    return row;
  };
  const modelSelect = (name: string) => screen.getByRole('combobox', { name });
  const optionsOf = (name: string) =>
    Array.from(modelSelect(name).querySelectorAll('option')).map((o) => o.textContent);

  /** Records the writes (pathname, JSON body) the app sends, in order. */
  function captureWrites() {
    const sent: { path: string; body: unknown }[] = [];
    const listener = ({ request }: { request: Request }) => {
      if (request.method === 'GET') return;
      const entry = { path: new URL(request.url).pathname, body: undefined as unknown };
      sent.push(entry);
      void request
        .clone()
        .text()
        .then((t) => {
          entry.body = t === '' ? undefined : (JSON.parse(t) as unknown);
        });
    };
    server.events.on('request:start', listener);
    return { sent, stop: () => server.events.removeListener('request:start', listener) };
  }

  it('Agent step lists the agent models with Other model… last', async () => {
    const id = seedAt('agent');
    await renderRoute(`${base}/agent?project=${id}`);
    await waitFor(() => expect(optionsOf('Default model')).toContain('claude-sonnet-4-5-20250929'));
    expect(optionsOf('Default model').at(-1)).toBe('Other model…');
  });

  it('changing the address with a saved credential and no token shows "Paste the token again to change the API address." and stays', async () => {
    const id = seedAt('agent');
    const { sent, stop } = captureWrites();
    const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
    const address = await addressBox(user);
    await user.type(address, 'https://gw.example.com/anthropic');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Paste the token again to change the API address.')).toBeInTheDocument();
    expect(address).toHaveAttribute('aria-invalid', 'true');
    stop();
    expect(sent).toEqual([]);
    expect(router.state.location.pathname).toBe(`${base}/agent`);
  });

  it('address plus token saves both', async () => {
    const id = seedAt('agent');
    const { sent, stop } = captureWrites();
    const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
    await user.type(await addressBox(user), ' https://gw.example.com/anthropic ');
    await user.type(token(), TOKEN);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/setup`));
    stop();
    expect(sent.find((s) => s.path === credentialPath)?.body).toEqual({
      type: 'oauth_token',
      value: TOKEN,
      baseUrl: 'https://gw.example.com/anthropic',
    });
    expect(agentRow().baseUrl).toBe('https://gw.example.com/anthropic');
  });

  it('unchanged address and no token continues without a credential call', async () => {
    const id = seedAt('agent');
    const { sent, stop } = captureWrites();
    const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
    await addressBox(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/setup`));
    stop();
    expect(sent.some((s) => s.path === credentialPath)).toBe(false);
  });

  it('a token without an address change sends no baseUrl', async () => {
    const id = seedAt('agent');
    const { sent, stop } = captureWrites();
    const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
    await user.type(await tokenBox(user), TOKEN);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/setup`));
    stop();
    expect(sent.find((s) => s.path === credentialPath)?.body).toEqual({ type: 'oauth_token', value: TOKEN });
  });

  it('clearing a saved address with a token sends baseUrl null', async () => {
    const id = seedAt('agent');
    agentRow().baseUrl = 'https://gw.example.com';
    const { sent, stop } = captureWrites();
    const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
    await user.clear(await addressBox(user));
    await user.type(token(), TOKEN);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/setup`));
    stop();
    expect(sent.find((s) => s.path === credentialPath)?.body).toEqual({
      type: 'oauth_token',
      value: TOKEN,
      baseUrl: null,
    });
    expect(agentRow().baseUrl).toBeNull();
  });

  it('a refused address shows on the address field, the agent and model list are refetched', async () => {
    const id = seedAt('agent');
    scenarios.problem('agents.putCredential', {
      status: 400,
      title: 'Validation failed',
      type: 'validation',
      errors: [{ pointer: '/baseUrl', detail: 'Use a public https address.' }],
    });
    const modelsPath = `/api/agents/${agentId}/models`;
    const agentGetPath = `/api/projects/${id}/agents`;
    const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
    await user.type(await addressBox(user), 'https://10.0.0.1');
    await user.type(token(), TOKEN);
    const before = mockDb.requests('GET', modelsPath);
    const agentBefore = mockDb.requests('GET', agentGetPath);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Use a public https address.')).toBeInTheDocument();
    await waitFor(() => expect(mockDb.requests('GET', modelsPath)).toBeGreaterThan(before));
    await waitFor(() => expect(mockDb.requests('GET', agentGetPath)).toBeGreaterThan(agentBefore));
    expect(router.state.location.pathname).toBe(`${base}/agent`);
  });

  it('a failed refetch after the credential save says so and the step stays', async () => {
    const id = seedAt('agent');
    const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
    await user.type(await tokenBox(user), TOKEN);
    failAgentListAfterCredentialWrite();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      await screen.findByText('Could not refresh the agent. Reload the page to see its current state.'),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`${base}/agent`);
  });

  it('a refused credential write plus a failed refetch shows the field error and the refresh error', async () => {
    const id = seedAt('agent');
    scenarios.problem('agents.putCredential', {
      status: 400,
      title: 'Validation failed',
      type: 'validation',
      errors: [{ pointer: '/value', detail: 'The token was rejected by Claude.' }],
    });
    const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
    const token = await tokenBox(user);
    await user.type(token, TOKEN);
    failAgentListAfterCredentialWrite();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(token).toHaveAccessibleDescription(/The token was rejected by Claude\./));
    expect(
      await screen.findByText('Could not refresh the agent. Reload the page to see its current state.'),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`${base}/agent`);
  });

  it('BR-16: an address saved while the credential write was refused leaves the credential not set; a retry with no token stays', async () => {
    const id = seedAt('agent');
    const address = 'https://gw.example.com/anthropic';
    // The server saved the new address, then the credential write failed and left no credential (BR-16).
    server.use(
      routeHandler('agents.putCredential', async () => {
        const row = agentRow();
        row.baseUrl = address;
        row.credential = { set: false, type: null, updatedAt: null, setBy: null };
        return problemResponse({ status: 500, title: 'Internal server error', type: 'internal' });
      }),
    );
    const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
    await user.type(await addressBox(user), address);
    await user.type(token(), TOKEN);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    // The step refetched the agent: it shows the new address and asks for the token again.
    await waitFor(() => expect(screen.queryByText(/Set .* by /)).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe(`${base}/agent`);
    expect(projectRow(id).setupStep).toBe('agent');

    await user.clear(token());
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Paste the token to continue.')).toBeInTheDocument();
    expect(screen.getByLabelText('API address')).toHaveValue(address);
    expect(router.state.location.pathname).toBe(`${base}/agent`);
    expect(projectRow(id).setupStep).toBe('agent');
  });

  it('a typed default model is saved exactly', async () => {
    const id = seedAt('agent');
    const { sent, stop } = captureWrites();
    const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
    await waitFor(() => expect(optionsOf('Default model')).toContain('Other model…'));
    await user.selectOptions(modelSelect('Default model'), 'Other model…');
    const input = screen.getByRole('textbox', { name: 'Model name' });
    await user.clear(input);
    await user.type(input, 'my-gw/model-x:1');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/setup`));
    stop();
    expect(sent.find((s) => s.path === `/api/agents/${agentId}`)?.body).toEqual({ model: 'my-gw/model-x:1' });
    expect(agentRow().model).toBe('my-gw/model-x:1');
  });

  it('step 4 shows the Model field with "Default model is the one picked in step 2." and saves the picked model', async () => {
    const id = seedAt('rules');
    const { router, user } = await renderRoute(`${base}/rules?project=${id}`);
    expect(await screen.findByText('Default model is the one picked in step 2.')).toBeInTheDocument();
    await waitFor(() => expect(optionsOf('Model')).toContain('claude-sonnet-4-5-20250929'));
    await user.clear(screen.getByLabelText('Command'));
    await user.type(screen.getByLabelText('Command'), 'pick-model');
    await user.selectOptions(modelSelect('Model'), 'claude-sonnet-4-5-20250929');
    await user.click(screen.getByRole('button', { name: 'Save rules and finish' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/ready`));
    const rule = mockDb.state.rules.find((r) => r.projectId === id && r.command === 'pick-model');
    expect(rule?.model).toBe('claude-sonnet-4-5-20250929');
  });

  it('step 4 shows the rule on the project default and saves it with no agent (BR-63, BR-64)', async () => {
    const id = seedAt('rules');
    const { router, user } = await renderRoute(`${base}/rules?project=${id}`);
    expect(await screen.findByLabelText('With agent')).toHaveDisplayValue('Project default (Claude)');
    await user.clear(screen.getByLabelText('Command'));
    await user.type(screen.getByLabelText('Command'), 'on-default');
    await user.click(screen.getByRole('button', { name: 'Save rules and finish' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/ready`));
    expect(mockDb.state.rules.find((r) => r.projectId === id && r.command === 'on-default')?.agentId).toBeNull();
  });

  it('step 4 with Default model saves model null', async () => {
    const id = seedAt('rules');
    const { router, user } = await renderRoute(`${base}/rules?project=${id}`);
    await screen.findByText('Default model is the one picked in step 2.');
    await user.clear(screen.getByLabelText('Command'));
    await user.type(screen.getByLabelText('Command'), 'no-model');
    await user.click(screen.getByRole('button', { name: 'Save rules and finish' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/ready`));
    expect(mockDb.state.rules.find((r) => r.projectId === id && r.command === 'no-model')?.model).toBeNull();
  });

  it('step 4 with an empty Other model… shows "Enter a model name." and saves nothing', async () => {
    const id = seedAt('rules');
    const { sent, stop } = captureWrites();
    const { router, user } = await renderRoute(`${base}/rules?project=${id}`);
    await waitFor(() => expect(optionsOf('Model')).toContain('Other model…'));
    await user.selectOptions(modelSelect('Model'), 'Other model…');
    await user.click(screen.getByRole('button', { name: 'Save rules and finish' }));
    expect(await screen.findByText('Enter a model name.')).toBeInTheDocument();
    stop();
    expect(sent).toEqual([]);
    expect(router.state.location.pathname).toBe(`${base}/rules`);
  });

  it('the follow-up rule follows the default model', async () => {
    const id = seedAt('rules');
    const { router, user } = await renderRoute(`${base}/rules?project=${id}`);
    await screen.findByText('Default model is the one picked in step 2.');
    await user.clear(screen.getByLabelText('Command'));
    await user.type(screen.getByLabelText('Command'), 'first-rule');
    await user.click(screen.getByRole('button', { name: 'Save rules and finish' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/ready`));
    const follow = mockDb.state.rules.find((r) => r.projectId === id && r.command === 'code-review');
    expect(follow).toBeDefined();
    expect(follow?.model).toBeNull();
  });
});

describe('skills step on a long skill list', () => {
  it('21 skills sort before code-review and it is already in the repo: committing the templates sends no PUT for it', async () => {
    const id = seedAt('skills');
    const existing = (name: string) => ({
      name,
      description: name,
      path: `.claude/skills/${name}/SKILL.md`,
      lastCommit: { sha: 'a91c3e2', message: 'Add skills', at: '2026-11-10T14:00:00.000Z' },
      body: `body of ${name}`,
      sha: `sha-${name}`,
    });
    mockDb.state.skills[id] = [
      ...Array.from({ length: 21 }, (_, i) => existing(`a-skill-${String(i + 1).padStart(2, '0')}`)),
      existing('code-review'),
    ];
    const putPaths: string[] = [];
    const listener = ({ request }: { request: Request }) => {
      if (request.method === 'PUT') putPaths.push(new URL(request.url).pathname);
    };
    server.events.on('request:start', listener);
    try {
      const { router, user } = await renderRoute(`${base}/skills?project=${id}`);
      await user.click(await screen.findByRole('button', { name: /^Commit \d+ skills? and continue$/ }));
      await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/rules`));
    } finally {
      server.events.removeListener('request:start', listener);
    }
    expect(putPaths.filter((p) => p.endsWith('/skills/code-review'))).toEqual([]);
    expect(putPaths.some((p) => p.endsWith('/skills/code-build'))).toBe(true);
    expect(projectRow(id).setupStep).toBe('rules');
  });
});

describe('wizard Agent step: pick and set up any runnable agent (BR-53, BR-63 to BR-65)', () => {
  const P = ids.project.invoicerApi;
  const projectAgents = () => mockDb.state.agents.filter((a) => a.projectId === P);
  const placeholder = () => {
    const row = mockDb.state.agents.find((a) => a.id === ids.agent.invoicerApi);
    if (!row) throw new Error('agent not in the mock store');
    return row;
  };
  /** The project as `projects.create` leaves it: one default "Claude" with no credential. */
  function seedPlaceholder(step: 'agent' | 'setup' = 'agent') {
    placeholder().credential = { set: false, type: null, updatedAt: null, setBy: null };
    // A project in setup has no rules yet: none points at the placeholder.
    mockDb.state.rules = mockDb.state.rules.filter((r) => r.projectId !== P);
    return seedAt(step);
  }

  /** The requests the page sends (writes only unless `reads`), as "METHOD /path" with ids as :id, and the bodies. */
  function record() {
    const calls: { line: string; method: string; body?: unknown }[] = [];
    const broken: string[] = [];
    const start = ({ request }: { request: Request }) => {
      const path = new URL(request.url).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id');
      const entry: { line: string; method: string; body?: unknown } = {
        line: `${request.method} ${path}`,
        method: request.method,
      };
      calls.push(entry);
      void request
        .clone()
        .text()
        .then((t) => {
          if (t !== '') entry.body = JSON.parse(t) as unknown;
        });
    };
    // After every answered request the project keeps at least one agent and exactly one default.
    const answered = ({ request }: { request: Request }) => {
      if (request.method === 'GET') return;
      const rows = projectAgents();
      if (rows.length < 1 || rows.filter((a) => a.isDefault).length !== 1) {
        broken.push(`${request.method} ${new URL(request.url).pathname}: ${rows.length} agents`);
      }
    };
    server.events.on('request:start', start);
    server.events.on('response:mocked', answered);
    return {
      writes: () => calls.filter((c) => c.method !== 'GET').map((c) => c.line),
      all: () => calls.map((c) => c.line),
      body: (line: string) => calls.find((c) => c.line === line)?.body,
      broken,
      stop: () => {
        server.events.removeListener('request:start', start);
        server.events.removeListener('response:mocked', answered);
      },
    };
  }
  const agentsPath = '/api/projects/:id/agents';
  const swap = [`POST ${agentsPath}`, 'POST /api/agents/:id/default', 'DELETE /api/agents/:id'];
  const finish = 'PATCH /api/projects/:id';
  const putCredential = 'PUT /api/agents/:id/credential';
  const test = 'POST /api/agents/:id/test';

  const authBox = () => screen.getByLabelText('auth.json contents', { selector: 'input[type="password"], textarea' });
  const pick = async (user: User, name: string) => user.click(await screen.findByRole('radio', { name }));
  const next = async (user: User, router: { state: { location: { pathname: string } } }, to = 'setup') => {
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/${to}`));
  };

  const cases = [
    {
      name: 'Claude Code (the placeholder)',
      label: 'Claude Code',
      kind: 'claude',
      fill: async (user: User) => user.type(token(), TOKEN),
      writes: [putCredential, test, finish],
    },
    {
      name: 'Codex',
      label: 'OpenAI Codex',
      kind: 'codex',
      fill: async (user: User) => user.type(authBox(), '{{}"tokens":"x"}'),
      writes: [...swap, putCredential, test, finish],
    },
    {
      name: 'OpenCode with an empty credential',
      label: 'OpenCode',
      kind: 'opencode',
      fill: async () => undefined,
      writes: [...swap, finish],
    },
    {
      name: 'OpenCode with a credentials file',
      label: 'OpenCode',
      kind: 'opencode',
      fill: async (user: User) => {
        await user.click(screen.getByRole('radio', { name: 'Credentials file' }));
        await user.click(screen.getByLabelText('Credentials file', { selector: 'input[type="password"], textarea' }));
        await user.paste('{"a":"b"}');
      },
      writes: [...swap, putCredential, test, finish],
    },
    {
      name: 'OpenCode with an endpoint and key',
      label: 'OpenCode',
      kind: 'opencode',
      fill: async (user: User) => {
        await user.click(screen.getByRole('radio', { name: 'API endpoint and key' }));
        await user.type(screen.getByLabelText('API endpoint'), 'https://llm.example.com/v1');
        await user.type(screen.getByLabelText('API key', { selector: 'input[type="password"]' }), TOKEN);
        await user.selectOptions(screen.getByRole('combobox', { name: 'Default model' }), 'Other model…');
        await user.type(screen.getByRole('textbox', { name: 'Model name' }), 'qwen3-coder');
      },
      writes: [...swap, putCredential, test, finish],
    },
  ];

  it.each(cases)('$name: exact call order, one default at every step, no secret kept', async (c) => {
    const id = seedPlaceholder();
    const rec = record();
    const { router, user, queryClient } = await renderRoute(`${base}/agent?project=${id}`);
    await pick(user, c.label);
    await c.fill(user);
    await next(user, router);
    rec.stop();

    expect(rec.writes()).toEqual(c.writes);
    expect(rec.all().filter((l) => l.endsWith('/agent'))).toEqual([]);
    expect(rec.broken).toEqual([]);
    const rows = projectAgents();
    expect(rows.filter((a) => a.isDefault)).toHaveLength(1);
    expect(rows.find((a) => a.isDefault)?.provider).toBe(c.kind);
    // The placeholder is gone after a swap, and is the one agent for Claude Code.
    expect(rows).toHaveLength(1);
    expect(projectRow(id).setupStep).toBe('setup');
    const text = cacheText(queryClient);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('tokens');
    expect(JSON.stringify(mockDb.snapshot())).not.toContain(TOKEN);
  });

  it('a new agent is created with the capability label as its name, and no model when none was picked for OpenCode', async () => {
    const id = seedPlaceholder();
    const rec = record();
    const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
    await pick(user, 'OpenCode');
    await next(user, router);
    rec.stop();
    expect(rec.body(`POST ${agentsPath}`)).toEqual({ provider: 'opencode', name: 'OpenCode' });
  });

  it('every runnable kind is a card to an owner, with the standard names of the picked kind', async () => {
    const id = seedPlaceholder();
    const { user } = await renderRoute(`${base}/agent?project=${id}`);
    for (const label of ['Claude Code', 'OpenAI Codex', 'OpenCode']) {
      expect(await screen.findByRole('radio', { name: label })).toBeEnabled();
    }
    await pick(user, 'OpenAI Codex');
    const options = Array.from(screen.getByRole('combobox', { name: 'Default model' }).querySelectorAll('option')).map(
      (o) => o.textContent,
    );
    expect(options).toEqual(expect.arrayContaining(AGENT_KIND_CAPABILITIES.codex.builtinModels.map((m) => m.id)));
    expect(options).not.toContain('opus');
  });

  it('a double Continue creates one agent', async () => {
    const id = seedPlaceholder();
    const rec = record();
    const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
    await pick(user, 'OpenCode');
    const button = screen.getByRole('button', { name: 'Continue' });
    await user.dblClick(button);
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/setup`));
    rec.stop();
    expect(rec.writes().filter((l) => l === `POST ${agentsPath}`)).toHaveLength(1);
    expect(projectAgents()).toHaveLength(1);
  });

  it('a retry after a refused credential reuses the created agent', async () => {
    const id = seedPlaceholder();
    const rec = record();
    scenarios.problem('agents.putCredential', {
      status: 400,
      title: 'Validation failed',
      type: 'validation',
      errors: [{ pointer: '/value', detail: 'The file was rejected.' }],
    });
    const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
    await pick(user, 'OpenAI Codex');
    const field = authBox();
    await user.type(field, '{{}"tokens":"x"}');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('The file was rejected.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`${base}/agent`);
    expect(projectAgents().filter((a) => a.isDefault)).toHaveLength(1);

    server.resetHandlers();
    await next(user, router);
    rec.stop();
    expect(rec.writes().filter((l) => l === `POST ${agentsPath}`)).toHaveLength(1);
    expect(rec.broken).toEqual([]);
    expect(projectAgents()).toHaveLength(1);
    expect(projectAgents()[0]).toMatchObject({ provider: 'codex', isDefault: true });
    expect(projectAgents()[0]?.credential.set).toBe(true);
  });

  it('swapDeleteFails: the step advances and the Claude row stays, not default, with no credential', async () => {
    const id = seedPlaceholder();
    mockDb.state.failPlaceholderDelete = true;
    const rec = record();
    const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
    await pick(user, 'OpenCode');
    await next(user, router);
    rec.stop();
    expect(rec.broken).toEqual([]);
    const left = projectAgents().find((a) => a.name === 'Claude');
    expect(left).toMatchObject({ isDefault: false, credential: { set: false } });
    expect(projectAgents().filter((a) => a.isDefault)).toHaveLength(1);
    expect(projectRow(id).setupStep).toBe('setup');
    // The Agents tab then lists the leftover as a row that needs a credential and can be deleted.
    mockDb.state.failPlaceholderDelete = false;
    await router.navigate({ to: `/o/alice/p/${P}/desk/agent` });
    const row = (await screen.findByText('Needs credential')).closest('li');
    if (!row) throw new Error('no agent row');
    expect(within(row).getByText('Claude')).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Actions for Claude' }));
    expect(await screen.findByRole('button', { name: 'Delete' })).toBeEnabled();
  });

  describe('BR-63: a retry removes the Claude placeholder the first attempt left', () => {
    const refuseCredential = () =>
      scenarios.problem('agents.putCredential', {
        status: 400,
        title: 'Validation failed',
        type: 'validation',
        errors: [{ pointer: '/value', detail: 'The file was rejected.' }],
      });
    const leftover = () => projectAgents().find((a) => a.name === 'Claude');
    /** Continue on Codex with a refused credential: the new agent is the default and the placeholder may stay. */
    async function firstAttempt(opts: { deleteFails: boolean }) {
      const id = seedPlaceholder();
      mockDb.state.failPlaceholderDelete = opts.deleteFails;
      refuseCredential();
      const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
      await pick(user, 'OpenAI Codex');
      await user.type(authBox(), '{{}"tokens":"x"}');
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      expect(await screen.findByText('The file was rejected.')).toBeInTheDocument();
      server.resetHandlers();
      mockDb.state.failPlaceholderDelete = false;
      return { router, user };
    }
    const deletes = (rec: ReturnType<typeof record>) => rec.writes().filter((l) => l === 'DELETE /api/agents/:id');

    it('a failed delete and a refused credential: the retry deletes the placeholder', async () => {
      const { router, user } = await firstAttempt({ deleteFails: true });
      expect(leftover()).toMatchObject({ isDefault: false, credential: { set: false } });
      const rec = record();
      await next(user, router);
      rec.stop();
      expect(deletes(rec)).toHaveLength(1);
      expect(leftover()).toBeUndefined();
      expect(projectAgents()).toHaveLength(1);
      expect(projectAgents()[0]).toMatchObject({ provider: 'codex', isDefault: true });
      expect(rec.broken).toEqual([]);
    });

    it('a refused credential after a successful delete: the retry deletes nothing more', async () => {
      const { router, user } = await firstAttempt({ deleteFails: false });
      expect(leftover()).toBeUndefined();
      const rec = record();
      await next(user, router);
      rec.stop();
      expect(deletes(rec)).toEqual([]);
      expect(projectAgents()).toHaveLength(1);
    });

    it('the retry keeps a leftover Claude that has a credential', async () => {
      const { router, user } = await firstAttempt({ deleteFails: true });
      const row = leftover();
      if (!row) throw new Error('no leftover');
      row.credential = { set: true, type: 'api_key', updatedAt: '2026-11-01T00:00:00.000Z', setBy: null };
      const rec = record();
      await next(user, router);
      rec.stop();
      expect(deletes(rec)).toEqual([]);
      expect(projectAgents()).toHaveLength(2);
    });

    it('the retry keeps a leftover Claude that a rule names', async () => {
      const { router, user } = await firstAttempt({ deleteFails: true });
      const row = leftover();
      if (!row) throw new Error('no leftover');
      row.usage = { rules: 1, blockingRuns: 0 };
      const rec = record();
      await next(user, router);
      rec.stop();
      expect(deletes(rec)).toEqual([]);
      expect(projectAgents()).toHaveLength(2);
    });
  });

  describe('the model sent to an existing agent', () => {
    it('OpenCode with no model clears the model of the saved OpenCode agent', async () => {
      const id = seedPlaceholder();
      const row = placeholder();
      mockDb.state.agents.push({
        ...structuredClone(row),
        id: 'a0000000-0000-4000-8000-0000000000c1',
        provider: 'opencode',
        name: 'OpenCode',
        isDefault: false,
        model: 'some/model',
      });
      const rec = record();
      const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
      await pick(user, 'OpenCode');
      await next(user, router);
      rec.stop();
      expect(rec.body('PATCH /api/agents/:id')).toEqual({ model: '' });
      expect(projectAgents().find((a) => a.provider === 'opencode')?.model).toBe('');
    });

    it.each(['claude', 'codex'] as const)('%s is never sent an empty model', async (kind) => {
      const id = seedPlaceholder();
      const { queryClient } = await renderRoute(`${base}/agent?project=${id}`);
      const project = projectFixtures.find((p) => p.id === id);
      if (!project) throw new Error('no project');
      const target = projectAgents().find((a) => a.provider === kind) ?? {
        ...structuredClone(placeholder()),
        id: 'a0000000-0000-4000-8000-0000000000c2',
        provider: kind,
        name: kind,
        isDefault: false,
      };
      if (!projectAgents().includes(target)) mockDb.state.agents.push(target);
      const before = target.model;
      const rec = record();
      const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);
      const { result } = renderHook(() => useSaveAgentStep('alice'), { wrapper });
      await act(async () => {
        await result.current.save(project, {
          kind,
          model: '',
          maxConcurrentRuns: 1,
          credentialType: null,
          credential: '',
          baseUrl: '',
        });
      });
      rec.stop();
      expect(rec.writes()).not.toContain('PATCH /api/agents/:id');
      expect(target.model).toBe(before);
    });
  });

  it('the placeholder is not deleted when the step is already past the Agent step', async () => {
    // The page locks the provider there (BR-65), so the guard is exercised on the hook itself.
    const id = seedPlaceholder('setup');
    const { queryClient } = await renderRoute(`${base}/agent?project=${id}`);
    const project = projectFixtures.find((p) => p.id === id);
    if (!project) throw new Error('no project');
    const rec = record();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useSaveAgentStep('alice'), { wrapper });
    await act(async () => {
      await result.current.save(
        { ...project, setupStep: 'setup' },
        { kind: 'opencode', model: '', maxConcurrentRuns: 1, credentialType: null, credential: '', baseUrl: '' },
      );
    });
    rec.stop();
    expect(rec.writes()).not.toContain('DELETE /api/agents/:id');
    expect(projectAgents()).toHaveLength(2);
    expect(projectAgents().filter((a) => a.isDefault)).toHaveLength(1);
  });

  it('the placeholder is not deleted when making the new agent the default failed', async () => {
    const id = seedPlaceholder();
    scenarios.serverError('agents.setDefault');
    const rec = record();
    const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
    await pick(user, 'OpenCode');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(rec.writes()).toContain('POST /api/agents/:id/default'));
    await screen.findByText(/went wrong|Internal server error/);
    rec.stop();
    expect(rec.writes()).not.toContain('DELETE /api/agents/:id');
    expect(rec.broken).toEqual([]);
    expect(router.state.location.pathname).toBe(`${base}/agent`);
    expect(projectAgents()).toHaveLength(2);
    expect(placeholder().isDefault).toBe(true);
  });

  it('a saved agent shows its provider read-only', async () => {
    const id = seedAt('agent');
    await renderRoute(`${base}/agent?project=${id}`);
    expect(await screen.findByRole('radio', { name: 'Claude Code' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'OpenAI Codex' })).toBeDisabled();
  });

  it('BR-65: resuming past the Agent step shows the provider read-only even with no credential saved', async () => {
    const id = seedPlaceholder('setup');
    await renderRoute(`${base}/agent?project=${id}`);
    expect(await screen.findByRole('radio', { name: 'Claude Code' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'OpenAI Codex' })).toBeDisabled();
  });

  it('BR-65: resuming past the Agent step shows the agent name and the saved credential as set', async () => {
    const id = seedAt('setup');
    const agent = placeholder();
    agent.name = 'Main agent';
    agent.credential = { set: true, type: 'oauth_token', updatedAt: new Date().toISOString(), setBy: 'kim-hale' };
    await renderRoute(`${base}/agent?project=${id}`);
    expect(await screen.findByText('Main agent')).toBeInTheDocument();
    expect(screen.getByText(/Set .* by kim-hale\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Subscription token', { selector: 'input[type="password"]' })).toBeNull();
  });

  it('a project still at the Agent step with no credential lets the provider be picked', async () => {
    const id = seedPlaceholder('agent');
    await renderRoute(`${base}/agent?project=${id}`);
    expect(await screen.findByRole('radio', { name: 'OpenAI Codex' })).toBeEnabled();
  });

  it('a legacy project with the seeded row continues with no create, no delete and no credential write', async () => {
    const id = seedAt('agent');
    const rec = record();
    const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
    await screen.findByRole('radio', { name: 'Claude Code' });
    await next(user, router);
    rec.stop();
    expect(rec.writes()).toEqual([finish]);
    expect(projectAgents()).toHaveLength(1);
  });

  it.each(['rejected', 'unreachable'] as const)(
    'a %s test keeps the step with a banner and Continue anyway advances',
    async (status) => {
      const id = seedPlaceholder();
      mockDb.state.agentTestScenario = status;
      const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
      await user.type(await tokenBox(user), TOKEN);
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      await user.click(await screen.findByRole('button', { name: 'Continue anyway' }));
      await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/setup`));
      expect(projectRow(id).setupStep).toBe('setup');
    },
  );

  it.each(['rejected', 'unreachable'] as const)('a %s test stays on the step until Continue anyway', async (status) => {
    const id = seedPlaceholder();
    mockDb.state.agentTestScenario = status;
    const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
    await user.type(await tokenBox(user), TOKEN);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('button', { name: 'Continue anyway' })).toBeInTheDocument();
    // The Banner names the failure with the status word of the list rows, never the raw status code.
    expect(screen.getByText(status === 'rejected' ? 'Credential rejected' : "Can't reach address")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`${base}/agent`);
    expect(projectRow(id).setupStep).toBe('agent');
  });

  it.each(['invalid', 'unsupported'] as const)('a %s test advances', async (status) => {
    const id = seedPlaceholder();
    mockDb.state.agentTestScenario = status;
    const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
    await user.type(await tokenBox(user), TOKEN);
    await next(user, router);
  });
});
