import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { invitationLink } from '@/mocks';
import { InviteLink } from './InviteLink';

const meta = {
  title: 'Components/InviteLink',
  component: InviteLink,
  args: { link: invitationLink, onCopy: fn() },
  decorators: [
    (S) => (
      <div style={{ maxWidth: 560, padding: 16 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof InviteLink>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const CopyFailed: Story = { args: { copyFailed: true } };
