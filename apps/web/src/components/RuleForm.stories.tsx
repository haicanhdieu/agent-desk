import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { RuleForm, type RuleFormProps } from './RuleForm';
import type { RuleDraft } from './RuleSentence';

function Stateful(props: Omit<RuleFormProps, 'onChange'>) {
  const [value, setValue] = useState<RuleDraft>(props.value);
  return <RuleForm {...props} value={value} onChange={setValue} />;
}

const skills = ['code-build', 'code-review', 'code-e2e'];
const agents = ['Claude (opus)'];
const meta = {
  title: 'Components/RuleForm',
  component: RuleForm,
  render: (args) => <Stateful {...args} />,
  decorators: [(S) => <div style={{ width: 640 }}><S /></div>],
} satisfies Meta<typeof RuleForm>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CodeBuild: Story = {
  args: { skills, agents, agentLocked: true, onChange: () => {}, value: { command: 'code-build', target: 'issue', labels: ['user-story'], skill: 'code-build', agent: 'Claude (opus)', enabled: true } },
};
export const CodeReview: Story = {
  args: { skills, agents, agentLocked: true, onChange: () => {}, value: { command: 'code-review', target: 'pr', labels: [], skill: 'code-review', agent: 'Claude (opus)', enabled: true } },
};
export const MissingSkill: Story = {
  args: { skills, agents, onChange: () => {}, value: { command: 'docs-update', target: 'any', labels: [], skill: 'docs-update', agent: 'Claude (opus)', enabled: false } },
};
export const WithErrors: Story = {
  args: {
    skills, agents, agentLocked: true, onChange: () => {},
    value: { command: 'code-build', target: 'issue', labels: [], skill: 'code-build', agent: 'Claude (opus)', enabled: true },
    errors: { command: 'Command already used', skill: 'This skill no longer exists' },
  },
};
