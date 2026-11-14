import type { Meta, StoryObj } from '@storybook/react-vite';
import { SkillList } from './SkillList';

const skills = [
  { name: 'code-build', description: 'Implement a user-story issue end to end and open a PR.', ruleSummary: '2 rules' },
  {
    name: 'code-review',
    description: 'Review a PR, fix small issues, approve or request changes.',
    ruleSummary: '1 rule',
  },
  { name: 'code-e2e', description: 'Reproduce and fix a flaky end-to-end test.', ruleSummary: '1 rule' },
  { name: 'qa-e2e', description: 'Exploratory QA pass with Playwright on a PR preview.', ruleSummary: '1 rule, off' },
];
const meta = {
  title: 'Components/SkillList',
  component: SkillList,
  args: { skills, branch: 'main', activeName: 'code-build', onNew: () => {} },
  decorators: [
    (S) => (
      <div style={{ height: 480, display: 'flex' }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof SkillList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const OtherActive: Story = { args: { activeName: 'qa-e2e' } };
export const Empty: Story = { args: { skills: [], activeName: undefined } };
