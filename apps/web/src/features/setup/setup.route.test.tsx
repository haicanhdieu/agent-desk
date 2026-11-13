import type { QueryClient } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { jsonResponse, routeHandler } from '@/mocks/msw/http';
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
    expect(rules.map((r) => [r.command, r.target, r.skillName])).toEqual([
      ['code-build', 'issue', 'code-build'],
      ['code-review', 'pr', 'code-review'],
    ]);
    expect(projectRow(created.id).setupStep).toBe('ready');

    // Ready reads the project.
    expect(await screen.findByRole('heading', { name: 'Trigger your first run from GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to runs' })).toHaveAttribute('href', `/o/alice/p/${created.id}/runs`);
    expect(screen.getByText('Polling every 10 min')).toBeInTheDocument();
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
    endsAt: null,
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
