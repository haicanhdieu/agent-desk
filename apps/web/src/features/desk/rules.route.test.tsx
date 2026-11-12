import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
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
    expect(screen.getByRole('link', { name: 'Change' })).toHaveAttribute('href', `${base}/desk/agent`);
    expect(screen.getByRole('link', { name: 'Runs, Ignored' })).toHaveAttribute('href', `${base}/runs`);
    expect(screen.queryByRole('complementary')).toBeNull();
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
});
