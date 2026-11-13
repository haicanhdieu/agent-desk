import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

const projectId = ids.project.invoicerApi;
const base = `/o/alice/p/${projectId}/desk`;
const skillsPath = `/api/projects/${projectId}/skills`;

function skillRow(name: string) {
  const skill = mockDb.state.skills[projectId]?.find((s) => s.name === name);
  if (!skill) throw new Error(`skill ${name} not in the mock store`);
  return skill;
}

/** Records the JSON bodies of PUT requests the app sends. */
function capturePuts() {
  const bodies: unknown[] = [];
  const listener = ({ request }: { request: Request }) => {
    if (request.method === 'PUT')
      void request
        .clone()
        .json()
        .then((b: unknown) => bodies.push(b));
  };
  server.events.on('request:start', listener);
  stopCapture = () => server.events.removeListener('request:start', listener);
  return bodies;
}
let stopCapture: (() => void) | undefined;
afterEach(() => {
  stopCapture?.();
  stopCapture = undefined;
});

describe('desk setup warning', () => {
  it('shows the warning above the Desk boards, with a link to Workspace setup, and nothing blocks', async () => {
    mockDb.state.setupTests.push({
      id: ids.created(901),
      projectId,
      status: 'failed',
      scriptSha256: 'a'.repeat(64),
      matchesCurrentScript: true,
      checkoutSha: null,
      plugins: { installed: [], skipped: [], failed: [] },
      exitCode: 1,
      startedBy: 'kim-hale',
      createdAt: '2026-11-12T09:00:00.000Z',
      finishedAt: '2026-11-12T09:01:00.000Z',
      endedAt: '2026-11-12T09:20:00.000Z',
      endsAt: null,
    });
    await renderRoute(`${base}/skills`);
    expect(await screen.findByText('The last workspace setup test failed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open workspace setup' })).toHaveAttribute('href', `${base}/setup`);
    expect(screen.getByRole('navigation', { name: 'Desk' })).toBeInTheDocument();
  });

  it('is not repeated on the Setup tab, which has its own last-test banner', async () => {
    await renderRoute(`${base}/setup`);
    await screen.findByText('Not tested yet');
    expect(screen.queryByText('The setup script has not passed a test yet')).toBeNull();
  });
});

describe('desk skills route', () => {
  it('lists the project skills with links that select them; the first opens by default', async () => {
    await renderRoute(`${base}/skills`);
    const nav = await screen.findByRole('navigation', { name: 'Skills' });
    for (const s of mockDb.state.skills[projectId] ?? []) {
      expect(within(nav).getByRole('link', { name: new RegExp(s.name) })).toHaveAttribute(
        'href',
        `${base}/skills?skill=${s.name}`,
      );
    }
    expect(within(nav).getByRole('link', { name: /code-build/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 2, name: 'code-build' })).toBeInTheDocument();
    expect(screen.getByLabelText('SKILL.md source')).toHaveValue(skillRow('code-build').body);
    // Rule summary from the rules that use the skill; last commit "sha, relative".
    expect(within(nav).getByRole('link', { name: /qa-e2e/ })).toHaveTextContent('1 rule, off');
    expect(screen.getByText('a91c3e2-code-build'.slice(0, 7))).toBeInTheDocument();
  });

  it('desk nav links point at the project routes', async () => {
    await renderRoute(`${base}/skills`);
    const desk = await screen.findByRole('navigation', { name: 'Desk' });
    expect(within(desk).getByRole('link', { name: /Skills/ })).toHaveAttribute('href', `${base}/skills`);
    expect(within(desk).getByRole('link', { name: /Routing rules/ })).toHaveAttribute('href', `${base}/rules`);
    expect(within(desk).getByRole('link', { name: /Agent & settings/ })).toHaveAttribute('href', `${base}/agent`);
    const tabs = screen.getByRole('navigation', { name: 'Project' });
    expect(within(tabs).getByRole('link', { name: /Runs/ })).toHaveAttribute('href', `/o/alice/p/${projectId}/runs`);
    expect(within(tabs).getByRole('link', { name: /Desk/ })).toHaveAttribute('href', `${base}/skills`);
    expect(screen.getByRole('link', { name: 'Agent Desk, all projects' })).toHaveAttribute('href', '/o/alice/projects');
  });

  it('?skill=code-review opens that skill', async () => {
    await renderRoute(`${base}/skills?skill=code-review`);
    expect(await screen.findByRole('heading', { level: 2, name: 'code-review' })).toBeInTheDocument();
    expect(screen.getByLabelText('SKILL.md source')).toHaveValue(skillRow('code-review').body);
    const nav = screen.getByRole('navigation', { name: 'Skills' });
    expect(within(nav).getByRole('link', { name: /code-review/ })).toHaveAttribute('aria-current', 'page');
  });

  it('clicking a skill in the list opens it', async () => {
    const { router, user } = await renderRoute(`${base}/skills`);
    const nav = await screen.findByRole('navigation', { name: 'Skills' });
    await user.click(within(nav).getByRole('link', { name: /code-e2e/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'code-e2e' })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ skill: 'code-e2e' });
  });

  it('an unknown ?skill falls back to the first skill', async () => {
    await renderRoute(`${base}/skills?skill=nope`);
    expect(await screen.findByRole('heading', { level: 2, name: 'code-build' })).toBeInTheDocument();
  });

  it('commit sends { body, message, sha } and the list refetches', async () => {
    const puts = capturePuts();
    const { user } = await renderRoute(`${base}/skills?skill=code-review`);
    const { sha, body: original } = skillRow('code-review');
    const editor = await screen.findByLabelText('SKILL.md source');
    await user.type(editor, '\nMore steps.');
    const message = screen.getByLabelText('Commit message');
    await user.clear(message);
    await user.type(message, 'code-review: more steps');
    const listBefore = mockDb.requests('GET', skillsPath);
    await user.click(screen.getByRole('button', { name: 'Commit to main' }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ body: `${original}\nMore steps.`, message: 'code-review: more steps', sha });
    await waitFor(() => expect(mockDb.requests('GET', skillsPath)).toBeGreaterThan(listBefore));
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
    expect(screen.getByLabelText('SKILL.md source')).toHaveValue(`${original}\nMore steps.`);
  });

  it('an empty commit message falls back to "Update <name> skill"', async () => {
    const puts = capturePuts();
    const { user } = await renderRoute(`${base}/skills?skill=code-review`);
    await user.type(await screen.findByLabelText('SKILL.md source'), 'x');
    await user.clear(screen.getByLabelText('Commit message'));
    await user.click(screen.getByRole('button', { name: 'Commit to main' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ message: 'Update code-review skill' });
  });

  it('a double click on Commit sends one commit', async () => {
    const puts = capturePuts();
    const { user } = await renderRoute(`${base}/skills?skill=code-review`);
    await user.type(await screen.findByLabelText('SKILL.md source'), 'x');
    const commit = screen.getByRole('button', { name: 'Commit to main' });
    // Two clicks before the first PUT answers.
    fireEvent.click(commit);
    fireEvent.click(commit);
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
    expect(puts).toHaveLength(1);
  });

  it('a stale sha (409) shows a toast and restarts the draft from the other change', async () => {
    const puts = capturePuts();
    const { user } = await renderRoute(`${base}/skills?skill=code-review`);
    const editor = await screen.findByLabelText('SKILL.md source');
    // Someone else commits after the page loaded.
    Object.assign(skillRow('code-review'), { sha: 'changed-elsewhere', body: 'their version' });
    await user.type(editor, '\nMine.');
    const detailBefore = mockDb.requests('GET', `${skillsPath}/code-review`);
    await user.click(screen.getByRole('button', { name: 'Commit to main' }));

    expect(await screen.findByText('Skill changed elsewhere — reload')).toBeInTheDocument();
    expect(mockDb.requests('GET', `${skillsPath}/code-review`)).toBeGreaterThan(detailBefore);
    await waitFor(() => expect(screen.getByLabelText('SKILL.md source')).toHaveValue('their version'));
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    expect(screen.getByRole('button', { name: 'Commit to main' })).toBeDisabled();
    expect(skillRow('code-review').body).toBe('their version');

    // A new edit commits on top of their version, with their sha.
    await user.type(screen.getByLabelText('SKILL.md source'), '!');
    await user.click(screen.getByRole('button', { name: 'Commit to main' }));
    await waitFor(() => expect(skillRow('code-review').body).toBe('their version!'));
    expect(puts.at(-1)).toMatchObject({ body: 'their version!', sha: 'changed-elsewhere' });
  });

  it('a background refetch with a newer sha keeps the draft on its base sha, so commit 409s', async () => {
    const puts = capturePuts();
    const { user, queryClient } = await renderRoute(`${base}/skills?skill=code-review`);
    const { sha: baseSha } = skillRow('code-review');
    await user.type(await screen.findByLabelText('SKILL.md source'), '\nMine.');
    Object.assign(skillRow('code-review'), { sha: 'changed-elsewhere', body: 'their version' });
    const detailBefore = mockDb.requests('GET', `${skillsPath}/code-review`);
    await queryClient.refetchQueries({ queryKey: ['org', 'alice', 'projects', projectId, 'desk', 'skill'] });
    expect(mockDb.requests('GET', `${skillsPath}/code-review`)).toBeGreaterThan(detailBefore);
    // The draft survives the refetch.
    expect(screen.getByLabelText('SKILL.md source')).toHaveDisplayValue(/Mine\./);

    await user.click(screen.getByRole('button', { name: 'Commit to main' }));
    expect(await screen.findByText('Skill changed elsewhere — reload')).toBeInTheDocument();
    expect(puts[0]).toMatchObject({ sha: baseSha });
    expect(skillRow('code-review').body).toBe('their version');
  });

  it('the delete dialog lists the rules using the skill, and confirming deletes it', async () => {
    const { router, user } = await renderRoute(`${base}/skills?skill=code-e2e`);
    await user.click(await screen.findByRole('button', { name: 'Delete skill' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete skill code-e2e?' });
    expect(within(dialog).getByText('/code-e2e')).toBeInTheDocument();
    expect(within(dialog).getByText(/uses this skill/)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/Type code-e2e to confirm/), 'code-e2e');
    await user.click(within(dialog).getByRole('button', { name: 'Delete and commit' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockDb.state.skills[projectId]?.some((s) => s.name === 'code-e2e')).toBe(false);
    const nav = screen.getByRole('navigation', { name: 'Skills' });
    await waitFor(() => expect(within(nav).queryByRole('link', { name: /code-e2e/ })).toBeNull());
    expect(router.state.location.search).toEqual({});
  });

  it('renders skill text as text, never as HTML', async () => {
    skillRow('code-build').description = '<img src=x onerror="alert(1)">';
    await renderRoute(`${base}/skills`);
    const nav = await screen.findByRole('navigation', { name: 'Skills' });
    expect(within(nav).getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('shows the empty state when the project has no skills', async () => {
    mockDb.state.skills[projectId] = [];
    await renderRoute(`${base}/skills`);
    expect(await screen.findByRole('heading', { name: /No skills yet/ })).toBeInTheDocument();
  });
});

describe('project layout', () => {
  it('an unknown project is not found', async () => {
    await renderRoute(`/o/alice/p/${ids.created(999)}/desk/skills`);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('a project id that is not a uuid is not found', async () => {
    await renderRoute('/o/alice/p/nope/desk/skills');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it("another org's project is not found", async () => {
    await renderRoute(`/o/alice/p/${ids.project.storefront}/desk/skills`);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it("403 shows You don't have access", async () => {
    scenarios.problem('projects.get', { status: 403, title: 'Forbidden', type: 'forbidden' });
    await renderRoute(`${base}/skills`);
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument();
  });

  it('a skills list failure shows retry', async () => {
    scenarios.serverError('skills.list');
    await renderRoute(`${base}/skills`);
    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
