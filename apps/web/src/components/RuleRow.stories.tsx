import type { Meta, StoryObj } from '@storybook/react-vite';
import { RuleRow } from './RuleRow';

const rule = { id: 'r1', command: 'code-build', target: 'issue' as const, labels: ['user-story'], skill: 'code-build', agent: 'Claude', enabled: true };
const meta = {
  title: 'Components/RuleRow',
  component: RuleRow,
  args: { rule, stats: '14 runs this week, last 14:15', onToggle: () => {}, onSelect: () => {} },
  decorators: [(S) => <div style={{ width: 760, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}><S /></div>],
} satisfies Meta<typeof RuleRow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Enabled: Story = {};
export const Selected: Story = { args: { selected: true, rule: { ...rule, id: 'r2', command: 'code-review', target: 'pr', labels: [], skill: 'code-review' }, stats: '9 runs this week, last 14:09' } };
export const Disabled: Story = { args: { rule: { ...rule, enabled: false, command: 'qa-e2e', target: 'pr', labels: ['needs-qa'], skill: 'qa-e2e' }, stats: 'Turned off 3 Nov' } };
export const MissingSkillWarning: Story = {
  args: { rule: { ...rule, command: 'docs-update', target: 'pr', labels: [], skill: 'docs-update' }, stats: 'Never ran', warning: 'Skill docs-update is not in .claude/skills/ on main. Comments with /docs-update are ignored until you add it or pick another skill.' },
};
