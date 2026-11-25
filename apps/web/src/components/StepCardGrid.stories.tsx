import type { Meta, StoryObj } from '@storybook/react-vite';
import { StepCardGrid } from './StepCardGrid';

const meta = {
  title: 'Components/StepCardGrid',
  component: StepCardGrid,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof StepCardGrid>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SetupSteps: Story = {
  args: {
    steps: [
      { title: 'Connect a repo', body: 'Install the GitHub App on one repository.' },
      { title: 'Add an agent', body: 'Choose the agent you work with and add its credential.' },
      { title: 'Add skills', body: 'Start from templates or use skills already in the repo.' },
      { title: 'Add a rule', body: 'Map a comment like /code-build to a skill.' },
    ],
  },
};
