import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  agentKindViews,
  agentPaneAgents,
  agentRowViews,
  connections,
  deskFrame,
  orgSwitchFixtures,
  rules,
  skills,
} from '@/mocks';
import { DeskSkills } from './DeskSkills';
import { DeskRules } from './DeskRules';
import { DeskAgent } from './DeskAgent';
import { vi } from 'vitest';
import { toModelList, type PaginationProps } from '@/components';
import { agentModelsFixtures } from '@/mocks/dto/agentModels';

const skillNames = skills.map((s) => s.name);
const github = [{ term: 'Repository', value: 'harbor-labs/invoicer-api' }];

describe('DeskSkills', () => {
  it('has exactly one main and the editor for the active skill', () => {
    render(<DeskSkills frame={deskFrame} skills={skills} activeName="code-build" />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'code-build' })).toBeInTheDocument();
    expect(screen.getByLabelText('SKILL.md source')).toHaveValue(skills[0].body);
    expect(screen.getByRole('link', { name: /code-build/ })).toHaveAttribute('aria-current', 'page');
  });

  it('empty skills shows the empty state pointing to starter templates', () => {
    render(<DeskSkills frame={deskFrame} skills={[]} />);
    expect(screen.getByRole('heading', { name: /No skills yet/ })).toBeInTheDocument();
    expect(screen.getByText(/starter templates/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('SKILL.md source')).toBeNull();
  });

  it('the empty state names no folder until the folders are known', () => {
    const { rerender } = render(<DeskSkills frame={deskFrame} skills={[]} />);
    expect(screen.getByText(/under the project's skill folders/)).toBeInTheDocument();
    expect(screen.queryByText(/claude\/skills/)).toBeNull();
    rerender(<DeskSkills frame={deskFrame} skills={[]} folders={['.agents/skills']} />);
    expect(screen.getByText('.agents/skills/')).toBeInTheDocument();
  });

  it('dirty shows Unsaved changes and enables Submit changes; otherwise disabled', () => {
    const { rerender } = render(<DeskSkills frame={deskFrame} skills={skills} activeName="code-build" dirty />);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit changes' })).toBeEnabled();
    rerender(<DeskSkills frame={deskFrame} skills={skills} activeName="code-build" />);
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    expect(screen.getByRole('button', { name: 'Submit changes' })).toBeDisabled();
  });

  const radio = (name: string) =>
    within(screen.getByRole('radiogroup', { name: 'Editor view' })).getByRole('radio', { name });
  const codeBuild = skills[0];

  it('Preview shows the draft as formatted Markdown with no editable source', async () => {
    render(<DeskSkills frame={deskFrame} skills={skills} activeName="code-build" />);
    expect(radio('Edit')).toBeChecked();
    await userEvent.click(radio('Preview'));
    const region = await screen.findByRole('region', { name: 'Skill preview' });
    expect(within(region).getByRole('heading', { name: 'Build a user story' })).toBeInTheDocument();
    expect(screen.queryByLabelText('SKILL.md source')).toBeNull();
  });

  it("Diff lists the draft's changes against main and is read-only", async () => {
    render(<DeskSkills frame={deskFrame} skills={skills} activeName="code-build" />);
    await userEvent.type(screen.getByLabelText('SKILL.md source'), 'x');
    await userEvent.click(radio('Diff'));
    const region = screen.getByRole('region', { name: 'Changes against main' });
    expect(region.querySelector('[data-kind="del"]')).not.toBeNull();
    expect(region.querySelector('[data-kind="add"]')).not.toBeNull();
    expect(screen.queryByLabelText('SKILL.md source')).toBeNull();
  });

  it('Diff with no edits shows "No changes. The editor matches main."', async () => {
    render(<DeskSkills frame={deskFrame} skills={skills} activeName="code-build" />);
    await userEvent.click(radio('Diff'));
    expect(screen.getByText('No changes. The editor matches main.')).toBeInTheDocument();
  });

  it('switching Edit -> Preview -> Diff -> Edit keeps the draft', async () => {
    render(<DeskSkills frame={deskFrame} skills={skills} activeName="code-build" />);
    await userEvent.type(screen.getByLabelText('SKILL.md source'), 'x');
    await userEvent.click(radio('Preview'));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await userEvent.click(radio('Diff'));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await userEvent.click(radio('Edit'));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByLabelText('SKILL.md source')).toHaveValue(`${codeBuild.body}x`);
  });

  it('Commit sends the draft from Preview and from Diff', async () => {
    const onCommit = vi.fn();
    render(
      <DeskSkills frame={deskFrame} skills={skills} activeName="code-build" commitMessage="msg" onCommit={onCommit} />,
    );
    await userEvent.type(screen.getByLabelText('SKILL.md source'), 'x');
    await userEvent.click(radio('Preview'));
    await userEvent.click(screen.getByRole('button', { name: 'Submit changes' }));
    expect(onCommit).toHaveBeenLastCalledWith(`${codeBuild.body}x`, 'msg');
    await userEvent.click(radio('Diff'));
    await userEvent.click(screen.getByRole('button', { name: 'Submit changes' }));
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenLastCalledWith(`${codeBuild.body}x`, 'msg');
  });

  it('a failed preview leaves Diff, Discard and Commit usable', async () => {
    const onCommit = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <DeskSkills
        frame={deskFrame}
        skills={skills}
        activeName="code-build"
        commitMessage="msg"
        onCommit={onCommit}
        preview={{ load: () => Promise.reject(new Error('x')) }}
      />,
    );
    await userEvent.type(screen.getByLabelText('SKILL.md source'), 'x');
    await userEvent.click(radio('Preview'));
    expect(await screen.findByText('Could not show the preview')).toBeInTheDocument();
    await userEvent.click(radio('Diff'));
    expect(
      screen.getByRole('region', { name: 'Changes against main' }).querySelector('[data-kind="add"]'),
    ).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Submit changes' }));
    expect(onCommit).toHaveBeenCalledWith(`${codeBuild.body}x`, 'msg');
  });

  it('initialDraft starts the draft from the given text', () => {
    render(<DeskSkills frame={deskFrame} skills={skills} activeName="code-build" initialDraft="# Changed" />);
    expect(screen.getByLabelText('SKILL.md source')).toHaveValue('# Changed');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('deleting opens a named dialog whose confirm needs the typed name', async () => {
    render(
      <DeskSkills
        frame={deskFrame}
        skills={skills}
        activeName="code-build"
        deleting="code-e2e"
        rulesUsing={['/code-e2e']}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete skill code-e2e?' });
    expect(within(dialog).getByText('/code-e2e')).toBeInTheDocument();
    expect(within(dialog).getByText(/uses this skill/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: 'Submit changes' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Type code-e2e to confirm/), 'code-e2e');
    expect(confirm).toBeEnabled();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('editing marks the skill dirty and commits the edited text with the message', async () => {
    const onCommit = vi.fn();
    render(
      <DeskSkills frame={deskFrame} skills={skills} activeName="code-review" commitMessage="msg" onCommit={onCommit} />,
    );
    const commit = screen.getByRole('button', { name: 'Submit changes' });
    expect(commit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('SKILL.md source'), 'x');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await userEvent.click(commit);
    expect(onCommit).toHaveBeenCalledWith(`${skills[1].body}x`, 'msg');
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByLabelText('SKILL.md source')).toHaveValue(skills[1].body);
  });

  it('committing shows Submitting… and disables the action even when dirty', () => {
    render(<DeskSkills frame={deskFrame} skills={skills} activeName="code-build" dirty committing />);
    expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
  });

  it('the commit bar targets the configured default branch, not a hardcoded main', () => {
    render(<DeskSkills frame={deskFrame} skills={skills} activeName="code-build" defaultBranch="trunk" />);
    const bar = screen.getByRole('button', { name: 'Submit changes' }).closest('div')?.parentElement;
    expect(bar).toHaveTextContent('Target');
    expect(bar).toHaveTextContent('trunk');
    expect(bar).not.toHaveTextContent('main');
    expect(screen.getByText(/submitted for review/i)).toBeInTheDocument();
  });

  it('History opens the selected skill file at the given URL', () => {
    const href = 'https://git.example.com/acme/app/blob/trunk/.claude/skills/code-build/SKILL.md';
    render(<DeskSkills frame={deskFrame} skills={skills} activeName="code-build" historyHref={href} />);
    const link = screen.getByRole('link', { name: 'History' });
    expect(link).toHaveAttribute('href', href);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  const submission = {
    action: 'save',
    sourceBranch: 'agent-desk/skill-update-code-build-x1',
    targetBranch: 'main',
    url: 'https://example.com/pr/7',
  } as const;

  it('a change request shows Changes submitted for review, a View change request link and the branches', () => {
    render(<DeskSkills frame={deskFrame} skills={skills} activeName="code-build" dirty submission={submission} />);
    const status = screen.getByRole('status');
    expect(within(status).getByText('Changes submitted for review')).toBeInTheDocument();
    const link = within(status).getByRole('link', { name: /View change request/ });
    expect(link).toHaveAttribute('href', 'https://example.com/pr/7');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(status).toHaveTextContent('agent-desk/skill-update-code-build-x1 → main');
    expect(status).toHaveTextContent('not merged');
    // The editor keeps the content and the pending change is not the live version.
    expect(screen.getByLabelText('SKILL.md source')).toHaveValue(skills[0].body);
  });

  it('a deletion change request says Deletion submitted for review and the skill stays listed', () => {
    render(
      <DeskSkills
        frame={deskFrame}
        skills={skills}
        activeName="code-build"
        submission={{ ...submission, action: 'delete' }}
      />,
    );
    expect(screen.getByText('Deletion submitted for review')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View change request/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /code-build/ })).toBeInTheDocument();
  });

  it('Dismiss closes the submission notice', async () => {
    const onDismissSubmission = vi.fn();
    render(
      <DeskSkills
        frame={deskFrame}
        skills={skills}
        activeName="code-build"
        submission={submission}
        onDismissSubmission={onDismissSubmission}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismissSubmission).toHaveBeenCalled();
  });

  it('a link that is not http(s) is not rendered', () => {
    render(
      <DeskSkills
        frame={deskFrame}
        skills={skills}
        activeName="code-build"
        submission={{ ...submission, url: 'javascript:alert(1)' }}
      />,
    );
    expect(screen.queryByRole('link', { name: /View change request/ })).toBeNull();
  });

  it('deleting shows Submitting… while the request runs', () => {
    render(<DeskSkills frame={deskFrame} skills={skills} activeName="code-build" deleting="code-e2e" deletePending />);
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Submitting…' })).toBeDisabled();
  });

  it('a plain click on a skill calls onSelect', async () => {
    const onSelect = vi.fn();
    render(
      <DeskSkills
        frame={deskFrame}
        skills={skills}
        activeName="code-build"
        skillHref={(n) => `/s?skill=${n}`}
        onSelect={onSelect}
      />,
    );
    const link = screen.getByRole('link', { name: /code-e2e/ });
    expect(link).toHaveAttribute('href', '/s?skill=code-e2e');
    await userEvent.click(link);
    expect(onSelect).toHaveBeenCalledWith('code-e2e');
  });

  it('no dialog by default', () => {
    render(<DeskSkills frame={deskFrame} skills={skills} activeName="code-build" />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows no usage warning when no rule uses the skill', () => {
    const { rerender } = render(
      <DeskSkills frame={deskFrame} skills={skills} activeName="code-build" deleting="code-e2e" />,
    );
    expect(screen.getByRole('dialog', { name: 'Delete skill code-e2e?' })).toBeInTheDocument();
    expect(screen.queryByText(/uses this skill/)).toBeNull();
    rerender(
      <DeskSkills frame={deskFrame} skills={skills} activeName="code-build" deleting="code-e2e" rulesUsing={[]} />,
    );
    expect(screen.queryByText(/uses this skill/)).toBeNull();
  });

  it('names a differently named rule command', () => {
    render(
      <DeskSkills
        frame={deskFrame}
        skills={skills}
        activeName="code-build"
        deleting="code-e2e"
        rulesUsing={['/flaky']}
      />,
    );
    expect(screen.getByText('/flaky')).toBeInTheDocument();
    expect(screen.queryByText('/code-e2e')).toBeNull();
  });
});

describe('DeskRules', () => {
  const base = { skills: skillNames, maxRunsPerTicket: 10 };

  it('lists rules and guards in a single main', () => {
    render(<DeskRules frame={deskFrame} rules={rules} {...base} />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Routing rules' })).toBeInTheDocument();
    expect(screen.getAllByRole('switch', { name: /^Enable rule \// })).toHaveLength(rules.length);
    expect(screen.getByRole('heading', { name: 'Guards on every rule' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('fits the window: height="viewport" reaches the shell (BR-61)', () => {
    const { container } = render(<DeskRules frame={deskFrame} rules={rules} {...base} height="viewport" />);
    expect(container.querySelector('[class*="appViewport"]')).not.toBeNull();
  });

  it('the header is pinned outside the list, and the list is a focusable named scroll area (BR-61)', () => {
    render(<DeskRules frame={deskFrame} rules={rules} {...base} />);
    const scroll = screen.getByRole('region', { name: 'Rules list' });
    expect(scroll).toHaveAttribute('tabindex', '0');
    expect(scroll.contains(screen.getByRole('heading', { level: 1, name: 'Routing rules' }))).toBe(false);
    expect(scroll.contains(screen.getAllByRole('button', { name: 'New rule' })[0])).toBe(false);
    expect(within(scroll).getAllByRole('switch', { name: /^Enable rule \// })).toHaveLength(rules.length);
  });

  it('empty rules shows the empty state', () => {
    render(<DeskRules frame={deskFrame} rules={[]} {...base} />);
    expect(screen.getByRole('heading', { name: /No routing rules/ })).toBeInTheDocument();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('toggling a rule calls onToggle(id, next)', async () => {
    const onToggle = vi.fn();
    render(<DeskRules frame={deskFrame} rules={rules} {...base} onToggle={onToggle} />);
    const sw = screen.getAllByRole('switch', { name: /^Enable rule \// });
    await userEvent.click(sw[0]);
    expect(onToggle).toHaveBeenLastCalledWith('r1', false);
    await userEvent.click(screen.getByRole('switch', { name: 'Enable rule /qa-e2e' }));
    expect(onToggle).toHaveBeenLastCalledWith('r5', true);
  });

  it('editingId opens the Edit rule pane and marks that row selected', () => {
    render(<DeskRules frame={deskFrame} rules={rules} {...base} editingId="r2" />);
    const pane = screen.getByRole('complementary', { name: 'Edit rule' });
    expect(within(pane).getByLabelText('Command')).toHaveValue('code-review');
    expect(within(pane).getByRole('button', { name: 'Delete rule' })).toBeInTheDocument();
    expect(within(pane).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(pane).getByRole('button', { name: 'Save rule' })).toBeInTheDocument();
    expect(within(pane).getByText(/Saving does not touch the repo/)).toBeInTheDocument();
    const selected = document.querySelectorAll('[aria-current="true"]');
    expect(selected).toHaveLength(1);
    expect(
      within(selected[0] as HTMLElement).getByRole('button', { name: 'Edit rule /code-review' }),
    ).toBeInTheDocument();
  });

  it('the pane shows the default model help with a link to Agent & settings', () => {
    const list = toModelList({ status: 'success', data: agentModelsFixtures.live }, null);
    render(
      <DeskRules
        frame={deskFrame}
        rules={rules}
        {...base}
        editingId="r2"
        modelField={{ list, defaultModel: 'opus', settingsHref: '/o/acme/p/p1/desk/agent' }}
      />,
    );
    const pane = screen.getByRole('complementary', { name: 'Edit rule' });
    expect(within(pane).getByRole('combobox', { name: 'Model' })).toBeInTheDocument();
    expect(within(pane).getByText(/Default model is/)).toHaveTextContent(
      'Default model is opus, set on Agent & settings.',
    );
    expect(within(pane).getByRole('link', { name: 'Agent & settings' })).toHaveAttribute(
      'href',
      '/o/acme/p/p1/desk/agent',
    );
  });

  it('the pane edits a draft locally and the sentence follows', async () => {
    render(<DeskRules frame={deskFrame} rules={rules} {...base} editingId="r2" />);
    const pane = screen.getByRole('complementary', { name: 'Edit rule' });
    const cmd = screen.getByLabelText('Command');
    await userEvent.clear(cmd);
    await userEvent.type(cmd, 'cr');
    expect(cmd).toHaveValue('cr');
    expect(within(pane).getAllByText('/cr').length).toBeGreaterThan(0);
  });

  it('the More menu offers Edit and Delete for that rule', async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(<DeskRules frame={deskFrame} rules={rules} {...base} onEdit={onEdit} onDelete={onDelete} />);
    const more = screen.getAllByRole('button', { name: /^More actions for \// })[2];
    const menu = () => within(screen.getByRole('dialog', { name: /^Actions for \// }));
    await userEvent.click(more);
    await userEvent.click(menu().getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledWith('r3');
    await userEvent.click(more);
    await userEvent.click(menu().getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('r3');
  });
});

const limitsValues = {
  timeoutMinutes: 30,
  pausedKeepMinutes: 10080,
  doneKeepMinutes: 1440,
  idleEndMinutes: 30,
  maxConcurrent: 2,
  maxRunsPerTicket: 10,
  autoResumeMax: 5,
};
const agentList = {
  rows: agentRowViews,
  state: 'ready' as const,
  pagination: {
    page: 1,
    pageSize: 20 as const,
    total: agentRowViews.length,
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
  },
  onAdd: vi.fn(),
  onRetry: vi.fn(),
  onEdit: vi.fn(),
  onTest: vi.fn(),
  onSetDefault: vi.fn(),
  onDelete: vi.fn(),
};
const base = { frame: deskFrame, limits: limitsValues, github, agents: agentList };

describe('DeskAgent', () => {
  it('has one main, the h1 and the four tabs in order, Agents selected by default', () => {
    render(<DeskAgent {...base} onDeleteProject={vi.fn()} />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Agent & settings' })).toBeInTheDocument();
    const tabs = within(screen.getByRole('tablist', { name: 'Agent and project settings' })).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Agents', 'GitHub connection', 'Limits', 'Danger zone']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'Agents' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Limits' })).toBeNull();
  });

  it('has no Danger zone tab without onDeleteProject (BR-55)', () => {
    render(<DeskAgent {...base} />);
    const tabs = within(screen.getByRole('tablist', { name: 'Agent and project settings' })).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Agents', 'GitHub connection', 'Limits']);
  });

  it('reports a clicked tab, and arrow keys, Home and End move between tabs', async () => {
    const onTabChange = vi.fn();
    render(<DeskAgent {...base} onDeleteProject={vi.fn()} tab="agents" onTabChange={onTabChange} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Limits' }));
    expect(onTabChange).toHaveBeenLastCalledWith('limits');
    screen.getByRole('tab', { name: 'Agents' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onTabChange).toHaveBeenLastCalledWith('github');
    await userEvent.keyboard('{End}');
    expect(onTabChange).toHaveBeenLastCalledWith('danger');
    await userEvent.keyboard('{Home}');
    expect(onTabChange).toHaveBeenLastCalledWith('agents');
  });

  it('keeps its own tab when the caller does not control it', async () => {
    render(<DeskAgent {...base} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Limits' }));
    expect(screen.getByRole('tab', { name: 'Limits' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'Limits' })).toBeInTheDocument();
  });

  it('TC-58.4: drops unsaved limit edits when the person switches tabs and back', async () => {
    render(<DeskAgent {...base} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Limits' }));
    const idle = screen.getByLabelText('End idle runs after');
    await userEvent.clear(idle);
    await userEvent.type(idle, '45');
    await userEvent.click(screen.getByRole('tab', { name: 'Agents' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Limits' }));
    expect(screen.getByLabelText('End idle runs after')).toHaveValue(String(base.limits.idleEndMinutes));
  });

  it('fits the window: height="viewport" reaches the shell (BR-61)', () => {
    const { container } = render(<DeskAgent {...base} height="viewport" />);
    expect(container.querySelector('[class*="appViewport"]')).not.toBeNull();
  });

  it('the panel is the one scroll area: focusable, named, and the Pagination sits outside it (BR-61)', () => {
    render(<DeskAgent {...base} agents={{ ...agentList, pagination: { ...agentList.pagination, total: 45 } }} />);
    const scroll = screen.getByRole('region', { name: 'Agents list' });
    expect(scroll).toHaveAttribute('tabindex', '0');
    expect(scroll).toHaveAccessibleName('Agents list');
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(scroll.contains(nav)).toBe(false);
    expect(screen.getByRole('tabpanel')).toContainElement(nav);
  });

  it('the add or edit pane is a right column beside the list', () => {
    render(
      <DeskAgent
        {...base}
        pane={{
          mode: 'edit',
          kinds: agentKindViews,
          providers: [],
          agent: agentPaneAgents[0],
          modelList: toModelList({ status: 'success', data: agentModelsFixtures.live }, null),
          onClose: vi.fn(),
        }}
      />,
    );
    const pane = screen.getByRole('complementary', { name: 'Edit agent' });
    expect(screen.getByRole('tabpanel')).toContainElement(pane);
    expect(screen.getByRole('region', { name: 'Agents list' }).contains(pane)).toBe(false);
  });

  it('shows the delete dialog over the list', async () => {
    const onKeep = vi.fn();
    render(
      <DeskAgent {...base} deleteDialog={{ state: 'confirm', name: 'Claude - Work', onKeep, onDelete: vi.fn() }} />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete agent Claude - Work?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep agent' }));
    expect(onKeep).toHaveBeenCalledOnce();
  });

  describe('GitHub connection tab', () => {
    const open = (extra: Partial<React.ComponentProps<typeof DeskAgent>> = {}) =>
      render(<DeskAgent {...base} tab="github" {...extra} />);

    it('is a named focusable region with the section heading', () => {
      open();
      expect(screen.getByRole('region', { name: 'GitHub connection' })).toHaveAttribute('tabindex', '0');
      expect(screen.getByRole('heading', { level: 2, name: 'GitHub connection' })).toBeInTheDocument();
    });

    it('adds a Trigger mode row after Repository, webhook by default', () => {
      const { container } = open({ github: [...github, { term: 'Last event', value: 'x' }] });
      const terms = [...container.querySelectorAll('dt')].map((d) => d.textContent);
      expect(terms.slice(0, 3)).toEqual(['Repository', 'Trigger mode', 'Last event']);
      expect(screen.getByRole('radio', { name: 'Webhook' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.queryByRole('radiogroup', { name: 'Check every' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Send test ping' })).toBeInTheDocument();
      expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    it('switching to polling shows the interval and reports the change', async () => {
      const onTriggerChange = vi.fn();
      open({ onTriggerChange });
      await userEvent.click(screen.getByRole('radio', { name: 'Polling' }));
      expect(onTriggerChange).toHaveBeenLastCalledWith({ mode: 'polling', interval: '5 min' });
      const interval = screen.getByRole('radiogroup', { name: 'Check every' });
      await userEvent.click(within(interval).getByRole('radio', { name: '30 min' }));
      expect(onTriggerChange).toHaveBeenLastCalledWith({ mode: 'polling', interval: '30 min' });
      expect(screen.getByRole('button', { name: 'Check now' })).toBeInTheDocument();
    });

    it('Check now reports the click; while checking it is disabled; a failure shows under it', async () => {
      const onCheckNow = vi.fn();
      const props = { connection: connections.pollingRevoked, onCheckNow };
      const { rerender } = open(props);
      await userEvent.click(screen.getByRole('button', { name: 'Check now' }));
      expect(onCheckNow).toHaveBeenCalledTimes(1);
      rerender(<DeskAgent {...base} tab="github" {...props} checkingNow />);
      expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
      rerender(
        <DeskAgent {...base} tab="github" {...props} checkNowError="Polling is paused: the token was revoked." />,
      );
      expect(screen.getByRole('alert')).toHaveTextContent('Polling is paused: the token was revoked.');
      expect(screen.getByRole('button', { name: 'Check now' })).toBeEnabled();
    });

    it('a polling project starts in polling mode and shows its status in the side nav', () => {
      open({ connection: connections.pollingRevoked });
      expect(screen.getByRole('radio', { name: 'Polling' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByText('Polling failed: token revoked').closest('.inline-status')).toHaveClass('err');
    });

    it('a controlled trigger shows the given mode with its error', () => {
      open({ trigger: { mode: 'polling', interval: '15 min' }, triggerError: 'Internal server error' });
      expect(screen.getByRole('radio', { name: 'Polling' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: '15 min' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByText('Internal server error')).toBeInTheDocument();
    });

    it('loading shows a busy status and no rows; an error shows Retry', async () => {
      const onRetry = vi.fn();
      const { rerender } = open({ githubState: 'loading' });
      expect(screen.getByRole('status', { name: 'Loading the connection' })).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByRole('radio', { name: 'Webhook' })).toBeNull();
      rerender(
        <DeskAgent
          {...base}
          tab="github"
          githubState="error"
          githubError={{ requestId: 'req_1' }}
          onRetryGithub={onRetry}
        />,
      );
      expect(screen.getByRole('alert')).toHaveTextContent('Could not load the connection. Try again.');
      expect(screen.getByRole('alert')).toHaveTextContent('req_1');
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(onRetry).toHaveBeenCalledOnce();
    });
  });

  describe('Limits tab', () => {
    const open = (extra: Partial<React.ComponentProps<typeof DeskAgent>> = {}) =>
      render(<DeskAgent {...base} tab="limits" {...extra} />);

    it('says the limits are project-wide, with the seven fields', () => {
      open();
      expect(screen.getByRole('region', { name: 'Limits' })).toHaveAttribute('tabindex', '0');
      expect(screen.getByText('Project-wide')).toBeInTheDocument();
      expect(screen.getByText('Applies to every agent in this project.')).toBeInTheDocument();
      expect(screen.getByLabelText('Run time limit')).toHaveValue('30');
      expect(screen.getByLabelText('Runs per ticket')).toHaveValue('10');
    });

    it('the Save limits bar sits outside the scrolling panel (BR-61)', () => {
      open();
      const scroll = screen.getByRole('region', { name: 'Limits' });
      const save = screen.getByRole('button', { name: 'Save limits' });
      expect(scroll.contains(save)).toBe(false);
      expect(screen.getByRole('tabpanel')).toContainElement(save);
    });

    it('shows limit field errors on their inputs and disables Save limits while saving', () => {
      open({ savingLimits: true, limitsErrors: { timeoutMinutes: 'Max 55 minutes.' }, limitsError: 'Saving failed.' });
      const timeout = screen.getByLabelText('Run time limit');
      expect(timeout).toHaveAttribute('aria-invalid', 'true');
      expect(timeout).toHaveAccessibleDescription(expect.stringContaining('Max 55 minutes.'));
      expect(screen.getByRole('alert')).toHaveTextContent('Saving failed.');
      expect(screen.getByRole('button', { name: 'Save limits' })).toBeDisabled();
    });

    it('End idle runs after is editable and its value goes to onSaveLimits', async () => {
      const onSaveLimits = vi.fn();
      open({ onSaveLimits });
      const idle = screen.getByLabelText('End idle runs after');
      await userEvent.clear(idle);
      await userEvent.type(idle, '45');
      await userEvent.click(screen.getByRole('button', { name: 'Save limits' }));
      expect(onSaveLimits).toHaveBeenCalledWith(expect.objectContaining({ idleEndMinutes: 45 }));
    });

    it('Runs per ticket says 0 or empty means unlimited, and an empty field saves 0', async () => {
      const onSaveLimits = vi.fn();
      open({ onSaveLimits });
      const perTicket = screen.getByLabelText('Runs per ticket');
      expect(perTicket).toHaveAccessibleDescription(expect.stringContaining('0 or empty means unlimited'));
      await userEvent.clear(perTicket);
      await userEvent.click(screen.getByRole('button', { name: 'Save limits' }));
      expect(onSaveLimits).toHaveBeenCalledWith(expect.objectContaining({ maxRunsPerTicket: 0 }));
    });

    it('read-only: the fields are disabled and there is no Save limits', () => {
      open({ limitsReadOnly: true });
      expect(screen.getByLabelText('Run time limit')).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Save limits' })).toBeNull();
    });

    const HELP =
      'How many times in a row a run resumes by itself after its pod is killed or the agent crashes. Typing in the terminal or pressing Resume starts the count again. 0 turns it off.';

    it('Automatic resumes is the last field, after Runs per ticket, with its help text', () => {
      open();
      const input = screen.getByRole('textbox', { name: 'Automatic resumes after a crash' });
      expect(input).toHaveValue('5');
      expect(input).toHaveAccessibleDescription(HELP);
      const perTicket = screen.getByLabelText('Runs per ticket');
      expect(perTicket.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(
        within(screen.getByRole('region', { name: 'Limits' }))
          .getAllByRole('textbox')
          .at(-1),
      ).toBe(input);
    });

    it('a refused save marks it invalid and shows the message under the help text', () => {
      open({
        limits: { ...limitsValues, autoResumeMax: 12 },
        limitsErrors: { autoResumeMax: 'Automatic resumes must be between 0 and 10' },
      });
      const input = screen.getByRole('textbox', { name: 'Automatic resumes after a crash' });
      expect(input).toHaveAttribute('aria-invalid', 'true');
      const ids = (input.getAttribute('aria-describedby') ?? '').split(' ');
      expect(document.getElementById(ids[0] ?? '')).toHaveTextContent(HELP);
      expect(document.getElementById(ids[1] ?? '')).toHaveTextContent('Automatic resumes must be between 0 and 10');
    });

    it('typing a number and Save limits sends it as autoResumeMax', async () => {
      const onSaveLimits = vi.fn();
      open({ onSaveLimits });
      const input = screen.getByRole('textbox', { name: 'Automatic resumes after a crash' });
      await userEvent.clear(input);
      await userEvent.type(input, '2');
      await userEvent.click(screen.getByRole('button', { name: 'Save limits' }));
      expect(onSaveLimits).toHaveBeenCalledWith(expect.objectContaining({ autoResumeMax: 2 }));
    });
  });

  describe('Danger zone tab', () => {
    it('Delete project asks to confirm before calling onDeleteProject', async () => {
      const onDeleteProject = vi.fn();
      render(<DeskAgent {...base} tab="danger" onDeleteProject={onDeleteProject} />);
      await userEvent.click(screen.getByRole('button', { name: 'Delete project' }));
      expect(onDeleteProject).not.toHaveBeenCalled();
      const dialog = screen.getByRole('dialog', { name: 'Delete project' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete project' }));
      expect(onDeleteProject).toHaveBeenCalledOnce();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('a Danger zone tab asked for without the right falls back to Agents', () => {
      render(<DeskAgent {...base} tab="danger" />);
      expect(screen.getByRole('tab', { name: 'Agents' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.queryByRole('button', { name: 'Delete project' })).toBeNull();
    });
  });
});

describe('Desk lists with pagination', () => {
  const pagination = (total: number): PaginationProps => ({
    page: 2,
    pageSize: 20,
    total,
    onPageChange: () => undefined,
    onPageSizeChange: () => undefined,
  });

  it('DeskRules pins the control under the scrolling list, which ends with Guards (BR-61)', () => {
    render(
      <DeskRules
        frame={deskFrame}
        rules={rules}
        skills={skillNames}
        maxRunsPerTicket={10}
        pagination={pagination(24)}
      />,
    );
    const lastRule = screen.getAllByText(rules[rules.length - 1].command)[0];
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    const guards = screen.getByRole('heading', { name: 'Guards on every rule' });
    const scroll = screen.getByRole('region', { name: 'Rules list' });
    expect(scroll).toContainElement(lastRule);
    expect(scroll).toContainElement(guards);
    expect(lastRule.compareDocumentPosition(guards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(scroll.contains(nav)).toBe(false);
    expect(guards.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('DeskRules with no rules shows No routing rules yet and no control', () => {
    render(
      <DeskRules frame={deskFrame} rules={[]} skills={skillNames} maxRunsPerTicket={10} pagination={pagination(0)} />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'No routing rules yet' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  });

  it('DeskSkills puts the control under the list and keeps the active skill in the editor when it is not in the list', () => {
    const active = { ...skills[0], name: 'not-on-this-page', path: '.claude/skills/not-on-this-page/SKILL.md' };
    render(<DeskSkills frame={deskFrame} skills={skills.slice(1)} active={active} pagination={pagination(22)} />);
    expect(screen.getByRole('heading', { level: 2, name: 'not-on-this-page' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
  });

  it('DeskSkills with no skills shows No skills yet and no control', () => {
    render(<DeskSkills frame={deskFrame} skills={[]} pagination={pagination(0)} />);
    expect(screen.getByRole('heading', { name: /No skills yet/ })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  });
});

describe('Desk under the app bar (BR-43)', () => {
  const links = { projects: '/p', runs: '/r', desk: '/d', skills: 's', rules: 'r', agent: 'a' };
  const org = { ...orgSwitchFixtures.oneOrgSettings, orgHref: () => '/o', createHref: '/new' };

  it('with org: the org crumb, the project crumb, Runs and Settings tabs with Settings current', () => {
    render(<DeskSkills frame={{ ...deskFrame, org, links }} skills={skills} activeName="code-build" />);
    const bar = screen.getByRole('banner');
    expect(within(bar).getByRole('button', { name: /^Switch scope, currently organization Acme/ })).toBeInTheDocument();
    const tabs = within(bar).getByRole('navigation', { name: 'Project sections' });
    expect(within(tabs).getByRole('link', { name: 'Project settings' })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).getByRole('link', { name: /^Runs/ })).not.toHaveAttribute('aria-current');
  });

  it('without org: no org menu', () => {
    render(<DeskSkills frame={{ ...deskFrame, links }} skills={skills} activeName="code-build" />);
    expect(within(screen.getByRole('banner')).queryByRole('button', { name: /organization/i })).toBeNull();
  });
});
