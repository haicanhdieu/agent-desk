import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { agentSettings, connections, rules, skills } from '@/mocks';
import { DeskSkills } from './DeskSkills';
import { DeskRules } from './DeskRules';
import { DeskAgent } from './DeskAgent';
import { vi } from 'vitest';

const skillNames = skills.map((s) => s.name);
const github = [
  { term: 'Repository', value: 'harbor-labs/invoicer-api' },
];

describe('DeskSkills', () => {
  it('has exactly one main and the editor for the active skill', () => {
    render(<DeskSkills skills={skills} activeName="code-build" />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'code-build' })).toBeInTheDocument();
    expect(screen.getByLabelText('SKILL.md source')).toHaveValue(skills[0].body);
    expect(screen.getByRole('link', { name: /code-build/ })).toHaveAttribute('aria-current', 'page');
  });

  it('empty skills shows the empty state pointing to starter templates', () => {
    render(<DeskSkills skills={[]} />);
    expect(screen.getByRole('heading', { name: /No skills yet/ })).toBeInTheDocument();
    expect(screen.getByText(/starter templates/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('SKILL.md source')).toBeNull();
  });

  it('dirty shows Unsaved changes and enables Commit to main; otherwise disabled', () => {
    const { rerender } = render(<DeskSkills skills={skills} activeName="code-build" dirty />);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Commit to main' })).toBeEnabled();
    rerender(<DeskSkills skills={skills} activeName="code-build" />);
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    expect(screen.getByRole('button', { name: 'Commit to main' })).toBeDisabled();
  });

  it('view switches Edit/Preview/Diff and read-only outside Edit', async () => {
    render(<DeskSkills skills={skills} activeName="code-build" changedLines={[17]} />);
    const seg = screen.getByRole('radiogroup', { name: 'Editor view' });
    expect(within(seg).getByRole('radio', { name: 'Edit' })).toBeChecked();
    expect(screen.getByLabelText('SKILL.md source')).not.toHaveAttribute('readonly');
    await userEvent.click(within(seg).getByRole('radio', { name: 'Diff' }));
    expect(within(seg).getByRole('radio', { name: 'Diff' })).toBeChecked();
    expect(screen.getByLabelText('SKILL.md source')).toHaveAttribute('readonly');
  });

  it('deleting opens a named dialog whose confirm needs the typed name', async () => {
    render(<DeskSkills skills={skills} activeName="code-build" deleting="code-e2e" rulesUsing={['/code-e2e']} />);
    const dialog = screen.getByRole('dialog', { name: 'Delete skill code-e2e?' });
    expect(within(dialog).getByText('/code-e2e')).toBeInTheDocument();
    expect(within(dialog).getByText(/uses this skill/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: 'Delete and commit' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Type code-e2e to confirm/), 'code-e2e');
    expect(confirm).toBeEnabled();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('no dialog by default', () => {
    render(<DeskSkills skills={skills} activeName="code-build" />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows no usage warning when no rule uses the skill', () => {
    const { rerender } = render(<DeskSkills skills={skills} activeName="code-build" deleting="code-e2e" />);
    expect(screen.getByRole('dialog', { name: 'Delete skill code-e2e?' })).toBeInTheDocument();
    expect(screen.queryByText(/uses this skill/)).toBeNull();
    rerender(<DeskSkills skills={skills} activeName="code-build" deleting="code-e2e" rulesUsing={[]} />);
    expect(screen.queryByText(/uses this skill/)).toBeNull();
  });

  it('names a differently named rule command', () => {
    render(<DeskSkills skills={skills} activeName="code-build" deleting="code-e2e" rulesUsing={['/flaky']} />);
    expect(screen.getByText('/flaky')).toBeInTheDocument();
    expect(screen.queryByText('/code-e2e')).toBeNull();
  });
});

describe('DeskRules', () => {
  const base = { skills: skillNames, maxRunsPerTicket: 10 };

  it('lists rules and guards in a single main', () => {
    render(<DeskRules rules={rules} {...base} />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Routing rules' })).toBeInTheDocument();
    expect(screen.getAllByRole('switch', { name: /^Enable rule \// })).toHaveLength(rules.length);
    expect(screen.getByRole('heading', { name: 'Guards on every rule' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('empty rules shows the empty state', () => {
    render(<DeskRules rules={[]} {...base} />);
    expect(screen.getByRole('heading', { name: /No routing rules/ })).toBeInTheDocument();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('toggling a rule calls onToggle(id, next)', async () => {
    const onToggle = vi.fn();
    render(<DeskRules rules={rules} {...base} onToggle={onToggle} />);
    const sw = screen.getAllByRole('switch', { name: /^Enable rule \// });
    await userEvent.click(sw[0]);
    expect(onToggle).toHaveBeenLastCalledWith('r1', false);
    await userEvent.click(sw[4]);
    expect(onToggle).toHaveBeenLastCalledWith('r5', true);
  });

  it('editingId opens the Edit rule pane and marks that row selected', () => {
    render(<DeskRules rules={rules} {...base} editingId="r2" />);
    const pane = screen.getByRole('complementary', { name: 'Edit rule' });
    expect(within(pane).getByLabelText('Command')).toHaveValue('code-review');
    expect(within(pane).getByRole('button', { name: 'Delete rule' })).toBeInTheDocument();
    expect(within(pane).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(pane).getByRole('button', { name: 'Save rule' })).toBeInTheDocument();
    expect(within(pane).getByText(/Saving does not touch the repo/)).toBeInTheDocument();
    const selected = document.querySelectorAll('[aria-current="true"]');
    expect(selected).toHaveLength(1);
    expect(within(selected[0] as HTMLElement).getByRole('button', { name: 'Edit rule /code-review' })).toBeInTheDocument();
  });

  it('the pane edits a draft locally and the sentence follows', async () => {
    render(<DeskRules rules={rules} {...base} editingId="r2" />);
    const pane = screen.getByRole('complementary', { name: 'Edit rule' });
    const cmd = screen.getByLabelText('Command');
    await userEvent.clear(cmd);
    await userEvent.type(cmd, 'cr');
    expect(cmd).toHaveValue('cr');
    expect(within(pane).getAllByText('/cr').length).toBeGreaterThan(0);
  });

  it('More calls onMore with the rule id', async () => {
    const onMore = vi.fn();
    render(<DeskRules rules={rules} {...base} onMore={onMore} />);
    await userEvent.click(screen.getAllByRole('button', { name: /^More actions for \// })[2]);
    expect(onMore).toHaveBeenCalledWith('r3');
  });
});

describe('DeskAgent', () => {
  it('has one main, the four sections and no credential input by default', () => {
    const { container } = render(<DeskAgent settings={agentSettings} github={github} />);
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
    const { container } = render(<DeskAgent settings={agentSettings} github={[...github, { term: 'Last event', value: 'x' }]} />);
    const terms = [...container.querySelectorAll('dt')].map((d) => d.textContent);
    expect(terms.slice(0, 3)).toEqual(['Repository', 'Trigger mode', 'Last event']);
    expect(screen.getByRole('radio', { name: 'Webhook' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('radiogroup', { name: 'Check every' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send test ping' })).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('switching to polling shows the interval and reports the change', async () => {
    const onTriggerChange = vi.fn();
    render(<DeskAgent settings={agentSettings} github={github} onTriggerChange={onTriggerChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Polling' }));
    expect(onTriggerChange).toHaveBeenLastCalledWith({ mode: 'polling', interval: '5 min' });
    const interval = screen.getByRole('radiogroup', { name: 'Check every' });
    expect(within(interval).getByRole('radio', { name: '5 min' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(interval).getByRole('radio', { name: '30 min' }));
    expect(onTriggerChange).toHaveBeenLastCalledWith({ mode: 'polling', interval: '30 min' });
    expect(screen.getByRole('button', { name: 'Check now' })).toBeInTheDocument();
  });

  it('a polling project starts in polling mode and shows its status in the side nav', () => {
    render(<DeskAgent settings={agentSettings} github={github} connection={connections.pollingRevoked} />);
    expect(screen.getByRole('radio', { name: 'Polling' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Polling failed: token revoked').closest('.inline-status')).toHaveClass('err');
  });

  it('replacingCredential shows an empty New token password input and Test and replace', () => {
    const { container } = render(<DeskAgent settings={agentSettings} github={github} replacingCredential />);
    const input = screen.getByLabelText('New token');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue('');
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Test and replace' })).toBeInTheDocument();
  });

  it('replace submit passes the typed token to onReplaceCredential and does not render it afterward', async () => {
    const onReplaceCredential = vi.fn();
    const { container } = render(<DeskAgent settings={agentSettings} github={github} replacingCredential onReplaceCredential={onReplaceCredential} />);
    await userEvent.type(screen.getByLabelText('New token'), 'sk-secret-123');
    await userEvent.click(screen.getByRole('button', { name: 'Test and replace' }));
    expect(onReplaceCredential).toHaveBeenCalledWith(agentSettings.credential.type, 'sk-secret-123');
    expect(container.textContent).not.toContain('sk-secret-123');
  });
});
