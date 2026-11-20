import type { QueryClient } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { jsonResponse, problemResponse, routeHandler } from '@/mocks/msw/http';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';
import { browserLocation } from './location';

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

afterEach(() => vi.restoreAllMocks());

describe('setup flow', () => {
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
    await user.type(await screen.findByLabelText('Token'), TOKEN);
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
    expect(await screen.findByRole('heading', { name: 'Add the Claude credential' })).toBeInTheDocument();
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
    const token = await screen.findByLabelText('Token');
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

  it('with no connection, Connect asks the API for the install page and goes there', async () => {
    mockDb.state.connections = mockDb.state.connections.filter((c) => c.orgId !== ids.org.alice);
    const assign = vi.spyOn(browserLocation, 'assign').mockImplementation(() => undefined);
    const { user } = await renderRoute(`${base}/repo`);
    await user.click(await screen.findByRole('button', { name: 'Connect GitHub' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://github.com/apps/agent-desk/installations/new'));
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
    await screen.findByRole('heading', { name: 'Trigger your first run from GitHub' });
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
    const assign = vi.spyOn(browserLocation, 'assign').mockImplementation(() => undefined);
    const { user } = await renderRoute(`${base}/repo`);
    await user.click(await screen.findByRole('button', { name: 'Connect GitHub' }));
    expect(await screen.findByRole('radio', { name: 'harbor-labs/invoicer-api' })).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
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
    const assign = vi.spyOn(browserLocation, 'assign').mockImplementation(() => undefined);
    const { user } = await renderRoute(`${base}/repo`);
    await user.click(await screen.findByRole('button', { name: 'Connect GitHub' }));
    expect(await screen.findByRole('radio', { name: 'harbor-labs/invoicer-api' })).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    expect(mockDb.requests('POST', '/api/connections/github/install')).toBe(0);
  });

  it('Change which repositories the app can access still opens the install page when the org is already connected', async () => {
    const assign = vi.spyOn(browserLocation, 'assign').mockImplementation(() => undefined);
    const { user } = await renderRoute(`${base}/repo`);
    await user.click(await screen.findByRole('link', { name: 'Change which repositories the app can access' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://github.com/apps/agent-desk/installations/new'));
    expect(mockDb.requests('POST', '/api/connections/github/install')).toBe(1);
  });

  it('Connect still opens the install page when linking what the account can see fails', async () => {
    mockDb.state.connections = mockDb.state.connections.filter((c) => c.orgId !== ids.org.alice);
    server.use(routeHandler('connections.sync', async () => jsonResponse({ title: 'boom' }, 500)));
    const assign = vi.spyOn(browserLocation, 'assign').mockImplementation(() => undefined);
    const { user } = await renderRoute(`${base}/repo`);
    await user.click(await screen.findByRole('button', { name: 'Connect GitHub' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://github.com/apps/agent-desk/installations/new'));
    expect(mockDb.requests('POST', '/api/connections/github/install')).toBe(1);
  });

  it('an install URL that is not https is not followed and an error shows', async () => {
    mockDb.state.connections = mockDb.state.connections.filter((c) => c.orgId !== ids.org.alice);
    server.use(routeHandler('connections.install', async () => jsonResponse({ url: 'javascript:alert(1)' })));
    const assign = vi.spyOn(browserLocation, 'assign').mockImplementation(() => undefined);
    const { user } = await renderRoute(`${base}/repo`);
    await user.click(await screen.findByRole('button', { name: 'Connect GitHub' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not a valid https address');
    expect(assign).not.toHaveBeenCalled();
  });
});

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
    const address = await screen.findByLabelText('API address');
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
    await user.type(await screen.findByLabelText('API address'), ' https://gw.example.com/anthropic ');
    await user.type(screen.getByLabelText('Token'), TOKEN);
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
    await screen.findByLabelText('API address');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${base}/setup`));
    stop();
    expect(sent.some((s) => s.path === credentialPath)).toBe(false);
  });

  it('a token without an address change sends no baseUrl', async () => {
    const id = seedAt('agent');
    const { sent, stop } = captureWrites();
    const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
    await user.type(await screen.findByLabelText('Token'), TOKEN);
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
    await user.clear(await screen.findByLabelText('API address'));
    await user.type(screen.getByLabelText('Token'), TOKEN);
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
    const agentGetPath = `/api/projects/${id}/agent`;
    const { router, user } = await renderRoute(`${base}/agent?project=${id}`);
    await user.type(await screen.findByLabelText('API address'), 'https://10.0.0.1');
    await user.type(screen.getByLabelText('Token'), TOKEN);
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
    await user.type(await screen.findByLabelText('Token'), TOKEN);
    scenarios.serverError('agents.get');
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
    const token = await screen.findByLabelText('Token');
    await user.type(token, TOKEN);
    scenarios.serverError('agents.get');
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
    await user.type(await screen.findByLabelText('API address'), address);
    await user.type(screen.getByLabelText('Token'), TOKEN);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    // The step refetched the agent: it shows the new address and asks for the token again.
    await waitFor(() => expect(screen.queryByText(/Set .* by /)).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe(`${base}/agent`);
    expect(projectRow(id).setupStep).toBe('agent');

    await user.clear(screen.getByLabelText('Token'));
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
    expect(sent.find((s) => s.path === `/api/projects/${id}/agent`)?.body).toMatchObject({ model: 'my-gw/model-x:1' });
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
