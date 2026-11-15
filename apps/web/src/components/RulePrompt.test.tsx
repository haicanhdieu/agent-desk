import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { promptSystemLines, TRIAGE_PROMPT } from '@/mocks';
import { PromptSystemPart } from './PromptSystemPart';
import { RuleForm, type RuleFormProps } from './RuleForm';
import { RuleRow } from './RuleRow';
import { promptFirstLine, RuleSentence, type RuleDraft } from './RuleSentence';
import { RunPromptSection } from './RunPromptSection';

const skillDraft: RuleDraft = {
  command: 'code-build',
  target: 'issue',
  labels: [],
  skill: 'code-build',
  agent: 'Claude',
  enabled: true,
};
const promptDraft: RuleDraft = { ...skillDraft, command: 'triage', skill: '', kind: 'prompt', prompt: TRIAGE_PROMPT };
const ready = { state: 'ready', systemLines: promptSystemLines } as const;

function Stateful(props: Omit<RuleFormProps, 'onChange' | 'skills' | 'agents'>) {
  const [value, setValue] = useState(props.value);
  return <RuleForm {...props} skills={['code-build']} agents={['Claude']} value={value} onChange={setValue} />;
}

describe('RuleForm, rule kind', () => {
  it('stays skill only without a prompt preview (the live app today)', () => {
    render(<Stateful value={promptDraft} />);
    expect(screen.queryByRole('radio', { name: 'Custom prompt' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Run skill')).toBeInTheDocument();
    expect(screen.queryByLabelText('Prompt')).not.toBeInTheDocument();
  });

  it('offers Skill / Custom prompt and switches to the prompt fields', async () => {
    const onChange = vi.fn();
    render(
      <RuleForm
        value={skillDraft}
        skills={['code-build']}
        agents={['Claude']}
        onChange={onChange}
        promptPreview={ready}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Skill' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Skill')).toHaveValue('code-build');
    await userEvent.click(screen.getByRole('radio', { name: 'Custom prompt' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...skillDraft, kind: 'prompt' });
  });

  it('shows the prompt with a counter, the storage hint and the read-only system lines', async () => {
    render(<Stateful value={{ ...promptDraft, prompt: '' }} promptPreview={ready} />);
    const prompt = screen.getByLabelText('Prompt');
    expect(prompt).toHaveAccessibleDescription(expect.stringContaining('0 / 4000'));
    expect(prompt).toHaveAccessibleDescription(expect.stringContaining("Don't paste passwords or tokens"));
    await userEvent.type(prompt, 'Hi{Enter}there');
    expect(prompt).toHaveValue('Hi\nthere');
    expect(prompt).toHaveAccessibleDescription(expect.stringContaining('8 / 4000'));
    const sys = screen.getByRole('group', { name: "Added by Agent Desk (can't be edited)" });
    expect(within(sys).getByText(/^Ticket:/)).toBeInTheDocument();
    expect(within(sys).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('marks the prompt invalid with its error and flags the counter over the limit', () => {
    const { container } = render(
      <Stateful
        value={{ ...promptDraft, prompt: 'x'.repeat(4001) }}
        promptPreview={ready}
        errors={{ prompt: 'Keep the prompt to 4000 characters or fewer.' }}
      />,
    );
    const prompt = screen.getByLabelText('Prompt');
    expect(prompt).toHaveAttribute('aria-invalid', 'true');
    expect(prompt).toHaveAccessibleDescription(expect.stringContaining('Keep the prompt to 4000 characters'));
    expect(screen.getByText('4001 / 4000').className).toMatch(/counterOver/);
    expect(container.querySelector('[aria-invalid="true"]')).toBe(prompt);
  });
});

describe('PromptSystemPart', () => {
  it('sets placeholders off from the fixed text', () => {
    render(<PromptSystemPart preview={ready} />);
    expect(screen.getByText('<text after /command>').className).toMatch(/sysPh/);
  });

  it('is busy while loading', () => {
    render(<PromptSystemPart preview={{ state: 'loading' }} />);
    expect(screen.getByRole('group')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading the lines Agent Desk adds')).toBeInTheDocument();
  });

  it('shows an error with Retry', async () => {
    const onRetry = vi.fn();
    render(<PromptSystemPart preview={{ state: 'error', onRetry }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the lines Agent Desk adds');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('says so when Agent Desk adds nothing', () => {
    render(<PromptSystemPart preview={{ state: 'ready', systemLines: [] }} />);
    expect(screen.getByText('Agent Desk adds nothing to this prompt.')).toBeInTheDocument();
  });
});

describe('prompt rules in sentences and rows', () => {
  it('promptFirstLine skips blank lines and trims', () => {
    expect(promptFirstLine('\n  Triage it.  \nThen stop.')).toBe('Triage it.');
    expect(promptFirstLine(undefined)).toBe('');
  });

  it('the row shows "Custom prompt" and the first line where the skill goes', () => {
    render(<RuleRow rule={{ ...promptDraft, id: 'r6' }} stats="5 runs" onToggle={() => {}} />);
    expect(screen.getByText('Custom prompt')).toBeInTheDocument();
    expect(screen.getByText(promptFirstLine(TRIAGE_PROMPT))).toBeInTheDocument();
  });

  it('the slot sentence names a custom prompt; a skill rule keeps its wording', () => {
    const { rerender, container } = render(<RuleSentence rule={promptDraft} variant="slots" />);
    expect(container).toHaveTextContent('run a custom prompt with agent Claude.');
    rerender(<RuleSentence rule={skillDraft} variant="slots" />);
    expect(container).toHaveTextContent('run skill code-build with agent Claude.');
  });
});

describe('RunPromptSection', () => {
  it('is collapsed by default and expands on Show', async () => {
    render(<RunPromptSection finalPrompt={'line one\nline two'} />);
    const toggle = screen.getByRole('button', { name: 'Show' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Final prompt' })).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Final prompt' })).toHaveTextContent('line one line two');
  });

  it('says Not recorded for a run started before prompts were kept', () => {
    render(<RunPromptSection finalPrompt={null} />);
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
