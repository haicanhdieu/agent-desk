import type { Page, RuleDto } from '@agentdesk/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { agentsFixture } from '@/mocks/dto/agents';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

const projectId = ids.project.invoicerApi;
const base = `/o/alice/p/${projectId}`;
const rulesPage = `${base}/desk/rules`;

const projectRules = () => mockDb.state.rules.filter((r) => r.projectId === projectId);
const ruleRow = (id: string) => {
  const rule = mockDb.state.rules.find((r) => r.id === id);
  if (!rule) throw new Error(`rule ${id} not in the mock store`);
  return rule;
};
const toggleFor = (command: string) => screen.getByRole('switch', { name: `Enable rule /${command}` });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Scripts `rules.update` answers per call (1-based, in arrival order). `fail` answers 500 after `delayMs`; `ok` writes
 * the store at once and answers after `delayMs`. Calls with no script fall through to the default handler.
 */
function scriptUpdates(script: Record<number, { outcome: 'fail' | 'ok'; delayMs: number }>) {
  let call = 0;
  server.use(
    http.patch('*/api/rules/:ruleId', async ({ request, params }) => {
      call += 1;
      const step = script[call];
      if (!step) return undefined;
      if (step.outcome === 'fail') {
        await sleep(step.delayMs);
        return HttpResponse.json(
          { type: 'urn:agentdesk:problem:internal', title: 'Internal server error', status: 500 },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        );
      }
      const rule = ruleRow(String(params.ruleId));
      const body: unknown = await request.json();
      if (typeof body === 'object' && body !== null && 'enabled' in body && typeof body.enabled === 'boolean')
        rule.enabled = body.enabled;
      const answer = structuredClone(rule);
      await sleep(step.delayMs);
      return HttpResponse.json(answer);
    }),
  );
}

const pane = (name: 'Edit rule' | 'New rule') => screen.getByRole('complementary', { name });

describe('desk rules route', () => {
  it('lists the project rules as sentences with stats, a missing-skill warning and real guard links', async () => {
    await renderRoute(rulesPage);
    expect(await screen.findByRole('heading', { level: 1, name: 'Routing rules' })).toBeInTheDocument();
    expect(screen.getAllByRole('switch', { name: /^Enable rule \// })).toHaveLength(projectRules().length);
    expect(toggleFor('code-build')).toHaveAttribute('aria-checked', 'true');
    expect(toggleFor('qa-e2e')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: 'Edit rule /code-build' })).toHaveTextContent(
      'When /code-build is posted on an issue labelled user-story, run code-build with Claude',
    );
    expect(screen.getByText(/^14 runs in 30 days · last /)).toBeInTheDocument();
    expect(screen.getAllByText('Never ran').length).toBeGreaterThan(0);
    expect(screen.getByText(/Skill docs-update is not in \.claude\/skills\/ on main/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change' })).toHaveAttribute('href', `${base}/desk/agent?tab=limits`);
    expect(screen.getByRole('link', { name: 'Runs, Ignored' })).toHaveAttribute('href', `${base}/runs`);
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it("the Desk sidebar header shows the current project's name, not the generic Desk label", async () => {
    await renderRoute(rulesPage);
    const desk = await screen.findByRole('navigation', { name: 'Desk' });
    expect(await within(desk).findByText('invoicer-api', { selector: 'div' })).toBeInTheDocument();
    expect(within(desk).queryByText('Desk')).toBeNull();
  });

  it('the Desk sidebar header follows the project in the route', async () => {
    await renderRoute(`/o/alice/p/${ids.project.invoicerWeb}/desk/rules`);
    const desk = await screen.findByRole('navigation', { name: 'Desk' });
    expect(await within(desk).findByText('invoicer-web', { selector: 'div' })).toBeInTheDocument();
    expect(within(desk).queryByText('Desk')).toBeNull();
  });

  it('no rules shows the empty state', async () => {
    mockDb.state.rules = mockDb.state.rules.filter((r) => r.projectId !== projectId);
    await renderRoute(rulesPage);
    expect(await screen.findByRole('heading', { name: /No routing rules/ })).toBeInTheDocument();
  });

  it('a 500 on rules.list shows the error banner with Retry', async () => {
    await renderRoute(rulesPage, {
      scenario: () => scenarios.serverError('rules.list'),
    });
    expect(await screen.findByRole('button', { name: /Retry/ })).toBeInTheDocument();
  });

  it('rule content is rendered as text', async () => {
    ruleRow(ids.rule.r2).labelFilter = ['<img src=x onerror=alert(1)>'];
    await renderRoute(rulesPage);
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  describe('enable toggle', () => {
    it('flips at once and saves', async () => {
      const { user } = await renderRoute(rulesPage);
      await user.click(await screen.findByRole('switch', { name: 'Enable rule /code-build' }));
      expect(toggleFor('code-build')).toHaveAttribute('aria-checked', 'false');
      await waitFor(() => expect(ruleRow(ids.rule.r1).enabled).toBe(false));
      expect(toggleFor('code-build')).toHaveAttribute('aria-checked', 'false');
    });

    it('on a server error flips, then flips back and shows an error toast', async () => {
      // The answer is held back a little so the in-flight (optimistic) state can be seen.
      const { user } = await renderRoute(rulesPage, {
        scenario: () => scenarios.serverError('rules.update', { delayMs: 50 }),
      });
      await user.click(await screen.findByRole('switch', { name: 'Enable rule /code-build' }));
      expect(toggleFor('code-build')).toHaveAttribute('aria-checked', 'false');
      expect(screen.queryByRole('alert')).toBeNull();

      expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
      await waitFor(() => expect(toggleFor('code-build')).toHaveAttribute('aria-checked', 'true'));
      expect(ruleRow(ids.rule.r1).enabled).toBe(true);
    });

    it('a slow failing toggle of one rule rolls back only that rule', async () => {
      // Call 1 (code-build) fails late; call 2 (code-review) succeeds at once.
      scriptUpdates({ 1: { outcome: 'fail', delayMs: 80 }, 2: { outcome: 'ok', delayMs: 0 } });
      const { user } = await renderRoute(rulesPage);
      await user.click(await screen.findByRole('switch', { name: 'Enable rule /code-build' }));
      await user.click(toggleFor('code-review'));
      await waitFor(() => expect(ruleRow(ids.rule.r2).enabled).toBe(false));

      expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
      await waitFor(() => expect(toggleFor('code-build')).toHaveAttribute('aria-checked', 'true'));
      expect(toggleFor('code-review')).toHaveAttribute('aria-checked', 'false');
      await sleep(30);
      expect(toggleFor('code-review')).toHaveAttribute('aria-checked', 'false');
    });

    it('same rule toggled twice, the first fails late: the second outcome stands', async () => {
      // Off (fails after 80 ms), then on again (succeeds at once).
      scriptUpdates({ 1: { outcome: 'fail', delayMs: 80 }, 2: { outcome: 'ok', delayMs: 0 } });
      const { user } = await renderRoute(`${rulesPage}`);
      const sw = await screen.findByRole('switch', { name: 'Enable rule /qa-e2e' });
      await user.click(sw); // off → on (fails late)
      await user.click(toggleFor('qa-e2e')); // on → off (succeeds)
      await waitFor(() => expect(ruleRow(ids.rule.r5).enabled).toBe(false));
      expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
      await sleep(30);
      expect(toggleFor('qa-e2e')).toHaveAttribute('aria-checked', 'false');
      expect(ruleRow(ids.rule.r5).enabled).toBe(false);
    });

    it('same rule toggled twice, the first answer arrives last: the stale answer does not win', async () => {
      // Both succeed; the first answer (enabled false) arrives after the second (enabled true).
      scriptUpdates({ 1: { outcome: 'ok', delayMs: 80 }, 2: { outcome: 'ok', delayMs: 0 } });
      const { user } = await renderRoute(rulesPage);
      await user.click(await screen.findByRole('switch', { name: 'Enable rule /code-build' }));
      await user.click(toggleFor('code-build'));
      await sleep(150);
      expect(ruleRow(ids.rule.r1).enabled).toBe(true);
      expect(toggleFor('code-build')).toHaveAttribute('aria-checked', 'true');
    });
  });

  describe('form', () => {
    it('?rule=<id> opens the edit pane with the rule values; an unknown or invalid value opens nothing', async () => {
      await renderRoute(`${rulesPage}?rule=${ids.rule.r2}`);
      const edit = await screen.findByRole('complementary', {
        name: 'Edit rule',
      });
      expect(within(edit).getByLabelText('Command')).toHaveValue('code-review');
      expect(screen.getByRole('button', { name: 'Edit rule /code-review' }).closest('[aria-current]')).not.toBeNull();
    });

    it.each([['nope'], ['00000000-0000-4000-8000-999999999999']])('?rule=%s falls back to no pane', async (rule) => {
      await renderRoute(`${rulesPage}?rule=${rule}`);
      expect(
        await screen.findByRole('heading', {
          level: 1,
          name: 'Routing rules',
        }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('complementary')).toBeNull();
    });

    it('clicking a rule opens it and sets ?rule; Cancel closes it', async () => {
      const { router, user } = await renderRoute(rulesPage);
      await user.click(await screen.findByRole('button', { name: 'Edit rule /code-e2e' }));
      expect(await screen.findByRole('complementary', { name: 'Edit rule' })).toBeInTheDocument();
      expect(router.state.location.search).toEqual({ rule: ids.rule.r3 });
      await user.click(within(pane('Edit rule')).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
      expect(router.state.location.search).toEqual({});
    });

    it('edit saves and the list shows the new sentence', async () => {
      const { router, user } = await renderRoute(`${rulesPage}?rule=${ids.rule.r2}`);
      const edit = await screen.findByRole('complementary', {
        name: 'Edit rule',
      });
      const command = within(edit).getByLabelText('Command');
      await user.clear(command);
      await user.type(command, 'review');
      await user.click(within(edit).getByRole('radio', { name: 'Any' }));
      await user.click(within(edit).getByRole('button', { name: 'Save rule' }));

      await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
      expect(ruleRow(ids.rule.r2)).toMatchObject({
        command: 'review',
        target: 'any',
      });
      expect(screen.getByRole('button', { name: 'Edit rule /review' })).toHaveTextContent(
        'When /review is posted on an issue or pull request, run code-review with Claude',
      );
      expect(router.state.location.search).toEqual({});
    });

    it('New rule opens an empty form; saving creates the rule', async () => {
      const { router, user } = await renderRoute(rulesPage);
      await user.click(await screen.findByRole('button', { name: 'New rule' }));
      const form = await screen.findByRole('complementary', {
        name: 'New rule',
      });
      expect(router.state.location.search).toEqual({ rule: 'new' });
      expect(within(form).queryByRole('button', { name: 'Delete rule' })).toBeNull();
      await user.type(within(form).getByLabelText('Command'), 'ship-it');
      await user.click(within(form).getByRole('button', { name: 'Save rule' }));

      await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
      expect(projectRules().find((r) => r.command === 'ship-it')).toMatchObject({
        target: 'issue',
        labelFilter: [],
        skillName: 'code-build',
        enabled: true,
      });
      expect(screen.getByRole('switch', { name: 'Enable rule /ship-it' })).toBeInTheDocument();
    });

    it('Review Focus 5: a duplicate command (409) shows under the command field and the form stays filled', async () => {
      const before = projectRules().length;
      const { router, user } = await renderRoute(`${rulesPage}?rule=new`);
      const form = await screen.findByRole('complementary', {
        name: 'New rule',
      });
      const command = within(form).getByLabelText('Command');
      await user.type(command, 'code-build');
      await user.click(within(form).getByRole('radio', { name: 'Pull request' }));
      await user.click(within(form).getByRole('button', { name: 'Save rule' }));

      await waitFor(() => expect(command).toHaveAccessibleDescription(/A rule for \/code-build already exists/));
      expect(command).toHaveAttribute('aria-invalid', 'true');
      expect(command).toHaveValue('code-build');
      expect(within(form).getByRole('radio', { name: 'Pull request' })).toHaveAttribute('aria-checked', 'true');
      expect(pane('New rule')).toBeInTheDocument();
      expect(router.state.location.search).toEqual({ rule: 'new' });
      expect(projectRules()).toHaveLength(before);

      // Editing the command clears its server message; a new command saves.
      await user.type(command, '-2');
      expect(command).not.toHaveAccessibleDescription(/already exists/);
      await user.click(within(form).getByRole('button', { name: 'Save rule' }));
      await waitFor(() => expect(projectRules()).toHaveLength(before + 1));
      expect(projectRules().at(-1)).toMatchObject({
        command: 'code-build-2',
        target: 'pr',
      });
    });

    it('a command the contract refuses shows a field message and sends nothing', async () => {
      const { user } = await renderRoute(`${rulesPage}?rule=new`);
      const form = await screen.findByRole('complementary', {
        name: 'New rule',
      });
      const posts = mockDb.requests('POST', `/api/projects/${projectId}/rules`);
      await user.type(within(form).getByLabelText('Command'), 'Not Valid');
      await user.click(within(form).getByRole('button', { name: 'Save rule' }));
      await waitFor(() => expect(within(form).getByLabelText('Command')).toHaveAttribute('aria-invalid', 'true'));
      expect(mockDb.requests('POST', `/api/projects/${projectId}/rules`)).toBe(posts);
    });

    it('an error without field pointers shows a form banner and keeps the values', async () => {
      const { user } = await renderRoute(`${rulesPage}?rule=${ids.rule.r2}`, {
        scenario: () => scenarios.serverError('rules.update'),
      });
      const edit = await screen.findByRole('complementary', {
        name: 'Edit rule',
      });
      const command = within(edit).getByLabelText('Command');
      await user.type(command, '-x');
      await user.click(within(edit).getByRole('button', { name: 'Save rule' }));
      expect(await within(edit).findByRole('alert')).toHaveTextContent('Internal server error');
      expect(command).toHaveValue('code-review-x');
    });

    it('Save on edit sends only the changed fields, so a row toggle made meanwhile stands', async () => {
      const { user } = await renderRoute(`${rulesPage}?rule=${ids.rule.r2}`);
      const edit = await screen.findByRole('complementary', { name: 'Edit rule' });
      // The draft is touched first, then the row switch turns the rule off while the pane is open.
      await user.type(within(edit).getByLabelText('Command'), '-x');
      await user.click(toggleFor('code-review'));
      await waitFor(() => expect(ruleRow(ids.rule.r2).enabled).toBe(false));
      await user.click(within(edit).getByRole('button', { name: 'Save rule' }));
      await waitFor(() => expect(ruleRow(ids.rule.r2).command).toBe('code-review-x'));
      expect(ruleRow(ids.rule.r2).enabled).toBe(false);
      await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
      expect(toggleFor('code-review-x')).toHaveAttribute('aria-checked', 'false');
    });

    it('editing any field clears the form banner', async () => {
      const { user } = await renderRoute(`${rulesPage}?rule=${ids.rule.r2}`, {
        scenario: () => scenarios.serverError('rules.update'),
      });
      const edit = await screen.findByRole('complementary', { name: 'Edit rule' });
      await user.type(within(edit).getByLabelText('Command'), '-x');
      await user.click(within(edit).getByRole('button', { name: 'Save rule' }));
      expect(await within(edit).findByRole('alert')).toBeInTheDocument();
      await user.click(within(edit).getByRole('radio', { name: 'Any' }));
      expect(within(edit).queryByRole('alert')).toBeNull();
    });

    it('New rule offers Skill / Custom prompt and shows the server system lines under the prompt', async () => {
      const { user } = await renderRoute(`${rulesPage}?rule=new`);
      const form = await screen.findByRole('complementary', { name: 'New rule' });
      expect(within(form).getByRole('radio', { name: 'Skill' })).toHaveAttribute('aria-checked', 'true');
      await user.click(within(form).getByRole('radio', { name: 'Custom prompt' }));
      expect(within(form).getByLabelText('Prompt')).toBeInTheDocument();
      expect(within(form).getByText("Added by Agent Desk (can't be edited)")).toBeInTheDocument();
      expect(await within(form).findByText(/agentdesk-status done/)).toBeInTheDocument();
    });

    it('saves a custom prompt rule and lists it as Custom prompt with its first line', async () => {
      const { user } = await renderRoute(`${rulesPage}?rule=new`);
      const form = await screen.findByRole('complementary', { name: 'New rule' });
      await user.type(within(form).getByLabelText('Command'), 'sweep');
      await user.click(within(form).getByRole('radio', { name: 'Custom prompt' }));
      await user.type(within(form).getByLabelText('Prompt'), 'Sweep the stale branches');
      await user.click(within(form).getByRole('button', { name: 'Save rule' }));

      await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
      expect(projectRules().find((r) => r.command === 'sweep')).toMatchObject({
        kind: 'prompt',
        prompt: 'Sweep the stale branches',
        skillName: null,
      });
      const row = screen.getByRole('button', { name: 'Edit rule /sweep' });
      expect(row).toHaveTextContent('Custom prompt');
      expect(row).toHaveTextContent('Sweep the stale branches');
    });

    it('switching an edited skill rule to Custom prompt sends kind and prompt only', async () => {
      const bodies: unknown[] = [];
      server.use(
        http.patch('*/api/rules/:ruleId', async ({ request }) => {
          bodies.push(await request.clone().json());
          return undefined;
        }),
      );
      const { user } = await renderRoute(`${rulesPage}?rule=${ids.rule.r2}`);
      const edit = await screen.findByRole('complementary', { name: 'Edit rule' });
      await user.click(within(edit).getByRole('radio', { name: 'Custom prompt' }));
      await user.type(within(edit).getByLabelText('Prompt'), 'Review it kindly');
      await user.click(within(edit).getByRole('button', { name: 'Save rule' }));
      await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
      expect(bodies).toEqual([{ kind: 'prompt', prompt: 'Review it kindly' }]);
      expect(ruleRow(ids.rule.r2)).toMatchObject({ kind: 'prompt', prompt: 'Review it kindly', skillName: null });
    });

    it('a 4001-character prompt shows a field message and sends nothing', async () => {
      const { user } = await renderRoute(`${rulesPage}?rule=new`);
      const form = await screen.findByRole('complementary', { name: 'New rule' });
      const posts = mockDb.requests('POST', `/api/projects/${projectId}/rules`);
      await user.type(within(form).getByLabelText('Command'), 'long-one');
      await user.click(within(form).getByRole('radio', { name: 'Custom prompt' }));
      const prompt = within(form).getByLabelText('Prompt');
      await user.click(prompt);
      await user.paste('a'.repeat(4001));
      await user.click(within(form).getByRole('button', { name: 'Save rule' }));
      await waitFor(() => expect(prompt).toHaveAttribute('aria-invalid', 'true'));
      expect(prompt).toHaveAccessibleDescription(/up to 4,000 characters/);
      expect(mockDb.requests('POST', `/api/projects/${projectId}/rules`)).toBe(posts);
    });

    it('a server 422 on /prompt shows under the prompt field', async () => {
      const { user } = await renderRoute(`${rulesPage}?rule=new`, {
        scenario: () =>
          scenarios.problem('rules.create', {
            status: 422,
            title: 'Unprocessable',
            errors: [{ pointer: '/prompt', detail: 'The prompt looks like a secret.' }],
          }),
      });
      const form = await screen.findByRole('complementary', { name: 'New rule' });
      await user.type(within(form).getByLabelText('Command'), 'sneaky');
      await user.click(within(form).getByRole('radio', { name: 'Custom prompt' }));
      await user.type(within(form).getByLabelText('Prompt'), 'hello');
      await user.click(within(form).getByRole('button', { name: 'Save rule' }));
      const prompt = within(form).getByLabelText('Prompt');
      await waitFor(() => expect(prompt).toHaveAccessibleDescription(/The prompt looks like a secret\./));
      expect(prompt).toHaveAttribute('aria-invalid', 'true');
    });

    it('when the preview fails, the form still saves and Retry refetches', async () => {
      const { user } = await renderRoute(`${rulesPage}?rule=new`, {
        scenario: () => scenarios.serverError('rules.promptPreview'),
      });
      const form = await screen.findByRole('complementary', { name: 'New rule' });
      await user.type(within(form).getByLabelText('Command'), 'no-preview');
      await user.click(within(form).getByRole('radio', { name: 'Custom prompt' }));
      const retry = await within(form).findByRole('button', { name: /Retry/ });
      const path = `/api/projects/${projectId}/rules/prompt-preview`;
      const before = mockDb.requests('GET', path);
      await user.click(retry);
      await waitFor(() => expect(mockDb.requests('GET', path)).toBeGreaterThan(before));
      await user.type(within(form).getByLabelText('Prompt'), 'Do the thing');
      await user.click(within(form).getByRole('button', { name: 'Save rule' }));
      await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
      expect(projectRules().find((r) => r.command === 'no-preview')).toMatchObject({ kind: 'prompt' });
    });

    const menuButton = (name: 'Edit' | 'Delete') =>
      within(screen.getByRole('dialog', { name: 'Actions for /code-e2e' })).getByRole('button', { name });

    it('the More menu: Edit opens the rule pane', async () => {
      const { router, user } = await renderRoute(rulesPage);
      await user.click(await screen.findByRole('button', { name: 'More actions for /code-e2e' }));
      await user.click(menuButton('Edit'));
      expect(await screen.findByRole('complementary', { name: 'Edit rule' })).toBeInTheDocument();
      expect(router.state.location.search).toEqual({ rule: ids.rule.r3 });
    });

    it('the More menu: Delete removes that rule and keeps another open rule open', async () => {
      const { router, user } = await renderRoute(`${rulesPage}?rule=${ids.rule.r2}`);
      await screen.findByRole('complementary', { name: 'Edit rule' });
      await user.click(screen.getByRole('button', { name: 'More actions for /code-e2e' }));
      await user.click(menuButton('Delete'));
      await waitFor(() => expect(screen.queryByRole('switch', { name: 'Enable rule /code-e2e' })).toBeNull());
      expect(mockDb.state.rules.some((r) => r.id === ids.rule.r3)).toBe(false);
      expect(screen.getByRole('complementary', { name: 'Edit rule' })).toBeInTheDocument();
      expect(router.state.location.search).toEqual({ rule: ids.rule.r2 });
    });

    it('the More menu: Delete closes the pane of the rule it deletes', async () => {
      const { router, user } = await renderRoute(`${rulesPage}?rule=${ids.rule.r3}`);
      await screen.findByRole('complementary', { name: 'Edit rule' });
      await user.click(screen.getByRole('button', { name: 'More actions for /code-e2e' }));
      await user.click(menuButton('Delete'));
      await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
      expect(router.state.location.search).toEqual({});
    });

    it('Delete removes the rule and closes the pane', async () => {
      const { router, user } = await renderRoute(`${rulesPage}?rule=${ids.rule.r3}`);
      const edit = await screen.findByRole('complementary', {
        name: 'Edit rule',
      });
      await user.click(within(edit).getByRole('button', { name: 'Delete rule' }));
      await waitFor(() => expect(screen.queryByRole('switch', { name: 'Enable rule /code-e2e' })).toBeNull());
      expect(mockDb.state.rules.some((r) => r.id === ids.rule.r3)).toBe(false);
      expect(screen.queryByRole('complementary')).toBeNull();
      expect(router.state.location.search).toEqual({});
    });
  });

  describe('model', () => {
    const modelSelect = (root: HTMLElement) => within(root).getByRole('combobox', { name: 'Model' });
    const optionNames = (select: HTMLElement) =>
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent);
    const builtin = () => scenarios.agentModels(ids.agent.invoicerApi, { kind: 'fallback', reason: 'empty' });
    const patchBodies = () => {
      const bodies: unknown[] = [];
      server.use(
        http.patch('*/api/rules/:ruleId', async ({ request }) => {
          bodies.push(await request.clone().json());
          return undefined;
        }),
      );
      return bodies;
    };

    it('the Model field lists Default model, the agent models, Other model…, with the default model help', async () => {
      const agent = mockDb.state.agents.find((a) => a.id === ids.agent.invoicerApi);
      if (!agent) throw new Error('agent not in the mock store');
      await renderRoute(`${rulesPage}?rule=new`, { scenario: builtin });
      const form = await screen.findByRole('complementary', { name: 'New rule' });
      const select = modelSelect(form);
      await waitFor(() =>
        expect(optionNames(select)).toEqual(['Default model', 'opus', 'sonnet', 'haiku', 'Other model…']),
      );
      expect(select).toHaveValue('_default');
      expect(select).toHaveAccessibleDescription(
        new RegExp(`Default model is ${agent.model}, set on Agent & settings`),
      );
      expect(within(form).getByRole('link', { name: 'Agent & settings' })).toHaveAttribute(
        'href',
        `${base}/desk/agent`,
      );
    });

    it('saving a typed model stores it trimmed and reopening shows it under Other model…', async () => {
      const { user } = await renderRoute(`${rulesPage}?rule=new`, { scenario: builtin });
      const form = await screen.findByRole('complementary', { name: 'New rule' });
      await user.type(within(form).getByLabelText('Command'), 'typed-model');
      await user.selectOptions(modelSelect(form), 'Other model…');
      await user.type(within(form).getByRole('textbox', { name: 'Model name' }), '  my-gateway-model ');
      await user.click(within(form).getByRole('button', { name: 'Save rule' }));
      await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
      const saved = projectRules().find((r) => r.command === 'typed-model');
      expect(saved?.model).toBe('my-gateway-model');

      await user.click(screen.getByRole('button', { name: 'Edit rule /typed-model' }));
      const edit = await screen.findByRole('complementary', { name: 'Edit rule' });
      await waitFor(() => expect(modelSelect(edit)).toHaveDisplayValue('Other model…'));
      expect(within(edit).getByRole('textbox', { name: 'Model name' })).toHaveValue('my-gateway-model');
    });

    it('a new rule that keeps Default model is created with model null', async () => {
      const { user } = await renderRoute(`${rulesPage}?rule=new`, { scenario: builtin });
      const form = await screen.findByRole('complementary', { name: 'New rule' });
      await user.type(within(form).getByLabelText('Command'), 'follows-default');
      await user.click(within(form).getByRole('button', { name: 'Save rule' }));
      await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
      expect(projectRules().find((r) => r.command === 'follows-default')).toMatchObject({
        model: null,
        agentId: null,
      });
    });

    it('editing only the model sends only the model, and Default model sends null', async () => {
      ruleRow(ids.rule.r2).model = 'sonnet';
      const bodies = patchBodies();
      const { user } = await renderRoute(`${rulesPage}?rule=${ids.rule.r2}`, { scenario: builtin });
      const edit = await screen.findByRole('complementary', { name: 'Edit rule' });
      await waitFor(() => expect(modelSelect(edit)).toHaveDisplayValue('sonnet'));
      await user.selectOptions(modelSelect(edit), 'haiku');
      await user.click(within(edit).getByRole('button', { name: 'Save rule' }));
      await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
      expect(bodies).toEqual([{ model: 'haiku' }]);

      await user.click(screen.getByRole('button', { name: 'Edit rule /code-review' }));
      const again = await screen.findByRole('complementary', { name: 'Edit rule' });
      await user.selectOptions(modelSelect(again), 'Default model');
      await user.click(within(again).getByRole('button', { name: 'Save rule' }));
      await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
      expect(bodies.at(-1)).toEqual({ model: null });
      expect(ruleRow(ids.rule.r2).model).toBeNull();
    });

    it('an unchanged edit does not alter the model, even one missing from the list', async () => {
      ruleRow(ids.rule.r2).model = 'claude-dated-9999';
      const bodies = patchBodies();
      const { user } = await renderRoute(`${rulesPage}?rule=${ids.rule.r2}`, { scenario: builtin });
      const edit = await screen.findByRole('complementary', { name: 'Edit rule' });
      await waitFor(() => expect(modelSelect(edit)).toHaveDisplayValue('Other model…'));
      expect(within(edit).getByRole('textbox', { name: 'Model name' })).toHaveValue('claude-dated-9999');
      await user.type(within(edit).getByLabelText('Command'), '-x');
      await user.click(within(edit).getByRole('button', { name: 'Save rule' }));
      await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
      expect(bodies).toEqual([{ command: 'code-review-x' }]);
      expect(ruleRow(ids.rule.r2).model).toBe('claude-dated-9999');
    });

    it('Other model… left empty shows Enter a model name. and sends nothing', async () => {
      const { user } = await renderRoute(`${rulesPage}?rule=new`, { scenario: builtin });
      const form = await screen.findByRole('complementary', { name: 'New rule' });
      const posts = mockDb.requests('POST', `/api/projects/${projectId}/rules`);
      await user.type(within(form).getByLabelText('Command'), 'blank-model');
      await user.selectOptions(modelSelect(form), 'Other model…');
      await user.click(within(form).getByRole('button', { name: 'Save rule' }));
      const input = within(form).getByRole('textbox', { name: 'Model name' });
      await waitFor(() => expect(input).toHaveAccessibleDescription(/Enter a model name\./));
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(mockDb.requests('POST', `/api/projects/${projectId}/rules`)).toBe(posts);
    });

    it('a /model problem lands on the Model field', async () => {
      const { user } = await renderRoute(`${rulesPage}?rule=new`, {
        scenario: () => {
          builtin();
          scenarios.problem('rules.create', {
            status: 422,
            title: 'Unprocessable',
            errors: [{ pointer: '/model', detail: 'The provider does not know this model.' }],
          });
        },
      });
      const form = await screen.findByRole('complementary', { name: 'New rule' });
      await user.type(within(form).getByLabelText('Command'), 'bad-model');
      await user.selectOptions(modelSelect(form), 'Other model…');
      await user.type(within(form).getByRole('textbox', { name: 'Model name' }), 'nope-1');
      await user.click(within(form).getByRole('button', { name: 'Save rule' }));
      await waitFor(() =>
        expect(within(form).getByRole('textbox', { name: 'Model name' })).toHaveAccessibleDescription(
          /The provider does not know this model\./,
        ),
      );
      expect(within(form).queryByRole('alert')).toBeNull();
    });

    it.each([
      [
        'with the agent message and the generic one',
        [
          { pointer: '/agentId', detail: 'That agent is gone.' },
          { pointer: '/x', detail: 'Other.' },
        ],
      ],
      ['with only /agentId', [{ pointer: '/agentId', detail: 'That agent is gone.' }]],
    ])('an /agentId problem %s shows in the form banner, not on a field', async (_name, errors) => {
      const { user } = await renderRoute(`${rulesPage}?rule=new`, {
        scenario: () => {
          builtin();
          scenarios.problem('rules.create', { status: 422, title: 'Unprocessable', errors });
        },
      });
      const form = await screen.findByRole('complementary', { name: 'New rule' });
      await user.type(within(form).getByLabelText('Command'), 'gone-agent');
      await user.click(within(form).getByRole('button', { name: 'Save rule' }));
      expect(await within(form).findByRole('alert')).toHaveTextContent('That agent is gone.');
      expect(within(form).getByLabelText('Command')).not.toHaveAttribute('aria-invalid', 'true');
      expect(modelSelect(form)).not.toHaveAttribute('aria-invalid', 'true');
    });

    it('a failing model list shows the error note and Other model… still works', async () => {
      const { user } = await renderRoute(`${rulesPage}?rule=new`, {
        scenario: () => scenarios.agentModels(ids.agent.invoicerApi, { kind: 'error' }),
      });
      const form = await screen.findByRole('complementary', { name: 'New rule' });
      expect(await within(form).findByText(/The model list could not be loaded\./)).toBeInTheDocument();
      await user.selectOptions(modelSelect(form), 'Other model…');
      await user.type(within(form).getByRole('textbox', { name: 'Model name' }), 'typed-anyway');
      expect(within(form).getByRole('textbox', { name: 'Model name' })).toHaveValue('typed-anyway');
    });

    it('a loading model list shows the loading note', async () => {
      await renderRoute(`${rulesPage}?rule=new`, {
        scenario: () => scenarios.agentModels(ids.agent.invoicerApi, { kind: 'pending' }),
      });
      const form = await screen.findByRole('complementary', { name: 'New rule' });
      expect(await within(form).findByText('Loading models…')).toBeInTheDocument();
    });

    it('the rules list row and the sentence show the model after the agent', async () => {
      ruleRow(ids.rule.r1).model = 'claude-secret-model-1';
      const { user } = await renderRoute(rulesPage, { scenario: builtin });
      const row = await screen.findByRole('button', { name: 'Edit rule /code-build' });
      expect(row).toHaveTextContent('Claude(claude-secret-model-1)');
      await user.click(row);
      const edit = await screen.findByRole('complementary', { name: 'Edit rule' });
      expect(within(edit).getAllByText(/When/)[0]).toHaveTextContent('with agent Claude(claude-secret-model-1)');
    });
  });

  describe('paging', () => {
    const ruleId = (n: number) => ids.created(500 + n);
    const commandOf = (n: number) => `rule-${String(n).padStart(2, '0')}`;
    /** Replaces the project's rules with `total` rules, rule-01 created first. */
    function seedRules(total: number) {
      const template = ruleRow(ids.rule.r1);
      mockDb.state.rules = [
        ...mockDb.state.rules.filter((r) => r.projectId !== projectId),
        ...Array.from({ length: total }, (_, i) => ({
          ...template,
          id: ruleId(i + 1),
          command: commandOf(i + 1),
          skillName: 'code-build',
          enabled: true,
        })),
      ];
    }
    const rows = () => screen.queryAllByRole('switch', { name: /^Enable rule \// });
    const nav = () => screen.getByRole('navigation', { name: 'Pagination' });
    const page2 = async (user: Awaited<ReturnType<typeof renderRoute>>['user']) => {
      const [button] = screen.getAllByRole('button', { name: 'Page 2' });
      if (!button) throw new Error('no Page 2 button');
      await user.click(button);
    };
    const cachedPages = (queryClient: Awaited<ReturnType<typeof renderRoute>>['queryClient']) =>
      queryClient.getQueriesData<Page<RuleDto>>({
        queryKey: ['org', 'alice', 'projects', projectId, 'desk', 'rules'],
      });
    const enabledIn = (pages: [unknown, Page<RuleDto> | undefined][], id: string) =>
      pages.flatMap(([, page]) => page?.items.filter((r) => r.id === id).map((r) => r.enabled) ?? []);

    it('24 rules: 20 rows and "Showing 1–20 of 24", the control after the guards, outside the list; Page 2 shows 4 rows', async () => {
      seedRules(24);
      const { user } = await renderRoute(rulesPage);
      await screen.findByRole('navigation', { name: 'Pagination' });
      expect(rows()).toHaveLength(20);
      expect(nav()).toHaveTextContent('Showing 1–20 of 24');
      const guards = screen.getByText('Guards on every rule');
      expect(nav().compareDocumentPosition(guards) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
      expect(screen.getByRole('region', { name: 'Rules list' })).not.toContainElement(nav());
      await page2(user);
      await waitFor(() => expect(rows()).toHaveLength(4));
      expect(nav()).toHaveTextContent('Showing 21–24 of 24');
    });

    it('while page 2 is held, the control still reads "Showing 1–20" with Page 1 current; then the new range', async () => {
      seedRules(24);
      const { user } = await renderRoute(rulesPage);
      await screen.findByRole('navigation', { name: 'Pagination' });
      const rulesApi = `/api/projects/${projectId}/rules`;
      const page2Body = await (await fetch(`http://localhost:3000${rulesApi}?page=2&pageSize=20`)).json();
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        http.get(`*${rulesApi}`, async ({ request }) => {
          if (new URL(request.url).searchParams.get('page') !== '2') return undefined;
          await held;
          return HttpResponse.json(page2Body);
        }),
      );
      await page2(user);
      await waitFor(() => expect(nav()).toHaveAttribute('aria-busy', 'true'));
      expect(rows()).toHaveLength(20);
      expect(nav()).toHaveTextContent('Showing 1–20 of 24');
      expect(within(nav()).getAllByRole('button', { name: 'Page 1' })[0]).toHaveAttribute('aria-current', 'page');
      release();
      await waitFor(() => expect(nav()).toHaveAttribute('aria-busy', 'false'));
      expect(nav()).toHaveTextContent('Showing 21–24 of 24');
      expect(within(nav()).getAllByRole('button', { name: 'Page 2' })[0]).toHaveAttribute('aria-current', 'page');
    });

    it('Review Focus 1: deleting the only rule on page 2 lands on page 1 with its rules', async () => {
      seedRules(21);
      const { router, user } = await renderRoute(`${rulesPage}?page=2`);
      await screen.findByRole('switch', { name: `Enable rule /${commandOf(21)}` });
      expect(rows()).toHaveLength(1);
      await user.click(screen.getByRole('button', { name: `More actions for /${commandOf(21)}` }));
      await user.click(
        within(screen.getByRole('dialog', { name: `Actions for /${commandOf(21)}` })).getByRole('button', {
          name: 'Delete',
        }),
      );
      await waitFor(() => expect(rows()).toHaveLength(20));
      expect(router.state.location.search).toEqual({});
      expect(screen.queryByText(/No routing rules/)).toBeNull();
    });

    it('Review Focus 5: a toggle on page 2 flips that rule in its page and the whole set; a late failure reverts only it', async () => {
      seedRules(24);
      // Rule 22 is on page 2; opening it from page 1 reads the whole set, so both copies are cached.
      scriptUpdates({ 1: { outcome: 'fail', delayMs: 80 }, 2: { outcome: 'ok', delayMs: 0 } });
      const { user, queryClient } = await renderRoute(`${rulesPage}?rule=${ruleId(22)}`);
      await screen.findByRole('navigation', { name: 'Pagination' });
      await page2(user);
      await waitFor(() => expect(rows()).toHaveLength(4));
      expect(cachedPages(queryClient).length).toBeGreaterThanOrEqual(3);

      await user.click(toggleFor(commandOf(22)));
      expect(toggleFor(commandOf(22))).toHaveAttribute('aria-checked', 'false');
      expect(enabledIn(cachedPages(queryClient), ruleId(22)).length).toBeGreaterThanOrEqual(2);
      expect(enabledIn(cachedPages(queryClient), ruleId(22)).every((e) => !e)).toBe(true);
      await user.click(toggleFor(commandOf(23)));
      await waitFor(() => expect(ruleRow(ruleId(23)).enabled).toBe(false));

      expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
      await waitFor(() => expect(toggleFor(commandOf(22))).toHaveAttribute('aria-checked', 'true'));
      expect(enabledIn(cachedPages(queryClient), ruleId(22)).every((e) => e)).toBe(true);
      expect(enabledIn(cachedPages(queryClient), ruleId(23)).every((e) => !e)).toBe(true);
      expect(toggleFor(commandOf(23))).toHaveAttribute('aria-checked', 'false');
    });

    it('?rule=<rule 22> with no page opens its editor although it is not on page 1', async () => {
      seedRules(24);
      await renderRoute(`${rulesPage}?rule=${ruleId(22)}`);
      const edit = await screen.findByRole('complementary', { name: 'Edit rule' });
      expect(within(edit).getByLabelText('Command')).toHaveValue(commandOf(22));
      expect(rows()).toHaveLength(20);
    });

    it('opening a rule keeps the page in the address', async () => {
      seedRules(24);
      const { router, user } = await renderRoute(`${rulesPage}?page=2`);
      await user.click(await screen.findByRole('button', { name: `Edit rule /${commandOf(21)}` }));
      await screen.findByRole('complementary', { name: 'Edit rule' });
      expect(router.state.location.search).toEqual({ page: '2', rule: ruleId(21) });
      await user.click(within(pane('Edit rule')).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(router.state.location.search).toEqual({ page: '2' }));
    });
  });
});

describe('rule agent', () => {
  const agentSelect = (root: HTMLElement) => within(root).getByRole('combobox', { name: 'With agent' });
  const optionNames = (select: HTMLElement) =>
    within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
  // The scenario seeds these fixtures (ids included) into the project.
  const agentNamed = (name: string) => {
    const found = agentsFixture.find((a) => a.name === name);
    if (!found) throw new Error(`agent ${name} is not a fixture`);
    return found;
  };
  const withAgents = () => scenarios.agents('deleteBlocked');
  const bodies = (method: 'post' | 'patch') => {
    const seen: unknown[] = [];
    const handler = async ({ request }: { request: Request }) => {
      seen.push(await request.clone().json());
      return undefined;
    };
    server.use(
      method === 'post'
        ? http.post('*/api/projects/:projectId/rules', handler)
        : http.patch('*/api/rules/:ruleId', handler),
    );
    return seen;
  };

  it("BR-32: the select offers Project default and only this project's agents", async () => {
    await renderRoute(`${rulesPage}?rule=new`, { scenario: withAgents });
    const form = await screen.findByRole('complementary', { name: 'New rule' });
    const mine = mockDb.state.agents.filter((a) => a.projectId === projectId);
    expect(mockDb.state.agents.length).toBeGreaterThan(mine.length);
    await waitFor(() => expect(optionNames(agentSelect(form))).toHaveLength(mine.length + 1));
    expect(optionNames(agentSelect(form))).toEqual(['Project default (Claude - Personal)', ...mine.map((a) => a.name)]);
    expect(agentSelect(form)).toHaveValue('');
  });

  it('BR-33: saving Project default on a rule that names an agent sends agentId null', async () => {
    const sent = bodies('patch');
    const { user } = await renderRoute(`${rulesPage}?rule=${ids.rule.r2}`, { scenario: withAgents });
    const edit = await screen.findByRole('complementary', { name: 'Edit rule' });
    await waitFor(() => expect(optionNames(agentSelect(edit)).length).toBeGreaterThan(1));
    await user.selectOptions(agentSelect(edit), '');
    await user.click(within(edit).getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    expect(sent).toEqual([{ agentId: null }]);
    expect(ruleRow(ids.rule.r2).agentId).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit rule /code-review' })).toHaveTextContent(
      'with the project default agent',
    );
  });

  it('BR-33: a new rule that picks an agent saves it, and reopening shows that agent', async () => {
    const codex = agentNamed('Codex');
    const sent = bodies('post');
    const { user } = await renderRoute(`${rulesPage}?rule=new`, { scenario: withAgents });
    const form = await screen.findByRole('complementary', { name: 'New rule' });
    await waitFor(() => expect(optionNames(agentSelect(form)).length).toBeGreaterThan(1));
    await user.type(within(form).getByLabelText('Command'), 'use-codex');
    await user.selectOptions(agentSelect(form), codex.id);
    await user.click(within(form).getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    expect(sent).toEqual([expect.objectContaining({ command: 'use-codex', agentId: codex.id })]);
    await user.click(screen.getByRole('button', { name: 'Edit rule /use-codex' }));
    const edit = await screen.findByRole('complementary', { name: 'Edit rule' });
    expect(agentSelect(edit)).toHaveValue(codex.id);
    expect(screen.getByRole('button', { name: 'Edit rule /use-codex' })).toHaveTextContent('with Codex');
  });

  it('BR-34: changing the agent resets the model to Default model', async () => {
    const claude = agentNamed('Claude - Personal');
    const { user } = await renderRoute(`${rulesPage}?rule=${ids.rule.r2}`, {
      scenario: () => {
        withAgents();
        Object.assign(ruleRow(ids.rule.r2), { agentId: claude.id, model: 'sonnet' });
        scenarios.agentModels(claude.id, { kind: 'fallback', reason: 'empty' });
      },
    });
    const edit = await screen.findByRole('complementary', { name: 'Edit rule' });
    const model = () => within(edit).getByRole('combobox', { name: 'Model' });
    await waitFor(() => expect(model()).toHaveDisplayValue('sonnet'));
    await user.selectOptions(agentSelect(edit), agentNamed('Codex').id);
    await waitFor(() => expect(model()).toHaveDisplayValue('Default model'));
  });

  it('BR-40 to BR-42: a row warns for no credential or a rejected one, not for OpenCode with none', async () => {
    const names = ['Claude - New', 'Claude - Work', 'OpenCode - No sign-in'];
    await renderRoute(rulesPage, {
      scenario: () => {
        withAgents();
        const rules = mockDb.state.rules.filter((r) => r.projectId === projectId && r.enabled).slice(0, 3);
        rules.forEach((r, i) => (r.agentId = agentNamed(names[i] ?? '').id));
      },
    });
    await screen.findByRole('heading', { level: 1, name: 'Routing rules' });
    expect(
      screen.getByText('Claude - New has no working credential. Runs from this rule will fail.'),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText('Claude - Work has no working credential. Runs from this rule will fail.').length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/OpenCode - No sign-in has no working credential/)).toBeNull();
  });
});

describe('rule agent without the agent list', () => {
  const agentSelect = (root: HTMLElement) => within(root).getByRole('combobox', { name: 'With agent' });
  const claude = agentsFixture[0];
  const sentPatches = () => {
    const seen: unknown[] = [];
    server.use(
      http.patch('*/api/rules/:ruleId', async ({ request }) => {
        seen.push(await request.clone().json());
        return undefined;
      }),
    );
    return seen;
  };
  const agentRequests = () => {
    const seen: string[] = [];
    server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url);
      if (/\/agents(\/|$)/.test(url.pathname) && request.method === 'GET') seen.push(url.pathname);
    });
    return seen;
  };
  const readerOfRules = () =>
    server.use(
      http.get('*/api/me/access', () =>
        HttpResponse.json({
          userId: ids.user.alice,
          platformAdmin: false,
          assignments: [
            {
              roleKey: 'custom',
              scope: { type: 'org' },
              permissions: (['project:read', 'skill:read', 'rule:read', 'rule:update', 'rule:create'] as const).map(
                (permission) => ({ permission, condition: 'any' }),
              ),
            },
          ],
        }),
      ),
    );
  const editCommandAndSave = async (user: Awaited<ReturnType<typeof renderRoute>>['user'], root: HTMLElement) => {
    const command = within(root).getByLabelText('Command');
    await user.clear(command);
    await user.type(command, 'renamed');
    await user.click(within(root).getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
  };
  const withRuleAgent = (agentId: string) => () => {
    scenarios.agents('deleteBlocked');
    Object.assign(ruleRow(ids.rule.r2), { agentId });
  };

  it('a reader without agent:read never asks for the agents, locks the selector and keeps the rule agent on save', async () => {
    if (!claude) throw new Error('no agent fixture');
    readerOfRules();
    const requests = agentRequests();
    const sent = sentPatches();
    const { user } = await renderRoute(`${rulesPage}?rule=${ids.rule.r2}`, { scenario: withRuleAgent(claude.id) });
    const edit = await screen.findByRole('complementary', { name: 'Edit rule' });
    expect(agentSelect(edit)).toBeDisabled();
    expect(agentSelect(edit)).toHaveValue(claude.id);
    expect(within(edit).getByText('You can’t see the agent list. This rule keeps its agent.')).toBeInTheDocument();
    expect(within(edit).getByRole('option', { name: 'Unavailable agent' })).toBeInTheDocument();
    await editCommandAndSave(user, edit);
    expect(sent).toEqual([{ command: 'renamed' }]);
    expect(ruleRow(ids.rule.r2).agentId).toBe(claude.id);
    expect(requests).toEqual([]);
  });

  it('while the agents load the selector is disabled and a save does not send an agent', async () => {
    if (!claude) throw new Error('no agent fixture');
    server.use(http.get('*/api/projects/:projectId/agents', () => new Promise<Response>(() => undefined)));
    const sent = sentPatches();
    const { user } = await renderRoute(`${rulesPage}?rule=${ids.rule.r2}`, { scenario: withRuleAgent(claude.id) });
    const edit = await screen.findByRole('complementary', { name: 'Edit rule' });
    expect(agentSelect(edit)).toBeDisabled();
    expect(within(edit).getByRole('option', { name: 'Loading agents…' })).toBeInTheDocument();
    await editCommandAndSave(user, edit);
    expect(sent).toEqual([{ command: 'renamed' }]);
    expect(ruleRow(ids.rule.r2).agentId).toBe(claude.id);
  });

  it('while the agents load a row does not read Unavailable agent, then shows the real name', async () => {
    if (!claude) throw new Error('no agent fixture');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.get('*/api/projects/:projectId/agents', async () => {
        await gate;
        return undefined;
      }),
    );
    await renderRoute(rulesPage, { scenario: withRuleAgent(claude.id) });
    const row = await screen.findByRole('button', { name: 'Edit rule /code-review' });
    expect(row).not.toHaveTextContent('Unavailable agent');
    expect(row).not.toHaveTextContent(claude.id);
    release();
    await waitFor(() => expect(row).toHaveTextContent(claude.name));
  });

  it('a row whose agent is gone reads Unavailable agent once the list is ready', async () => {
    await renderRoute(rulesPage, { scenario: withRuleAgent('a0000000-0000-4000-8000-00000000dead') });
    const row = await screen.findByRole('button', { name: 'Edit rule /code-review' });
    await waitFor(() => expect(row).toHaveTextContent('Unavailable agent'));
  });

  it('a rule whose agent is gone keeps it as an unavailable choice, with no raw id, and saving keeps it', async () => {
    const goneId = 'a0000000-0000-4000-8000-00000000dead';
    const sent = sentPatches();
    const { user } = await renderRoute(`${rulesPage}?rule=${ids.rule.r2}`, { scenario: withRuleAgent(goneId) });
    const edit = await screen.findByRole('complementary', { name: 'Edit rule' });
    await waitFor(() => expect(within(edit).getByRole('option', { name: /\(unavailable\)$/ })).toBeInTheDocument());
    expect(agentSelect(edit)).toHaveValue(goneId);
    expect(within(edit).queryByText(new RegExp(goneId))).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit rule /code-review' })).not.toHaveTextContent(goneId);
    await editCommandAndSave(user, edit);
    expect(sent).toEqual([{ command: 'renamed' }]);
    expect(ruleRow(ids.rule.r2).agentId).toBe(goneId);
  });
});

describe('skill picker', () => {
  /** Replaces the project's skills with `total` skills named skill-001 and up. */
  function seedSkills(total: number) {
    mockDb.state.skills[projectId] = Array.from({ length: total }, (_, i) => {
      const name = `skill-${String(i + 1).padStart(3, '0')}`;
      return {
        name,
        description: `Skill ${i + 1}`,
        path: `.claude/skills/${name}/SKILL.md`,
        lastCommit: { sha: 'a91c3e2', message: 'Add skills', at: '2026-11-10T14:00:00.000Z' },
        body: `body ${i + 1}`,
        sha: `sha-${name}`,
      };
    });
  }
  /** The query strings of every skills list request while `run` is going. */
  async function skillListQueries(run: () => Promise<void>) {
    const queries: string[] = [];
    const listener = ({ request }: { request: Request }) => {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === `/api/projects/${projectId}/skills`) queries.push(url.search);
    };
    server.events.on('request:start', listener);
    try {
      await run();
    } finally {
      server.events.removeListener('request:start', listener);
    }
    return queries;
  }

  it.each([
    [25, 25],
    [101, 100],
  ])('%i skills: the picker offers %i, read with one pageSize=100 request', async (total, offered) => {
    seedSkills(total);
    let options = 0;
    const queries = await skillListQueries(async () => {
      await renderRoute(`${rulesPage}?rule=new`);
      const form = await screen.findByRole('complementary', { name: 'New rule' });
      options = within(within(form).getByRole('combobox', { name: 'Skill' })).getAllByRole('option').length;
    });
    expect(options).toBe(offered);
    expect(queries).toHaveLength(1);
    const q = new URLSearchParams(queries[0]);
    expect(q.get('pageSize')).toBe('100');
    expect(q.get('page')).toBe('1');
  });
});
