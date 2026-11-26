import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AgentModelsDto } from '@agentdesk/contracts';
import { toModelList } from './ModelPicker';
import { RuleForm, type RuleFormProps } from './RuleForm';
import { RuleRow } from './RuleRow';
import { RuleSentence, ruleAgentWarning, type RuleAgentOption, type RuleDraft } from './RuleSentence';

const agents: RuleAgentOption[] = [
  { id: 'a1', label: 'Claude - Personal', provider: 'claude', needsCredential: true, model: 'opus' },
  { id: 'a2', label: 'Codex - Work', provider: 'codex', needsCredential: true, model: 'gpt-5' },
  { id: 'a3', label: 'OpenCode - Own', provider: 'opencode', needsCredential: false },
];
const draft: RuleDraft = {
  command: 'code-build',
  target: 'issue',
  labels: [],
  skill: 'code-build',
  agentId: null,
  enabled: true,
};
const list = (ids: string[]) => {
  const data: AgentModelsDto = {
    source: 'live',
    models: ids.map((id) => ({ id, label: id })),
  } as AgentModelsDto;
  return toModelList({ status: 'success', data }, null);
};

function Stateful(props: Partial<RuleFormProps> & { value?: RuleDraft; onValue?: (v: RuleDraft) => void }) {
  const [value, setValue] = useState(props.value ?? draft);
  return (
    <RuleForm
      skills={['code-build']}
      agents={agents}
      defaultAgentName="Claude - Personal"
      modelField={{ list: list(['m1', 'm2']), help: 'Pick a model' }}
      {...props}
      value={value}
      onChange={(v) => {
        setValue(v);
        props.onValue?.(v);
      }}
    />
  );
}
const agentSelect = () => screen.getByLabelText('With agent');

describe('RuleForm agent selector', () => {
  it('lists Project default first, then the agents (BR-32)', () => {
    render(<Stateful />);
    const names = Array.from(agentSelect().querySelectorAll('option')).map((o) => o.textContent);
    expect(names).toEqual([
      'Project default (Claude - Personal)',
      'Claude - Personal',
      'Codex - Work',
      'OpenCode - Own',
    ]);
    expect(agentSelect()).toHaveAccessibleDescription(
      'Runs use the project default when this stays on Project default.',
    );
  });

  it('saves Project default as agentId null', async () => {
    const onValue = vi.fn();
    render(<Stateful value={{ ...draft, agentId: 'a2', agentLabel: 'Codex - Work' }} onValue={onValue} />);
    await userEvent.selectOptions(agentSelect(), 'Project default (Claude - Personal)');
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ agentId: null }));
  });

  it('resets Model to Default model when another agent is picked, then keeps a model of its list (BR-40)', async () => {
    const onValue = vi.fn();
    render(
      <Stateful value={{ ...draft, agentId: 'a1', agentLabel: 'Claude - Personal', model: 'm1' }} onValue={onValue} />,
    );
    expect(screen.getByLabelText('Model')).toHaveValue('m1');
    await userEvent.selectOptions(agentSelect(), 'Codex - Work');
    expect(onValue).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentId: 'a2', agentLabel: 'Codex - Work', model: null }),
    );
    expect(screen.getByLabelText('Model')).toHaveDisplayValue('Default model');
    await userEvent.selectOptions(screen.getByLabelText('Model'), 'm2');
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ agentId: 'a2', model: 'm2' }));
  });

  it("keeps a rule's own model with its agent", () => {
    render(<Stateful value={{ ...draft, agentId: 'a1', agentLabel: 'Claude - Personal', model: 'm2' }} />);
    expect(screen.getByLabelText('Model')).toHaveValue('m2');
  });

  it('names the chosen agent default model in the Model help', () => {
    render(<Stateful value={{ ...draft, agentId: 'a1', agentLabel: 'Claude - Personal' }} />);
    expect(screen.getByLabelText('Model')).toHaveAccessibleDescription(
      'Default model of Claude - Personal is opus, set on Agent & settings.',
    );
  });

  it('shows the loading state: disabled, with "Loading agents…"', () => {
    render(<Stateful agentsState="loading" value={{ ...draft, agentId: 'a1', agentLabel: 'Claude - Personal' }} />);
    expect(agentSelect()).toBeDisabled();
    expect(agentSelect()).toHaveDisplayValue('Claude - Personal');
    expect(screen.getByRole('option', { name: 'Loading agents…' })).toBeDisabled();
  });

  it('locks the select without agent:read and says why', () => {
    render(<Stateful agentLocked agents={[]} value={{ ...draft, agentId: 'a1', agentLabel: 'Claude - Personal' }} />);
    expect(agentSelect()).toBeDisabled();
    expect(agentSelect()).toHaveDisplayValue('Claude - Personal');
    expect(agentSelect()).toHaveAccessibleDescription('You can’t see the agent list. This rule keeps its agent.');
  });

  it('shows a deleted agent as unavailable with the spec text', () => {
    render(<Stateful value={{ ...draft, agentId: 'gone', agentLabel: 'Claude - Old', model: null }} />);
    expect(agentSelect()).toHaveDisplayValue('Claude - Old (unavailable)');
    expect(agentSelect()).toHaveAccessibleDescription(
      'This agent no longer exists. Pick another agent or the project default before you save.',
    );
    expect(screen.getByLabelText('Model')).toHaveAccessibleDescription(
      'The model of the deleted agent. Pick an agent to see its models.',
    );
  });
});

describe('rule row agent wording and warning', () => {
  const row = (agentId: string | null, agentLabel?: string) => ({ ...draft, id: 'r1', agentId, agentLabel });
  it('says "with <name>" or "with the project default agent"', () => {
    const { rerender } = render(<RuleSentence rule={row('a1', 'Claude - Personal')} variant="plain" />);
    expect(screen.getByText(/with Claude - Personal/)).toBeInTheDocument();
    rerender(<RuleSentence rule={row(null)} variant="plain" />);
    expect(screen.getByText(/with the project default agent/)).toBeInTheDocument();
  });

  it('warns for no_credential on Claude Code and Codex, and for rejected (BR-41)', () => {
    const w = (a: Partial<RuleAgentOption>) => ruleAgentWarning({ ...agents[0]!, ...a });
    const text = 'Claude - Personal has no working credential. Runs from this rule will fail.';
    expect(w({ connection: 'no_credential' })).toBe(text);
    expect(w({ connection: 'rejected' })).toBe(text);
    expect(w({ label: 'X', connection: 'no_credential' })).toBe(
      'X has no working credential. Runs from this rule will fail.',
    );
    expect(w({ connection: 'ok' })).toBeUndefined();
    expect(w({ connection: 'unreachable' })).toBeUndefined();
    expect(w({})).toBeUndefined();
  });

  it('shows no warning for an OpenCode agent with no credential (BR-41, BR-68)', () => {
    expect(ruleAgentWarning({ ...agents[2]!, connection: 'no_credential' })).toBeUndefined();
    expect(ruleAgentWarning({ ...agents[2]!, connection: 'rejected' })).toBeDefined();
  });

  it('puts the warning in the row', () => {
    render(
      <RuleRow
        rule={row('a1', 'Claude - Personal')}
        stats="s"
        warning={ruleAgentWarning({ ...agents[0]!, connection: 'no_credential' })}
        onToggle={() => {}}
      />,
    );
    expect(
      screen.getByText('Claude - Personal has no working credential. Runs from this rule will fail.'),
    ).toBeInTheDocument();
  });
});
