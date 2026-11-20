import type { Meta, StoryObj } from '@storybook/react-vite';
import { skillDiffDraft, skills } from '../mocks';
import { SkillDiff } from './SkillDiff';

const codeBuild = skills.find((s) => s.name === 'code-build');
const body = codeBuild?.body ?? '';

const meta = {
  title: 'Components/SkillDiff',
  component: SkillDiff,
  decorators: [
    (Story) => (
      <div style={{ display: 'flex', flexDirection: 'column', height: 480 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SkillDiff>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithChanges: Story = { args: { base: body, draft: skillDiffDraft } };
export const Empty: Story = { args: { base: body, draft: body } };
