import type { Meta, StoryObj } from '@storybook/react-vite';
import { RuleSentence } from './RuleSentence';

const rule = {
  command: 'code-build',
  target: 'issue' as const,
  labels: ['user-story'],
  skill: 'code-build',
  agent: 'Claude',
  enabled: true,
};
const meta = {
  title: 'Components/RuleSentence',
  component: RuleSentence,
  decorators: [
    (S) => (
      <div style={{ width: 640 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof RuleSentence>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SlotsIssue: Story = { args: { rule, variant: 'slots' } };
export const SlotsPullRequest: Story = {
  args: { rule: { ...rule, command: 'code-review', target: 'pr', labels: [], skill: 'code-review' }, variant: 'slots' },
};
export const SlotsAny: Story = { args: { rule: { ...rule, target: 'any', labels: [] }, variant: 'slots' } };
export const Plain: Story = { args: { rule, variant: 'plain' } };
export const PlainPullRequest: Story = {
  args: { rule: { ...rule, command: 'code-review', target: 'pr', labels: [], skill: 'code-review' }, variant: 'plain' },
};
