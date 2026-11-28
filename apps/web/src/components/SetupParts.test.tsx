import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GuardsCard } from './GuardsCard';
import { FollowUpRule } from './FollowUpRule';
import { SkillTemplateCard } from './SkillTemplateCard';
import { Stepper } from './Stepper';
import { SecretField } from './SecretField';
import { ruleAgentOptions } from '@/mocks';
import { RuleForm } from './RuleForm';

describe('GuardsCard ids', () => {
  it('two instances get distinct labelled regions', () => {
    render(
      <>
        <GuardsCard maxRunsPerTicket={1} />
        <GuardsCard maxRunsPerTicket={2} />
      </>,
    );
    const regions = screen.getAllByRole('region', { name: 'Guards on every rule' });
    expect(regions).toHaveLength(2);
    const ids = screen.getAllByRole('heading', { level: 2 }).map((h) => h.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('FollowUpRule', () => {
  it('reads the board copy and toggles', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <FollowUpRule command="code-review" target="pr" skill="code-review" enabled onChange={onChange} />,
    );
    expect(container).toHaveTextContent('Also add the follow-up rule/code-reviewon pull requests, runcode-review');
    await userEvent.click(screen.getByRole('switch', { name: 'Also add code-review rule' }));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe('SkillTemplateCard', () => {
  it('is a checkbox with note and a Preview button that calls onPreview without ticking', async () => {
    const onChange = vi.fn();
    const onPreview = vi.fn();
    render(
      <SkillTemplateCard
        template={{ name: 'code-build', note: 'chains to code-review', description: 'd' }}
        checked
        onChange={onChange}
        onPreview={onPreview}
      />,
    );
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByText('chains to code-review')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Preview code-build' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Preview code-build' }));
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: /code-build/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox').getAttribute('aria-labelledby')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /code-build/ })).not.toHaveAccessibleName(/Preview/);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe('Stepper ready', () => {
  it('adds a final Ready step that is never aria-current', () => {
    const { container } = render(<Stepper steps={[{ label: 'A' }]} current={1} ready="Ready to trigger" />);
    expect(screen.getByText('Ready to trigger')).toBeInTheDocument();
    expect(container.querySelector('[aria-current]')).toBeNull();
  });
});

describe('SecretField entry options', () => {
  it('hideSubmit drops the button; custom reveal label and help show', () => {
    render(
      <SecretField
        state="entering"
        credentialType="oauth_token"
        hideSubmit
        revealLabel="Show token while typing"
        entryHelp="Use a dedicated token."
      />,
    );
    expect(screen.queryByRole('button', { name: 'Save and test' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show token while typing' })).toBeInTheDocument();
    expect(screen.getByText('Use a dedicated token.')).toBeInTheDocument();
  });
});

describe('RuleForm agent', () => {
  it('"With agent" shows the agent name only', () => {
    render(
      <RuleForm
        value={{
          command: 'a',
          target: 'issue',
          labels: [],
          skill: 's',
          agentId: 'agent-claude',
          agentLabel: 'Claude',
          enabled: true,
        }}
        skills={['s']}
        agents={ruleAgentOptions}
        agentLocked
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText('With agent')).toHaveDisplayValue('Claude');
  });
});
