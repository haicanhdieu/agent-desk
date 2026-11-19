import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { agentModelsFixtures } from '@/mocks/dto/agentModels';
import { toModelList } from './ModelPicker';
import { RuleForm, type RuleFormProps } from './RuleForm';
import type { RuleDraft } from './RuleSentence';
import { promptSystemLines, TRIAGE_PROMPT } from '@/mocks';

function Stateful(props: Omit<RuleFormProps, 'onChange'>) {
  const [value, setValue] = useState<RuleDraft>(props.value);
  return <RuleForm {...props} value={value} onChange={setValue} />;
}

const skills = ['code-build', 'code-review', 'code-e2e'];
const agents = ['Claude'];
const liveList = toModelList({ status: 'success', data: agentModelsFixtures.live }, null);
const modelField = { list: liveList, help: 'Default model is the one picked in step 2.' };
const meta = {
  title: 'Components/RuleForm',
  component: RuleForm,
  render: (args) => <Stateful {...args} />,
  decorators: [
    (S) => (
      <div style={{ width: 640 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof RuleForm>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CodeBuild: Story = {
  args: {
    skills,
    agents,
    agentLocked: true,
    onChange: () => {},
    value: {
      command: 'code-build',
      target: 'issue',
      labels: ['user-story'],
      skill: 'code-build',
      agent: 'Claude',
      enabled: true,
    },
  },
};
export const CodeReview: Story = {
  args: {
    skills,
    agents,
    agentLocked: true,
    onChange: () => {},
    value: {
      command: 'code-review',
      target: 'pr',
      labels: [],
      skill: 'code-review',
      agent: 'Claude',
      enabled: true,
    },
  },
};
export const MissingSkill: Story = {
  args: {
    skills,
    agents,
    onChange: () => {},
    value: {
      command: 'docs-update',
      target: 'any',
      labels: [],
      skill: 'docs-update',
      agent: 'Claude',
      enabled: false,
    },
  },
};
export const WithErrors: Story = {
  args: {
    skills,
    agents,
    agentLocked: true,
    onChange: () => {},
    value: {
      command: 'code-build',
      target: 'issue',
      labels: [],
      skill: 'code-build',
      agent: 'Claude',
      enabled: true,
    },
    errors: { command: 'Command already used', skill: 'This skill no longer exists' },
  },
};

const ready = { state: 'ready', systemLines: promptSystemLines } as const;
const triage: RuleDraft = {
  command: 'triage',
  target: 'issue',
  labels: [],
  skill: '',
  kind: 'prompt',
  prompt: TRIAGE_PROMPT,
  agent: 'Claude',
  enabled: true,
};

/** Skill / Custom prompt offered, skill chosen. */
export const SkillMode: Story = {
  args: {
    skills,
    agents,
    agentLocked: true,
    onChange: () => {},
    promptPreview: ready,
    value: { ...triage, command: 'code-build', labels: ['user-story'], skill: 'code-build', kind: 'skill' },
  },
};
export const PromptEmpty: Story = {
  args: {
    skills,
    agents,
    agentLocked: true,
    onChange: () => {},
    promptPreview: ready,
    value: { ...triage, prompt: '' },
  },
};
export const PromptFilled: Story = {
  args: { skills, agents, agentLocked: true, onChange: () => {}, promptPreview: ready, value: triage },
};
export const PromptOverLimit: Story = {
  args: {
    skills,
    agents,
    agentLocked: true,
    onChange: () => {},
    promptPreview: ready,
    value: { ...triage, prompt: `${TRIAGE_PROMPT}\n${'Check every linked issue as well. '.repeat(120)}` },
    errors: { prompt: 'Keep the prompt to 4000 characters or fewer.' },
  },
};
export const PromptPreviewLoading: Story = {
  args: { skills, agents, agentLocked: true, onChange: () => {}, promptPreview: { state: 'loading' }, value: triage },
};
export const PromptPreviewError: Story = {
  args: {
    skills,
    agents,
    agentLocked: true,
    onChange: () => {},
    promptPreview: { state: 'error', onRetry: () => {} },
    value: triage,
  },
};

/** The Model field: Default model first, then the provider's list, then Other model…. */
export const WithModelField: Story = {
  args: { skills, agents, agentLocked: true, onChange: () => {}, modelField, value: { ...triage, model: null } },
};
export const ModelPicked: Story = {
  args: {
    skills,
    agents,
    agentLocked: true,
    onChange: () => {},
    modelField,
    value: { ...triage, model: 'claude-haiku-4-5-20251001' },
  },
};
export const ModelTyped: Story = {
  args: { skills, agents, agentLocked: true, onChange: () => {}, modelField, value: { ...triage, model: 'sonnet' } },
};
export const ModelLoading: Story = {
  args: {
    skills,
    agents,
    agentLocked: true,
    onChange: () => {},
    modelField: { ...modelField, list: toModelList({ status: 'pending' }, null) },
    value: { ...triage, model: null },
  },
};
export const ModelListError: Story = {
  args: {
    skills,
    agents,
    agentLocked: true,
    onChange: () => {},
    modelField: { ...modelField, list: toModelList({ status: 'error' }, null) },
    value: { ...triage, model: null },
  },
};
export const ModelFieldError: Story = {
  args: {
    skills,
    agents,
    agentLocked: true,
    onChange: () => {},
    modelField,
    value: { ...triage, model: 'bad name' },
    errors: { model: 'Use 1 to 200 letters, digits or . _ : / @ [ ] + -, starting with a letter or digit.' },
  },
};
