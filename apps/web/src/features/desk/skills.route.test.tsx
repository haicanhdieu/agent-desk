import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
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

  it('History opens the selected skill file in the connected repo on its default branch', async () => {
    const { user } = await renderRoute(`${base}/skills`);
    const history = () => screen.getByRole('link', { name: 'History' });
    expect(history()).toHaveAttribute(
      'href',
      `https://github.com/harbor-labs/invoicer-api/blob/main/${skillRow('code-build').path}`,
    );

    const nav = await screen.findByRole('navigation', { name: 'Skills' });
    await user.click(within(nav).getByRole('link', { name: /code-e2e/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'code-e2e' })).toBeInTheDocument();
    expect(history()).toHaveAttribute(
      'href',
      `https://github.com/harbor-labs/invoicer-api/blob/main/${skillRow('code-e2e').path}`,
    );
  });

  it('desk nav links point at the project routes', async () => {
    await renderRoute(`${base}/skills`);
    const desk = await screen.findByRole('navigation', { name: 'Desk' });
    expect(within(desk).getByRole('link', { name: /Skills/ })).toHaveAttribute('href', `${base}/skills`);
    expect(within(desk).getByRole('link', { name: /Routing rules/ })).toHaveAttribute('href', `${base}/rules`);
    expect(within(desk).getByRole('link', { name: /Agent & settings/ })).toHaveAttribute('href', `${base}/agent`);
    const tabs = screen.getByRole('navigation', { name: 'Project sections' });
    expect(within(tabs).getByRole('link', { name: /Runs/ })).toHaveAttribute('href', `/o/alice/p/${projectId}/runs`);
    expect(within(tabs).getByRole('link', { name: 'Project settings' })).toHaveAttribute('href', `${base}/rules`);
    expect(screen.getByRole('link', { name: 'Agent Desk, all projects' })).toHaveAttribute('href', '/o/alice/projects');
  });

  it('lists Routing rules first in the Desk menu', async () => {
    await renderRoute(`${base}/skills`);
    const desk = await screen.findByRole('navigation', { name: 'Desk' });
    const labels = within(desk)
      .getAllByRole('link')
      .map((a) => a.textContent?.trim());
    expect(labels.slice(0, 2)).toEqual(['Routing rules', 'Skills']);
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
    await user.click(screen.getByRole('button', { name: 'Submit changes' }));

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
    await user.click(screen.getByRole('button', { name: 'Submit changes' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ message: 'Update code-review skill' });
  });

  it('a double click on Commit sends one commit', async () => {
    const puts = capturePuts();
    const { user } = await renderRoute(`${base}/skills?skill=code-review`);
    await user.type(await screen.findByLabelText('SKILL.md source'), 'x');
    const commit = screen.getByRole('button', { name: 'Submit changes' });
    // Two clicks before the first PUT answers.
    fireEvent.click(commit);
    fireEvent.click(commit);
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
    expect(puts).toHaveLength(1);
  });

  it('a stale sha (409) shows a toast and keeps the draft on its old sha, so it never overwrites the newer version', async () => {
    const puts = capturePuts();
    const { user } = await renderRoute(`${base}/skills?skill=code-review`);
    const editor = await screen.findByLabelText('SKILL.md source');
    const { sha: baseSha } = skillRow('code-review');
    // Someone else commits after the page loaded.
    Object.assign(skillRow('code-review'), { sha: 'changed-elsewhere', body: 'their version' });
    await user.type(editor, '\nMine.');
    const detailBefore = mockDb.requests('GET', `${skillsPath}/code-review`);
    await user.click(screen.getByRole('button', { name: 'Submit changes' }));

    expect(await screen.findByText('Skill changed elsewhere — reload')).toBeInTheDocument();
    await waitFor(() => expect(mockDb.requests('GET', `${skillsPath}/code-review`)).toBeGreaterThan(detailBefore));
    // The draft is kept, still marked unsaved.
    expect(screen.getByLabelText('SKILL.md source')).toHaveDisplayValue(/Mine\./);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    // Submitting again still carries the old sha, gets 409 again and never overwrites their version.
    await user.click(screen.getByRole('button', { name: 'Submit changes' }));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]).toMatchObject({ sha: baseSha });
    expect(screen.getByLabelText('SKILL.md source')).toHaveDisplayValue(/Mine\./);
    expect(skillRow('code-review').body).toBe('their version');
  });

  it('Discard after a stale 409 starts a fresh draft from the newer version and its sha', async () => {
    const puts = capturePuts();
    const { user } = await renderRoute(`${base}/skills?skill=code-review`);
    const editor = await screen.findByLabelText('SKILL.md source');
    Object.assign(skillRow('code-review'), { sha: 'changed-elsewhere', body: 'their version' });
    await user.type(editor, '\nMine.');
    const detailBefore = mockDb.requests('GET', `${skillsPath}/code-review`);
    await user.click(screen.getByRole('button', { name: 'Submit changes' }));
    await screen.findByText('Skill changed elsewhere — reload');
    await waitFor(() => expect(mockDb.requests('GET', `${skillsPath}/code-review`)).toBeGreaterThan(detailBefore));

    await user.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.getByLabelText('SKILL.md source')).toHaveValue('their version'));
    expect(screen.queryByText('Unsaved changes')).toBeNull();

    // A new edit commits on top of their version, with their sha.
    await user.type(screen.getByLabelText('SKILL.md source'), '!');
    await user.click(screen.getByRole('button', { name: 'Submit changes' }));
    await waitFor(() => expect(skillRow('code-review').body).toBe('their version!'));
    expect(puts.at(-1)).toMatchObject({ body: 'their version!', sha: 'changed-elsewhere' });
  });

  it('reopening the skill after a stale 409 starts a fresh draft from the newer version', async () => {
    const { user } = await renderRoute(`${base}/skills?skill=code-review`);
    const editor = await screen.findByLabelText('SKILL.md source');
    Object.assign(skillRow('code-review'), { sha: 'changed-elsewhere', body: 'their version' });
    await user.type(editor, '\nMine.');
    await user.click(screen.getByRole('button', { name: 'Submit changes' }));
    await screen.findByText('Skill changed elsewhere — reload');

    const nav = screen.getByRole('navigation', { name: 'Skills' });
    await user.click(within(nav).getByRole('link', { name: /code-e2e/ }));
    await screen.findByRole('heading', { level: 2, name: 'code-e2e' });
    await user.click(within(nav).getByRole('link', { name: /code-review/ }));
    await waitFor(() => expect(screen.getByLabelText('SKILL.md source')).toHaveValue('their version'));
    expect(screen.queryByText('Unsaved changes')).toBeNull();
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

    await user.click(screen.getByRole('button', { name: 'Submit changes' }));
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
    await user.click(within(dialog).getByRole('button', { name: 'Submit changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Skill code-e2e removed from main')).toBeInTheDocument();
    expect(mockDb.state.skills[projectId]?.some((s) => s.name === 'code-e2e')).toBe(false);
    const nav = screen.getByRole('navigation', { name: 'Skills' });
    await waitFor(() => expect(within(nav).queryByRole('link', { name: /code-e2e/ })).toBeNull());
    expect(router.state.location.search).toEqual({});
  });

  it('the delete dialog lists a rule beyond the first 20, from one whole-set read', async () => {
    const template = mockDb.state.rules.find((r) => r.projectId === projectId);
    if (!template) throw new Error('no seeded rule');
    mockDb.state.rules = [
      ...mockDb.state.rules.filter((r) => r.projectId !== projectId),
      ...Array.from({ length: 25 }, (_, i) => ({
        ...template,
        id: ids.created(600 + i),
        command: `rule-${String(i + 1).padStart(2, '0')}`,
        skillName: i === 22 ? 'code-e2e' : 'code-build',
      })),
    ];
    const reads: string[] = [];
    const listener = ({ request }: { request: Request }) => {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === `/api/projects/${projectId}/rules`) reads.push(url.search);
    };
    server.events.on('request:start', listener);
    try {
      const { user } = await renderRoute(`${base}/skills?skill=code-e2e`);
      await user.click(await screen.findByRole('button', { name: 'Delete skill' }));
      const dialog = await screen.findByRole('dialog', { name: 'Delete skill code-e2e?' });
      expect(within(dialog).getByText('/rule-23')).toBeInTheDocument();
    } finally {
      server.events.removeListener('request:start', listener);
    }
    expect(reads).toHaveLength(1);
    expect(new URLSearchParams(reads[0]).get('pageSize')).toBe('100');
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

describe('desk skills folders follow the default agent', () => {
  const setDefaultProvider = (provider: 'claude' | 'codex' | 'opencode') => {
    const row = mockDb.state.agents.find((a) => a.projectId === projectId && a.isDefault);
    if (!row) throw new Error('default agent missing');
    row.provider = provider;
  };

  it('a Codex project names .agents/skills/ in the list header and the empty state', async () => {
    setDefaultProvider('codex');
    mockDb.state.skills[projectId] = [];
    await renderRoute(`${base}/skills`);
    const empty = await screen.findByRole('heading', { name: /No skills yet/ });
    expect(screen.getByText('.agents/skills/ on main')).toBeInTheDocument();
    expect(empty.parentElement).toHaveTextContent('under .agents/skills/');
    expect(empty.parentElement).not.toHaveTextContent('.claude/skills/');
  });

  it('an OpenCode project names its folder first, then .agents/skills/', async () => {
    setDefaultProvider('opencode');
    await renderRoute(`${base}/skills`);
    expect(await screen.findByText('.opencode/skills/, .agents/skills/ on main')).toBeInTheDocument();
  });

  it('names no folder while the agent list loads, then the default agent folders', async () => {
    setDefaultProvider('codex');
    mockDb.state.skills[projectId] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('*/api/projects/:projectId/agents', async () => {
        await gate;
        return undefined;
      }),
    );
    await renderRoute(`${base}/skills`);
    const empty = await screen.findByRole('heading', { name: /No skills yet/ });
    expect(screen.getByText('Skill folders on main')).toBeInTheDocument();
    expect(empty.parentElement).toHaveTextContent("under the project's skill folders");
    expect(screen.queryByText(/claude\/skills/)).toBeNull();
    release();
    expect(await screen.findByText('.agents/skills/ on main')).toBeInTheDocument();
    expect(empty.parentElement).not.toHaveTextContent('.claude/skills/');
  });

  it('a Claude project names .claude/skills/ only', async () => {
    await renderRoute(`${base}/skills`);
    expect(await screen.findByText('.claude/skills/ on main')).toBeInTheDocument();
  });
});

describe('desk skills submit and review', () => {
  const edit = async (user: Awaited<ReturnType<typeof renderRoute>>['user'], text = '\nMore steps.') => {
    await user.type(await screen.findByLabelText('SKILL.md source'), text);
  };

  it('the commit bar targets the project default branch and offers Submit changes', async () => {
    await renderRoute(`${base}/skills?skill=code-review`);
    expect(await screen.findByText('Target')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit changes' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Commit to/ })).toBeNull();
    const row = mockDb.state.projects.find((p) => p.id === projectId);
    if (!row) throw new Error('project missing');
    expect(row.defaultBranch).toBe('main');
  });

  it('a direct commit says Skill saved to main and refreshes the skill', async () => {
    const { user } = await renderRoute(`${base}/skills?skill=code-review`);
    await edit(user);
    await user.click(screen.getByRole('button', { name: 'Submit changes' }));
    expect(await screen.findByText('Skill saved to main')).toBeInTheDocument();
    expect(screen.queryByText('Changes submitted for review')).toBeNull();
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
  });

  it('shows Submitting… and keeps the draft when the submission fails', async () => {
    scenarios.serverError('skills.put', { delayMs: 150 });
    const { user } = await renderRoute(`${base}/skills?skill=code-review`);
    await edit(user);
    const draft = (screen.getByLabelText('SKILL.md source') as HTMLTextAreaElement).value;
    await user.click(screen.getByRole('button', { name: 'Submit changes' }));
    expect(await screen.findByRole('button', { name: 'Submitting…' })).toBeDisabled();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Changes submitted for review')).toBeNull();
    expect(screen.queryByRole('link', { name: /View change request/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Submit changes' })).toBeEnabled();
    expect(screen.getByLabelText('SKILL.md source')).toHaveValue(draft);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  describe('when the default branch needs review', () => {
    it('submitting an edit shows the change request link and branches, keeps the draft and changes nothing live', async () => {
      scenarios.skillReviewRequired();
      const { user } = await renderRoute(`${base}/skills?skill=code-review`);
      const before = { ...skillRow('code-review') };
      await edit(user);
      const draft = (screen.getByLabelText('SKILL.md source') as HTMLTextAreaElement).value;
      const detailBefore = mockDb.requests('GET', `${skillsPath}/code-review`);
      await user.click(screen.getByRole('button', { name: 'Submit changes' }));

      expect(await screen.findByText('Changes submitted for review')).toBeInTheDocument();
      const link = screen.getByRole('link', { name: /View change request/ });
      expect(link).toHaveAttribute('href', expect.stringMatching(/^https:\/\//));
      expect(link).toHaveAttribute('target', '_blank');
      expect(screen.getByRole('status')).toHaveTextContent(/agent-desk\/skill-update-code-review-\d+ → main/);
      expect(screen.queryByText('Skill saved to main')).toBeNull();
      // Pending, not live: the draft stays, the stored skill is untouched and nothing was refetched.
      expect(screen.getByLabelText('SKILL.md source')).toHaveValue(draft);
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
      expect(skillRow('code-review')).toEqual(before);
      expect(mockDb.requests('GET', `${skillsPath}/code-review`)).toBe(detailBefore);
    });

    it('deleting shows Deletion submitted for review, keeps the skill listed and closes the dialog', async () => {
      scenarios.skillReviewRequired();
      const { user, router } = await renderRoute(`${base}/skills?skill=code-e2e`);
      await user.click(await screen.findByRole('button', { name: 'Delete skill' }));
      const dialog = await screen.findByRole('dialog', { name: 'Delete skill code-e2e?' });
      await user.type(within(dialog).getByLabelText(/Type code-e2e to confirm/), 'code-e2e');
      await user.click(within(dialog).getByRole('button', { name: 'Submit changes' }));

      expect(await screen.findByText('Deletion submitted for review')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /View change request/ })).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(mockDb.state.skills[projectId]?.some((s) => s.name === 'code-e2e')).toBe(true);
      const nav = screen.getByRole('navigation', { name: 'Skills' });
      expect(within(nav).getByRole('link', { name: /code-e2e/ })).toBeInTheDocument();
      expect(router.state.location.search).toEqual({ skill: 'code-e2e' });
    });

    it('a stale edit shows the reload message, no review notice, and keeps the draft', async () => {
      scenarios.skillReviewRequired();
      const { user } = await renderRoute(`${base}/skills?skill=code-review`);
      await screen.findByLabelText('SKILL.md source');
      Object.assign(skillRow('code-review'), { sha: 'changed-elsewhere', body: 'their version' });
      await edit(user);
      await user.click(screen.getByRole('button', { name: 'Submit changes' }));

      expect(await screen.findByText('Skill changed elsewhere — reload')).toBeInTheDocument();
      expect(screen.queryByText('Changes submitted for review')).toBeNull();
      expect(screen.queryByRole('link', { name: /View change request/ })).toBeNull();
      expect(screen.getByLabelText('SKILL.md source')).toHaveDisplayValue(/More steps/);
    });

    it('a failed later submit clears the earlier submitted notice', async () => {
      scenarios.skillReviewRequired();
      const { user } = await renderRoute(`${base}/skills?skill=code-review`);
      await edit(user);
      await user.click(screen.getByRole('button', { name: 'Submit changes' }));
      await screen.findByText('Changes submitted for review');
      scenarios.serverError('skills.put');
      await user.click(screen.getByRole('button', { name: 'Submit changes' }));
      await screen.findByRole('alert');
      expect(screen.queryByText('Changes submitted for review')).toBeNull();
      expect(screen.queryByRole('link', { name: /View change request/ })).toBeNull();
    });

    it('opening another skill clears the notice', async () => {
      scenarios.skillReviewRequired();
      const { user } = await renderRoute(`${base}/skills?skill=code-review`);
      await edit(user);
      await user.click(screen.getByRole('button', { name: 'Submit changes' }));
      await screen.findByText('Changes submitted for review');
      const nav = screen.getByRole('navigation', { name: 'Skills' });
      await user.click(within(nav).getByRole('link', { name: /code-e2e/ }));
      await screen.findByRole('heading', { level: 2, name: 'code-e2e' });
      expect(screen.queryByText('Changes submitted for review')).toBeNull();
    });
  });

  it('a failed delete keeps the dialog open with a toast and no success state', async () => {
    scenarios.serverError('skills.remove');
    const { user } = await renderRoute(`${base}/skills?skill=code-e2e`);
    await user.click(await screen.findByRole('button', { name: 'Delete skill' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete skill code-e2e?' });
    await user.type(within(dialog).getByLabelText(/Type code-e2e to confirm/), 'code-e2e');
    await user.click(within(dialog).getByRole('button', { name: 'Submit changes' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Delete skill code-e2e?' })).toBeInTheDocument();
    expect(screen.queryByText('Deletion submitted for review')).toBeNull();
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

describe('desk skills paging', () => {
  const nameOf = (n: number) => `skill-${String(n).padStart(2, '0')}`;
  /** Replaces the project's skills with `total` skills, skill-01 first. */
  function seedSkills(total: number) {
    mockDb.state.skills[projectId] = Array.from({ length: total }, (_, i) => ({
      name: nameOf(i + 1),
      description: `Skill ${i + 1}`,
      path: `.claude/skills/${nameOf(i + 1)}/SKILL.md`,
      lastCommit: { sha: 'a91c3e2', message: 'Add skills', at: '2026-11-10T14:00:00.000Z' },
      body: `body of ${nameOf(i + 1)}`,
      sha: `sha-${nameOf(i + 1)}`,
    }));
  }
  const listed = () => within(screen.getByRole('navigation', { name: 'Skills' })).getAllByRole('link');

  it('22 skills: 20 in the list with the control under it; Page 2 shows 2 and the open skill stays in the editor', async () => {
    seedSkills(22);
    const { user } = await renderRoute(`${base}/skills`);
    const pagination = await screen.findByRole('navigation', { name: 'Pagination' });
    expect(listed()).toHaveLength(20);
    expect(pagination).toHaveTextContent('Showing 1–20 of 22');
    expect(
      screen.getByRole('navigation', { name: 'Skills' }).compareDocumentPosition(pagination) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const [page2] = screen.getAllByRole('button', { name: 'Page 2' });
    if (!page2) throw new Error('no Page 2 button');
    await user.click(page2);
    await waitFor(() => expect(listed()).toHaveLength(2));
    expect(listed().map((a) => a.textContent)).toEqual([
      expect.stringContaining(nameOf(21)),
      expect.stringContaining(nameOf(22)),
    ]);
    expect(screen.getByRole('heading', { level: 2, name: nameOf(1) })).toBeInTheDocument();
    expect(screen.getByLabelText('SKILL.md source')).toHaveValue(`body of ${nameOf(1)}`);
  });

  it('while page 2 is held, the control still reads "Showing 1–20" with Page 1 current; then the new range', async () => {
    seedSkills(22);
    const { user } = await renderRoute(`${base}/skills`);
    const pagination = await screen.findByRole('navigation', { name: 'Pagination' });
    const page2Body = await (await fetch(`http://localhost:3000${skillsPath}?page=2&pageSize=20`)).json();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`*${skillsPath}`, async ({ request }) => {
        if (new URL(request.url).searchParams.get('page') !== '2') return undefined;
        await held;
        return HttpResponse.json(page2Body);
      }),
    );
    const [page2] = screen.getAllByRole('button', { name: 'Page 2' });
    if (!page2) throw new Error('no Page 2 button');
    await user.click(page2);
    await waitFor(() => expect(pagination).toHaveAttribute('aria-busy', 'true'));
    expect(listed()).toHaveLength(20);
    expect(pagination).toHaveTextContent('Showing 1–20 of 22');
    expect(within(pagination).getAllByRole('button', { name: 'Page 1' })[0]).toHaveAttribute('aria-current', 'page');
    release();
    await waitFor(() => expect(pagination).toHaveAttribute('aria-busy', 'false'));
    expect(pagination).toHaveTextContent('Showing 21–22 of 22');
    expect(within(pagination).getAllByRole('button', { name: 'Page 2' })[0]).toHaveAttribute('aria-current', 'page');
  });

  it('?skill=<the 22nd skill> with no page opens it in the editor although it is not on page 1', async () => {
    seedSkills(22);
    await renderRoute(`${base}/skills?skill=${nameOf(22)}`);
    expect(await screen.findByRole('heading', { level: 2, name: nameOf(22) })).toBeInTheDocument();
    expect(screen.getByLabelText('SKILL.md source')).toHaveValue(`body of ${nameOf(22)}`);
    expect(listed()).toHaveLength(20);
  });

  it('?page=4 with 22 skills goes to ?page=2', async () => {
    seedSkills(22);
    const { router } = await renderRoute(`${base}/skills?page=4`);
    await waitFor(() => expect(router.state.location.search).toEqual({ page: '2' }));
    await waitFor(() => expect(listed()).toHaveLength(2));
  });
});
