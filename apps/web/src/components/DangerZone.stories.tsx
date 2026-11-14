import type { Meta, StoryObj } from '@storybook/react-vite';
import { DangerZone } from './DangerZone';

const meta = {
  title: 'Components/DangerZone',
  component: DangerZone,
  args: {
    title: 'Delete project',
    body: 'Removes rules, run history and the stored credential. Skills stay in the repo. The GitHub App stays installed until you remove it on GitHub.',
    actionLabel: 'Delete project',
  },
  decorators: [
    (S) => (
      <div style={{ width: 620 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof DangerZone>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
