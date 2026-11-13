import type { Meta, StoryObj } from '@storybook/react-vite';
import { setupPhases } from '@/mocks';
import { SetupPhases } from './SetupPhases';

const meta = {
  title: 'Components/SetupPhases',
  component: SetupPhases,
  args: { phases: setupPhases.passed },
} satisfies Meta<typeof SetupPhases>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Passed: Story = {};
export const Failed: Story = { args: { phases: setupPhases.failed } };
export const Running: Story = { args: { phases: setupPhases.running } };
