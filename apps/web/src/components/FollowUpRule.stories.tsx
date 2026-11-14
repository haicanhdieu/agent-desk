import type { Meta, StoryObj } from '@storybook/react-vite';
import { FollowUpRule } from './FollowUpRule';

const meta = {
  title: 'Components/FollowUpRule',
  component: FollowUpRule,
  args: { command: 'code-review', target: 'pr', skill: 'code-review', enabled: true },
  decorators: [
    (S) => (
      <div style={{ width: 720 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof FollowUpRule>;
export default meta;
type Story = StoryObj<typeof meta>;

export const On: Story = {};
export const Off: Story = { args: { enabled: false } };
