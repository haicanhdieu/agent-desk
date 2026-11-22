import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { accountFixture, agentSettings, connections, deskFrame, orgSwitchFixtures, rules, skills } from '@/mocks';
import { DeskSkills } from './DeskSkills';
import { DeskRules } from './DeskRules';
import { DeskAgent } from './DeskAgent';
import { vi } from 'vitest';
import { SignOutProvider, toModelList, type PaginationProps } from '@/components';
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

  it('dirty shows Unsaved changes and enables Commit to main; otherwise disabled', () => {
    const { rerender } = render(<DeskSkills frame={deskFrame} skills={skills} activeName="code-build" dirty />);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Commit to main' })).toBeEnabled();
    rerender(<DeskSkills frame={deskFrame} skills={skills} activeName="code-build" />);
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    expect(screen.getByRole('button', { name: 'Commit to main' })).toBeDisabled();
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
    await userEvent.click(screen.getByRole('button', { name: 'Commit to main' }));
    expect(onCommit).toHaveBeenLastCalledWith(`${codeBuild.body}x`, 'msg');
    await userEvent.click(radio('Diff'));
    await userEvent.click(screen.getByRole('button', { name: 'Commit to main' }));
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
    await userEvent.click(screen.getByRole('button', { name: 'Commit to main' }));
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
    const confirm = within(dialog).getByRole('button', { name: 'Delete and commit' });
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
    const commit = screen.getByRole('button', { name: 'Commit to main' });
    expect(commit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('SKILL.md source'), 'x');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await userEvent.click(commit);
    expect(onCommit).toHaveBeenCalledWith(`${skills[1].body}x`, 'msg');
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByLabelText('SKILL.md source')).toHaveValue(skills[1].body);
  });

  it('committing disables Commit even when dirty', () => {
    render(<DeskSkills frame={deskFrame} skills={skills} activeName="code-build" dirty committing />);
    expect(screen.getByRole('button', { name: 'Commit to main' })).toBeDisabled();
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

describe('DeskAgent', () => {
  it('has one main, the four sections and no credential input by default', () => {
    const { container } = render(<DeskAgent frame={deskFrame} settings={agentSettings} github={github} />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Agent & settings' })).toBeInTheDocument();
    for (const n of ['GitHub connection', 'Agent', 'Limits', 'Danger zone']) {
      expect(screen.getByRole('heading', { level: 2, name: n })).toBeInTheDocument();
    }
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByLabelText('New token')).toBeNull();
    expect(screen.getByText('Rejected at 11:29')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Agent' })).toBeDisabled();
    expect(screen.getByLabelText('Run time limit')).toHaveValue('30');
    expect(screen.getByLabelText('Runs per ticket')).toHaveValue('10');
    expect(screen.getByRole('button', { name: 'Save limits' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete project' })).toBeInTheDocument();
  });

  it('adds a Trigger mode row after Repository, webhook by default', () => {
    const { container } = render(
      <DeskAgent frame={deskFrame} settings={agentSettings} github={[...github, { term: 'Last event', value: 'x' }]} />,
    );
    const terms = [...container.querySelectorAll('dt')].map((d) => d.textContent);
    expect(terms.slice(0, 3)).toEqual(['Repository', 'Trigger mode', 'Last event']);
    expect(screen.getByRole('radio', { name: 'Webhook' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('radiogroup', { name: 'Check every' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send test ping' })).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('switching to polling shows the interval and reports the change', async () => {
    const onTriggerChange = vi.fn();
    render(<DeskAgent frame={deskFrame} settings={agentSettings} github={github} onTriggerChange={onTriggerChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Polling' }));
    expect(onTriggerChange).toHaveBeenLastCalledWith({ mode: 'polling', interval: '5 min' });
    const interval = screen.getByRole('radiogroup', { name: 'Check every' });
    expect(within(interval).getByRole('radio', { name: '5 min' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(interval).getByRole('radio', { name: '30 min' }));
    expect(onTriggerChange).toHaveBeenLastCalledWith({ mode: 'polling', interval: '30 min' });
    expect(screen.getByRole('button', { name: 'Check now' })).toBeInTheDocument();
  });

  it('Check now reports the click; while checking it is disabled and says so; a failure shows under it', async () => {
    const onCheckNow = vi.fn();
    const props = {
      frame: deskFrame,
      settings: agentSettings,
      github,
      connection: connections.pollingRevoked,
      onCheckNow,
    };
    const { rerender } = render(<DeskAgent {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(onCheckNow).toHaveBeenCalledTimes(1);
    rerender(<DeskAgent {...props} checkingNow />);
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    rerender(<DeskAgent {...props} checkNowError="Polling is paused: the token was revoked." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Polling is paused: the token was revoked.');
    expect(screen.getByRole('button', { name: 'Check now' })).toBeEnabled();
  });

  it('a polling project starts in polling mode and shows its status in the side nav', () => {
    render(
      <DeskAgent frame={deskFrame} settings={agentSettings} github={github} connection={connections.pollingRevoked} />,
    );
    expect(screen.getByRole('radio', { name: 'Polling' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Polling failed: token revoked').closest('.inline-status')).toHaveClass('err');
  });

  it('replacingCredential shows an empty New token password input and Test and replace', () => {
    const { container } = render(
      <DeskAgent frame={deskFrame} settings={agentSettings} github={github} replacingCredential />,
    );
    const input = screen.getByLabelText('New token');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue('');
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Test and replace' })).toBeInTheDocument();
  });

  it('replace submit passes the typed token to onReplaceCredential and does not render it afterward', async () => {
    const onReplaceCredential = vi.fn();
    const { container } = render(
      <DeskAgent
        frame={deskFrame}
        settings={agentSettings}
        github={github}
        replacingCredential
        onReplaceCredential={onReplaceCredential}
      />,
    );
    await userEvent.type(screen.getByLabelText('New token'), 'sk-secret-123');
    await userEvent.click(screen.getByRole('button', { name: 'Test and replace' }));
    expect(onReplaceCredential).toHaveBeenCalledWith(agentSettings.credential.type, 'sk-secret-123');
    expect(container.textContent).not.toContain('sk-secret-123');
  });

  it('shows limit field errors on their inputs and disables Save limits while saving', () => {
    render(
      <DeskAgent
        frame={deskFrame}
        settings={agentSettings}
        github={github}
        savingLimits
        limitsErrors={{ timeoutMinutes: 'Max 55 minutes.' }}
        limitsError="Saving failed."
      />,
    );
    const timeout = screen.getByLabelText('Run time limit');
    expect(timeout).toHaveAttribute('aria-invalid', 'true');
    expect(timeout).toHaveAccessibleDescription(expect.stringContaining('Max 55 minutes.'));
    expect(screen.getByRole('alert')).toHaveTextContent('Saving failed.');
    expect(screen.getByRole('button', { name: 'Save limits' })).toBeDisabled();
  });

  it('End idle runs after is an editable number field and its value goes to onSaveLimits', async () => {
    const onSaveLimits = vi.fn();
    render(<DeskAgent frame={deskFrame} settings={agentSettings} github={github} onSaveLimits={onSaveLimits} />);
    const idle = screen.getByLabelText('End idle runs after');
    expect(idle).not.toHaveAttribute('readonly');
    await userEvent.clear(idle);
    await userEvent.type(idle, '45');
    await userEvent.click(screen.getByRole('button', { name: 'Save limits' }));
    expect(onSaveLimits).toHaveBeenCalledWith(expect.objectContaining({ idleEndMinutes: 45 }));
  });

  it('a controlled trigger shows the given mode with its error', () => {
    render(
      <DeskAgent
        frame={deskFrame}
        settings={agentSettings}
        github={github}
        trigger={{ mode: 'polling', interval: '15 min' }}
        triggerError="Internal server error"
      />,
    );
    expect(screen.getByRole('radio', { name: 'Polling' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '15 min' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Internal server error')).toBeInTheDocument();
  });

  it('Delete project asks to confirm before calling onDeleteProject', async () => {
    const onDeleteProject = vi.fn();
    render(<DeskAgent frame={deskFrame} settings={agentSettings} github={github} onDeleteProject={onDeleteProject} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete project' }));
    expect(onDeleteProject).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Delete project' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete project' }));
    expect(onDeleteProject).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the replace panel closes only when onReplaceCredential resolves true', async () => {
    const onReplaceCredential = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(
      <DeskAgent
        frame={deskFrame}
        settings={agentSettings}
        github={github}
        replacingCredential
        onReplaceCredential={onReplaceCredential}
        credentialError="Rejected."
      />,
    );
    expect(screen.getByLabelText('New token')).toHaveAttribute('aria-invalid', 'true');
    await userEvent.type(screen.getByLabelText('New token'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Test and replace' }));
    expect(screen.getByLabelText('New token')).toHaveValue('x');
    await userEvent.click(screen.getByRole('button', { name: 'Test and replace' }));
    await waitFor(() => expect(screen.queryByLabelText('New token')).toBeNull());
  });

  describe('model and API address', () => {
    const live = toModelList({ status: 'success', data: agentModelsFixtures.live }, null);
    const settings = { ...agentSettings, model: 'claude-opus-4-5-20251101', baseUrl: '' };
    const open = (extra: Partial<React.ComponentProps<typeof DeskAgent>> = {}) =>
      render(<DeskAgent frame={deskFrame} settings={settings} github={github} modelList={live} {...extra} />);

    it('Default model lists the live models with the provider note', () => {
      open();
      const select = screen.getByRole('combobox', { name: 'Default model' });
      expect(select).toHaveValue('claude-opus-4-5-20251101');
      expect(
        within(select)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual([
        'claude-opus-4-5-20251101',
        'claude-sonnet-4-5-20250929',
        'claude-haiku-4-5-20251001',
        'claude-opus-4-1-20250805',
        'Other model…',
      ]);
      expect(select).toHaveAccessibleDescription(
        "Loaded from the provider. Rules that don't name a model use this one.",
      );
    });

    it('shows the loading note while the list is absent', () => {
      open({ modelList: undefined });
      expect(screen.getByText('Loading models…')).toBeInTheDocument();
    });

    it('Save agent sends the picked or typed model', async () => {
      const onSaveAgent = vi.fn();
      open({ onSaveAgent });
      await userEvent.selectOptions(
        screen.getByRole('combobox', { name: 'Default model' }),
        'claude-sonnet-4-5-20250929',
      );
      await userEvent.click(screen.getByRole('button', { name: 'Save agent' }));
      expect(onSaveAgent).toHaveBeenLastCalledWith('claude-sonnet-4-5-20250929');
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Default model' }), 'Other model…');
      await userEvent.type(screen.getByRole('textbox', { name: 'Model name' }), 'anthropic/claude-sonnet-4-5');
      expect(screen.getByRole('combobox', { name: 'Default model' })).toHaveAccessibleDescription(
        "Sent to Claude Code exactly as typed. Rules that don't name a model use this one.",
      );
      await userEvent.click(screen.getByRole('button', { name: 'Save agent' }));
      expect(onSaveAgent).toHaveBeenLastCalledWith('anthropic/claude-sonnet-4-5');
    });

    it('Save agent without touching a saved model that is not listed keeps it', async () => {
      const onSaveAgent = vi.fn();
      open({ settings: { ...settings, model: 'sonnet' }, onSaveAgent });
      expect(screen.getByRole('textbox', { name: 'Model name' })).toHaveValue('sonnet');
      await userEvent.click(screen.getByRole('button', { name: 'Save agent' }));
      expect(onSaveAgent).toHaveBeenCalledWith('sonnet');
    });

    it('Save agent with Other model… left empty does not save and shows a field error', async () => {
      const onSaveAgent = vi.fn();
      open({ onSaveAgent });
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Default model' }), 'Other model…');
      await userEvent.click(screen.getByRole('button', { name: 'Save agent' }));
      expect(onSaveAgent).not.toHaveBeenCalled();
      expect(screen.getByRole('textbox', { name: 'Model name' })).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByRole('textbox', { name: 'Model name' })).toHaveAccessibleDescription(
        expect.stringContaining('Enter a model name.'),
      );
    });

    it('Save agent is disabled while saving', () => {
      open({ savingAgent: true });
      expect(screen.getByRole('button', { name: 'Save agent' })).toBeDisabled();
    });

    it('shows the API address with the board help and no credential panel while unchanged', () => {
      open();
      const address = screen.getByRole('textbox', { name: 'API address' });
      expect(address).toHaveValue('');
      expect(address).toHaveAttribute('placeholder', 'https://api.anthropic.com');
      expect(address).toHaveAccessibleDescription(
        "Optional. Leave empty for Anthropic's default. Runs get it as ANTHROPIC_BASE_URL. Public https addresses only. Changing it needs the credential again.",
      );
      expect(screen.queryByLabelText('New token')).toBeNull();
    });

    it('editing the API address switches the credential to its replacing state with the board texts', async () => {
      const onReplaceCredential = vi.fn();
      open({ onReplaceCredential });
      const address = screen.getByRole('textbox', { name: 'API address' });
      await userEvent.type(address, ' https://gateway.harbor-labs.com/anthropic ');
      expect(address).toHaveAccessibleDescription(
        "Changed from Anthropic's default. It is saved together with the new credential below.",
      );
      expect(screen.getByText('Credential needed again')).toBeInTheDocument();
      expect(screen.getByText('Replaced when you save')).toBeInTheDocument();
      expect(
        screen.getByText(
          'The API address changed. A saved credential is only sent to the address it was saved with, so paste it again for the new one.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'We test the new token with one small call before saving. The address and the token are saved together; runs already in progress keep the ones they started with.',
        ),
      ).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText('New token'), 'sk-new');
      await userEvent.click(screen.getByRole('button', { name: 'Test and replace' }));
      expect(onReplaceCredential).toHaveBeenCalledWith(
        agentSettings.credential.type,
        'sk-new',
        'https://gateway.harbor-labs.com/anthropic',
      );
    });

    it('changing from a custom address words the note with the saved address', async () => {
      open({ settings: { ...settings, baseUrl: 'https://gw.example.com/a' } });
      await userEvent.type(screen.getByRole('textbox', { name: 'API address' }), 'x');
      expect(screen.getByRole('textbox', { name: 'API address' })).toHaveAccessibleDescription(
        'Changed from https://gw.example.com/a. It is saved together with the new credential below.',
      );
    });

    it('typing the saved address back leaves the replacing state and sends no baseUrl', async () => {
      const onReplaceCredential = vi.fn();
      open({
        settings: { ...settings, baseUrl: 'https://gw.example.com/a' },
        onReplaceCredential,
        replacingCredential: true,
      });
      const address = screen.getByRole('textbox', { name: 'API address' });
      await userEvent.type(address, 'b');
      expect(screen.getByText('Credential needed again')).toBeInTheDocument();
      await userEvent.type(address, '{Backspace}');
      expect(screen.queryByText('Credential needed again')).toBeNull();
      // Opened by hand earlier: still the plain replace panel, and it sends the credential alone.
      await userEvent.type(screen.getByLabelText('New token'), 'sk-new');
      await userEvent.click(screen.getByRole('button', { name: 'Test and replace' }));
      expect(onReplaceCredential).toHaveBeenCalledWith(agentSettings.credential.type, 'sk-new');
    });

    it('typing the saved address back closes a panel the address change opened', async () => {
      open();
      const address = screen.getByRole('textbox', { name: 'API address' });
      await userEvent.type(address, 'h');
      expect(screen.getByLabelText('New token')).toBeInTheDocument();
      await userEvent.clear(address);
      expect(screen.queryByLabelText('New token')).toBeNull();
    });

    it('clearing a saved address sends baseUrl null', async () => {
      const onReplaceCredential = vi.fn();
      open({ settings: { ...settings, baseUrl: 'https://gw.example.com/a' }, onReplaceCredential });
      await userEvent.clear(screen.getByRole('textbox', { name: 'API address' }));
      await userEvent.type(screen.getByLabelText('New token'), 'sk-new');
      await userEvent.click(screen.getByRole('button', { name: 'Test and replace' }));
      expect(onReplaceCredential).toHaveBeenCalledWith(agentSettings.credential.type, 'sk-new', null);
    });

    it('Cancel on the address-forced panel puts the saved address back', async () => {
      open();
      await userEvent.type(screen.getByRole('textbox', { name: 'API address' }), 'h');
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.getByRole('textbox', { name: 'API address' })).toHaveValue('');
      expect(screen.queryByLabelText('New token')).toBeNull();
    });

    it('Test and replace is disabled until a token is typed', async () => {
      open();
      await userEvent.type(screen.getByRole('textbox', { name: 'API address' }), 'h');
      expect(screen.getByRole('button', { name: 'Test and replace' })).toBeDisabled();
      await userEvent.type(screen.getByLabelText('New token'), 't');
      expect(screen.getByRole('button', { name: 'Test and replace' })).toBeEnabled();
    });

    it('starts with the address typed in initialAddress', () => {
      open({ initialAddress: 'https://gateway.harbor-labs.com/anthropic' });
      expect(screen.getByRole('textbox', { name: 'API address' })).toHaveValue(
        'https://gateway.harbor-labs.com/anthropic',
      );
      expect(screen.getByText('Credential needed again')).toBeInTheDocument();
    });

    it('shows addressError and modelError on their fields', () => {
      open({ addressError: 'Use a public https address.', modelError: 'Model name not accepted.' });
      const address = screen.getByRole('textbox', { name: 'API address' });
      expect(address).toHaveAttribute('aria-invalid', 'true');
      expect(address).toHaveAccessibleDescription(expect.stringContaining('Use a public https address.'));
      const select = screen.getByRole('combobox', { name: 'Default model' });
      expect(select).toHaveAttribute('aria-invalid', 'true');
      expect(select).toHaveAccessibleDescription(expect.stringContaining('Model name not accepted.'));
    });

    it('no credential shows no "Set … by …" line', () => {
      open({ settings: { ...settings, credential: { type: 'oauth_token', setAt: '', setBy: '' } } });
      expect(screen.queryByText(/Set .* by /)).toBeNull();
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

  it('DeskRules puts the control between the list and Guards on every rule', () => {
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
    expect(lastRule.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.compareDocumentPosition(guards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

describe('DeskAgent automatic resumes field', () => {
  const HELP =
    'How many times in a row a run resumes by itself after its pod is killed or the agent crashes. Typing in the terminal or pressing Resume starts the count again. 0 turns it off.';

  it('is the last Limits field, after Runs per ticket, with the help text', () => {
    render(<DeskAgent frame={deskFrame} settings={agentSettings} github={github} />);
    const input = screen.getByRole('textbox', { name: 'Automatic resumes after a crash' });
    expect(input).toHaveValue('5');
    expect(input).toHaveAccessibleDescription(HELP);
    const perTicket = screen.getByLabelText('Runs per ticket');
    expect(perTicket.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const limits = within(screen.getByRole('region', { name: 'Limits' }));
    expect(limits.getAllByRole('textbox').at(-1)).toBe(input);
  });

  it('a refused save marks it invalid and shows the message under the help text', () => {
    render(
      <DeskAgent
        frame={deskFrame}
        settings={{ ...agentSettings, autoResumeMax: 12 }}
        github={github}
        limitsErrors={{ autoResumeMax: 'Automatic resumes must be between 0 and 10' }}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Automatic resumes after a crash' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const description = input.getAttribute('aria-describedby') ?? '';
    const ids = description.split(' ');
    expect(document.getElementById(ids[0] ?? '')).toHaveTextContent(HELP);
    expect(document.getElementById(ids[1] ?? '')).toHaveTextContent('Automatic resumes must be between 0 and 10');
  });

  it('typing a number and Save limits sends it as autoResumeMax', async () => {
    const onSaveLimits = vi.fn();
    render(<DeskAgent frame={deskFrame} settings={agentSettings} github={github} onSaveLimits={onSaveLimits} />);
    const input = screen.getByRole('textbox', { name: 'Automatic resumes after a crash' });
    await userEvent.clear(input);
    await userEvent.type(input, '2');
    await userEvent.click(screen.getByRole('button', { name: 'Save limits' }));
    expect(onSaveLimits).toHaveBeenCalledWith(expect.objectContaining({ autoResumeMax: 2 }));
  });
});

describe('Desk under the app bar (BR-43)', () => {
  const links = { projects: '/p', runs: '/r', desk: '/d', skills: 's', rules: 'r', agent: 'a' };
  const org = { ...orgSwitchFixtures.oneOrgSettings, orgHref: () => '/o', createHref: '/new' };

  it('with org: the org crumb, the project crumb, Runs and Desk tabs with Desk current', () => {
    render(<DeskSkills frame={{ ...deskFrame, org, links }} skills={skills} activeName="code-build" />);
    const bar = screen.getByRole('banner');
    expect(within(bar).getByRole('button', { name: /^Organization menu, Acme/ })).toBeInTheDocument();
    const tabs = within(bar).getByRole('navigation', { name: 'Main' });
    expect(within(tabs).getByRole('link', { name: 'Desk' })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).getByRole('link', { name: /^Runs/ })).not.toHaveAttribute('aria-current');
  });

  it('without org: no org menu', () => {
    render(<DeskSkills frame={{ ...deskFrame, links }} skills={skills} activeName="code-build" />);
    expect(within(screen.getByRole('banner')).queryByRole('button', { name: /organization/i })).toBeNull();
  });

  it('passes the account to the avatar menu', async () => {
    render(
      <SignOutProvider onSignOut={() => undefined}>
        <DeskSkills
          frame={{ ...deskFrame, org, links, account: { ...accountFixture, invitationsHref: '/inv' } }}
          skills={skills}
          activeName="code-build"
        />
      </SignOutProvider>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: /^Account menu for/ }));
    expect(within(screen.getByRole('dialog', { name: 'Account' })).getByText(accountFixture.name)).toBeInTheDocument();
  });
});
