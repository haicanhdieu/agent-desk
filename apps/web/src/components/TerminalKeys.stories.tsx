import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { TerminalKeys } from './TerminalKeys';

const meta = {
  title: 'Components/TerminalKeys',
  component: TerminalKeys,
  args: { onKey: fn() },
} satisfies Meta<typeof TerminalKeys>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WrappedNarrow: Story = {
  decorators: [
    (S) => (
      <div style={{ width: 180 }}>
        <S />
      </div>
    ),
  ],
};
