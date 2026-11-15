import type { Meta, StoryObj } from '@storybook/react-vite';
import { promptSystemLines } from '@/mocks';
import { PromptSystemPart } from './PromptSystemPart';

const meta = {
  title: 'Components/PromptSystemPart',
  component: PromptSystemPart,
  decorators: [
    (S) => (
      <div style={{ width: 512 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof PromptSystemPart>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = { args: { preview: { state: 'ready', systemLines: promptSystemLines } } };
export const Loading: Story = { args: { preview: { state: 'loading' } } };
export const LoadError: Story = { args: { preview: { state: 'error', onRetry: () => {} } } };
export const Empty: Story = { args: { preview: { state: 'ready', systemLines: [] } } };
