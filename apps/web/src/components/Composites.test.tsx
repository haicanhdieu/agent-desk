import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Stepper } from './Stepper';
import { SetupLayout } from './SetupLayout';
import { RuleSentence, type RuleDraft } from './RuleSentence';
import { RuleForm } from './RuleForm';
import { RuleRow } from './RuleRow';
import { GuardsCard } from './GuardsCard';
import { SkillList } from './SkillList';
import { CommitBar } from './CommitBar';
import { CommitSummary } from './CommitSummary';
import { CodeBlock } from './CodeBlock';
import { SettingsSection } from './SettingsSection';
import { DangerZone } from './DangerZone';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import { SidePane } from './SidePane';
import { SurfaceCard } from './SurfaceCard';

const rule: RuleDraft = { command: 'code-build', target: 'issue', labels: ['user-story'], skill: 'code-build', agent: 'Claude', enabled: true };

describe('Stepper', () => {
  const steps = [{ label: 'Add skills', detail: 'harbor-labs/invoicer-api' }, { label: 'Add first rule', optional: true }, { label: 'Ready' }];
  it('marks exactly one step current and step 0 done without a digit', () => {
    render(<Stepper steps={steps} current={1} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items.filter((i) => i.getAttribute('aria-current') === 'step')).toHaveLength(1);
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[0].textContent).not.toMatch(/^\d/);
    expect(items[0].querySelector('svg')).not.toBeNull();
    expect(items[0]).toHaveTextContent('harbor-labs/invoicer-api');
    expect(items[1]).toHaveTextContent('optional');
    expect(items[2]).toHaveTextContent('3');
    expect(items[2]).not.toHaveAttribute('aria-current');
  });
  it('no step is current when current is past the end', () => {
    render(<Stepper steps={steps} current={3} />);
    expect(document.querySelector('[aria-current]')).toBeNull();
  });
});

describe('RuleSentence', () => {
  it('slots variant reads the full sentence', () => {
    const { container } = render(<RuleSentence rule={rule} variant="slots" />);
    expect(container.textContent).toBe('When a comment starting with /code-build is posted on an issue labelled user-story, run skill code-build with agent Claude.');
  });
  it('pr with no labels omits the label clause', () => {
    const { container } = render(<RuleSentence rule={{ ...rule, target: 'pr', labels: [] }} variant="slots" />);
    expect(container.textContent).toContain('on a pull request, run skill');
    expect(container.textContent).not.toContain('labelled');
  });
  it('any target wording', () => {
    const { container } = render(<RuleSentence rule={{ ...rule, target: 'any', labels: [] }} variant="slots" />);
    expect(container.textContent).toContain('on an issue or pull request, run skill');
  });
  it('multiple labels are joined', () => {
    const { container } = render(<RuleSentence rule={{ ...rule, labels: ['a', 'b'] }} variant="slots" />);
    expect(container.textContent).toContain('labelled a, b,');
  });
  it('plain variant', () => {
    const { container } = render(<RuleSentence rule={rule} variant="plain" />);
    expect(container.textContent).toBe('When /code-build is posted on an issue labelled user-story, run code-build with Claude');
    const pr = render(<RuleSentence rule={{ ...rule, target: 'pr', labels: [] }} variant="plain" />);
    expect(pr.container.textContent).toBe('When /code-build is posted on a pull request, run code-build with Claude');
  });
});

describe('RuleForm', () => {
  const props = { value: rule, skills: ['code-build', 'code-review'], agents: ['Claude (opus)'] };
  it('changing posted-on calls onChange with target pr', async () => {
    const onChange = vi.fn();
    render(<RuleForm {...props} onChange={onChange} />);
    expect(screen.getByRole('radiogroup', { name: 'Posted on' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Pull request' }));
    expect(onChange).toHaveBeenCalledWith({ ...rule, target: 'pr' });
  });
  it('labelled controls, help text and live preview', async () => {
    const onChange = vi.fn();
    render(<RuleForm {...props} onChange={onChange} />);
    expect(screen.getByLabelText('Command')).toHaveValue('code-build');
    expect(screen.getByLabelText('Command')).toHaveAccessibleDescription(/First line of the comment/);
    expect(screen.getByLabelText('Run skill')).toHaveValue('code-build');
    expect(screen.getByLabelText('With agent')).not.toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Enabled' })).toBeChecked();
    expect(screen.getByText('Matches new comments right away')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Command'), 'x');
    expect(onChange).toHaveBeenLastCalledWith({ ...rule, command: 'code-buildx' });
    await userEvent.click(screen.getByRole('switch', { name: 'Enabled' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...rule, enabled: false });
  });
  it('label add and remove, skill and agent select', async () => {
    const onChange = vi.fn();
    render(<RuleForm {...props} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Only if the ticket has all labels'), 'bug{Enter}');
    expect(onChange).toHaveBeenLastCalledWith({ ...rule, labels: ['user-story', 'bug'] });
    await userEvent.click(screen.getByRole('button', { name: /Remove label user-story/ }));
    expect(onChange).toHaveBeenLastCalledWith({ ...rule, labels: [] });
    await userEvent.selectOptions(screen.getByLabelText('Run skill'), 'code-review');
    expect(onChange).toHaveBeenLastCalledWith({ ...rule, skill: 'code-review' });
  });
  it('agentLocked disables the agent select', () => {
    render(<RuleForm {...props} agentLocked onChange={() => {}} />);
    expect(screen.getByLabelText('With agent')).toBeDisabled();
  });
});

describe('RuleRow', () => {
  const row = { ...rule, id: 'r1' };
  it('toggle calls onToggle(false) for an enabled rule, true for disabled', async () => {
    const onToggle = vi.fn();
    const { rerender } = render(<RuleRow rule={row} stats="14 runs this week, last 14:15" onToggle={onToggle} />);
    const sw = screen.getByRole('switch', { name: 'Enable rule /code-build' });
    expect(sw).toBeChecked();
    await userEvent.click(sw);
    expect(onToggle).toHaveBeenLastCalledWith(false);
    rerender(<RuleRow rule={{ ...row, enabled: false }} stats="Turned off 3 Nov" onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('switch', { name: 'Enable rule /code-build' }));
    expect(onToggle).toHaveBeenLastCalledWith(true);
  });
  it('shows stats, warning text and a More button', () => {
    render(<RuleRow rule={row} stats="Never ran" warning="Skill docs-update is not in .claude/skills/ on main." onToggle={() => {}} />);
    expect(screen.getByText('Never ran')).toBeInTheDocument();
    expect(screen.getByText(/Skill docs-update is not in/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More actions for /code-build' })).toBeInTheDocument();
  });
  it('More button calls onMore when provided', async () => {
    const onMore = vi.fn();
    render(<RuleRow rule={row} stats="x" onToggle={() => {}} onMore={onMore} />);
    await userEvent.click(screen.getByRole('button', { name: 'More actions for /code-build' }));
    expect(onMore).toHaveBeenCalledTimes(1);
  });
  it('selected row marks aria-current and onSelect fires', async () => {
    const onSelect = vi.fn();
    const { container } = render(<RuleRow rule={row} stats="x" selected onSelect={onSelect} onToggle={() => {}} />);
    expect(container.querySelector('[aria-current="true"]')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Edit rule /code-build' }));
    expect(onSelect).toHaveBeenCalled();
  });
});

describe('GuardsCard', () => {
  it('shows the max runs and links', () => {
    render(<GuardsCard maxRunsPerTicket={10} changeHref="/agent" ignoredHref="/ignored" />);
    expect(screen.getByRole('heading', { name: 'Guards on every rule' })).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change' })).toHaveAttribute('href', '/agent');
    expect(screen.getByRole('link', { name: 'Runs, Ignored' })).toHaveAttribute('href', '/ignored');
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });
});

describe('SkillList', () => {
  const skills = [
    { name: 'code-build', description: 'Implement.', ruleSummary: '2 rules' },
    { name: 'qa-e2e', description: 'QA.', ruleSummary: '1 rule, off' },
  ];
  it('active item has aria-current page, others none', () => {
    render(<SkillList skills={skills} activeName="code-build" branch="main" />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('aria-current', 'page');
    expect(links[1]).not.toHaveAttribute('aria-current');
    expect(screen.getByText('.claude/skills/ on main')).toBeInTheDocument();
    expect(screen.getByText('1 rule, off')).toBeInTheDocument();
  });
  it('New skill calls onNew; empty list renders no list items', async () => {
    const onNew = vi.fn();
    render(<SkillList skills={[]} branch="main" onNew={onNew} />);
    await userEvent.click(screen.getByRole('button', { name: 'New skill' }));
    expect(onNew).toHaveBeenCalled();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});

describe('CommitBar', () => {
  const base = { message: 'msg', branch: 'main', note: 'Commits as agent-desk[bot].' };
  it('disables Commit when not dirty and enables when dirty', async () => {
    const onCommit = vi.fn();
    const { rerender } = render(<CommitBar {...base} dirty={false} onCommit={onCommit} />);
    expect(screen.getByRole('button', { name: 'Commit to main' })).toBeDisabled();
    rerender(<CommitBar {...base} dirty onCommit={onCommit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Commit to main' }));
    expect(onCommit).toHaveBeenCalled();
  });
  it('message edit, discard, branch and note', async () => {
    const onMessageChange = vi.fn();
    const onDiscard = vi.fn();
    render(<CommitBar {...base} dirty onMessageChange={onMessageChange} onDiscard={onDiscard} />);
    await userEvent.type(screen.getByLabelText('Commit message'), '!');
    expect(onMessageChange).toHaveBeenLastCalledWith('msg!');
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDiscard).toHaveBeenCalled();
    expect(screen.getByText('default branch')).toBeInTheDocument();
    expect(screen.getByText(base.note)).toBeInTheDocument();
  });
});

describe('CommitSummary', () => {
  it('lists the files and message', () => {
    render(<CommitSummary branch="main" author="agent-desk[bot]" message="Add skills" files={['.claude/skills/a/SKILL.md', '.claude/skills/b/SKILL.md']} />);
    expect(screen.getByText(/One commit to/)).toHaveTextContent('One commit to main as agent-desk[bot]');
    expect(screen.getByLabelText('Commit message')).toHaveValue('Add skills');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('CodeBlock', () => {
  it('Copy calls onCopy and the code is shown', async () => {
    const onCopy = vi.fn();
    render(<CodeBlock caption="Comment on an issue" code="/code-build" onCopy={onCopy} />);
    expect(screen.getByText('/code-build').tagName).toBe('PRE');
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(onCopy).toHaveBeenCalled();
  });
});

describe('SettingsSection / DangerZone / SidePane / SurfaceCard / SetupLayout', () => {
  it('SettingsSection renders heading, description and content', () => {
    render(<SettingsSection title="Limits" description="Guards."><p>body</p></SettingsSection>);
    expect(screen.getByRole('heading', { name: 'Limits' })).toBeInTheDocument();
    expect(screen.getByText('Guards.')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });
  it('DangerZone action fires', async () => {
    const onAction = vi.fn();
    render(<DangerZone title="Delete project" body="Removes rules." actionLabel="Delete project" onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete project' }));
    expect(onAction).toHaveBeenCalled();
  });
  it('SidePane is a labelled complementary region and Close fires', async () => {
    const onClose = vi.fn();
    render(<SidePane title="Edit rule" onClose={onClose} footer={<span>foot</span>}><p>x</p></SidePane>);
    const pane = screen.getByRole('complementary', { name: 'Edit rule' });
    expect(within(pane).getByText('foot')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
  it('SurfaceCard shows children and caption', () => {
    render(<SurfaceCard caption="Browser tab: title prefix."><span>mock</span></SurfaceCard>);
    expect(screen.getByText('mock')).toBeInTheDocument();
    expect(screen.getByText('Browser tab: title prefix.')).toBeInTheDocument();
  });
  it('SetupLayout composes the chrome, stepper, heading and footer', () => {
    render(
      <SetupLayout
        user={{ login: 'kim-hale', initials: 'KH' }}
        projectName="invoicer-api"
        steps={[{ label: 'One' }, { label: 'Two' }, { label: 'Three' }, { label: 'Four' }]}
        current={1}
        stepLabel="Step 2 of 4"
        title="Add Claude credential"
        intro={<>Intro text</>}
        aside={<p>aside</p>}
        footer={{ back: '/s1', skip: '/s3', next: { label: 'Continue', href: '/s3' } }}
      >
        <p>content</p>
      </SetupLayout>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Add Claude credential' })).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();
    expect(screen.getByText('invoicer-api')).toBeInTheDocument();
    expect(screen.getByText(/Progress is saved/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/s1');
    expect(screen.getByRole('link', { name: 'Skip' })).toHaveAttribute('href', '/s3');
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/s3');
    expect(screen.getByText('aside')).toBeInTheDocument();
    expect(document.querySelector('[aria-current="step"]')).toHaveTextContent('Two');
  });
  it('SetupLayout without back/skip renders only next', () => {
    render(
      <SetupLayout user={{ login: 'k' }} projectName="p" steps={[{ label: 'One' }]} current={0} stepLabel="Step 1 of 1" title="T" intro="i" footer={{ next: { label: 'Go', href: '/g' } }}>
        <p>c</p>
      </SetupLayout>,
    );
    expect(screen.queryByRole('link', { name: 'Back' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Skip' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Go' })).toBeInTheDocument();
  });
});

describe('ConfirmDeleteDialog', () => {
  const setup = (extra: Partial<Parameters<typeof ConfirmDeleteDialog>[0]> = {}) => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDeleteDialog open name="code-e2e" path=".claude/skills/code-e2e/" branch="main" defaultMessage="Remove code-e2e skill" onClose={onClose} onConfirm={onConfirm} {...extra} />,
    );
    return { onConfirm, onClose, btn: () => screen.getByRole('button', { name: 'Delete and commit' }), typed: () => screen.getByLabelText(/Type code-e2e to confirm/) };
  };
  it('is named and renders nothing when closed', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Delete skill code-e2e?' })).toBeInTheDocument();
  });
  it('closed renders no dialog', () => {
    render(<ConfirmDeleteDialog open={false} name="code-e2e" path="p" branch="main" defaultMessage="m" onClose={() => {}} onConfirm={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('stays disabled for empty, near-miss, wrong case and whitespace; enables on exact match', async () => {
    const { btn, typed, onConfirm } = setup();
    expect(btn()).toBeDisabled();
    for (const t of ['code-e2', 'Code-E2E', 'code-e2e ', ' code-e2e', 'code-e2ee']) {
      await userEvent.clear(typed());
      await userEvent.type(typed(), t);
      expect(btn()).toBeDisabled();
    }
    await userEvent.clear(typed());
    await userEvent.type(typed(), 'code-e2e');
    expect(btn()).toBeEnabled();
    await userEvent.click(btn());
    expect(onConfirm).toHaveBeenCalledWith('Remove code-e2e skill');
  });
  it('confirms with an edited commit message and never fires while disabled', async () => {
    const { btn, onConfirm } = setup();
    await userEvent.click(btn());
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText('Commit message'));
    await userEvent.type(screen.getByLabelText('Commit message'), 'bye');
    await userEvent.type(screen.getByLabelText(/Type code-e2e to confirm/), 'code-e2e');
    await userEvent.click(btn());
    expect(onConfirm).toHaveBeenCalledWith('bye');
  });
  it('resets typed text when the name changes while open', async () => {
    const props = { path: 'p', branch: 'main', defaultMessage: 'm', onClose: () => {}, onConfirm: () => {} };
    const { rerender } = render(<ConfirmDeleteDialog open name="code-e2e" {...props} />);
    await userEvent.type(screen.getByLabelText(/Type code-e2e to confirm/), 'code-e2e');
    expect(screen.getByRole('button', { name: 'Delete and commit' })).toBeEnabled();
    rerender(<ConfirmDeleteDialog open name="qa-e2e" {...props} />);
    expect(screen.getByLabelText(/Type qa-e2e to confirm/)).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Delete and commit' })).toBeDisabled();
  });
  it('shows the warning banner and Keep skill closes', async () => {
    const { onClose } = setup({ warning: <>Rule uses this skill.</> });
    expect(screen.getByText('Rule uses this skill.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep skill' }));
    expect(onClose).toHaveBeenCalled();
  });
});
