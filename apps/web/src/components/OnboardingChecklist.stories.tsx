import type { Meta, StoryObj } from '@storybook/react-vite';
import { checklistSteps } from '@/mocks';
import { OnboardingChecklist } from './OnboardingChecklist';

const meta = {
  title: 'Components/OnboardingChecklist',
  component: OnboardingChecklist,
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 560, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OnboardingChecklist>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NoneDone: Story = { args: { state: { kind: 'ready', steps: checklistSteps.none } } };
export const Partial: Story = { args: { state: { kind: 'ready', steps: checklistSteps.partial } } };
export const Loading: Story = { args: { state: { kind: 'loading' } } };
export const Error: Story = {
  args: { state: { kind: 'error', requestId: '01JDK8Q3V2', onRetry: () => undefined } },
};
