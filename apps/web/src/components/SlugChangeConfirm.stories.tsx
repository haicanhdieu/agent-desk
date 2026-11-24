import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { SlugChangeConfirm } from './SlugChangeConfirm';

const meta = {
  title: 'Components/SlugChangeConfirm',
  component: SlugChangeConfirm,
  parameters: { layout: 'fullscreen' },
  args: {
    from: 'acme',
    to: 'acme-robotics',
    closing: 'Share the new link with your members.',
    onConfirm: fn(),
    onCancel: fn(),
  },
  decorators: [
    (S) => (
      <div style={{ position: 'relative', minHeight: 300 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof SlugChangeConfirm>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Busy: Story = { args: { busy: true } };
