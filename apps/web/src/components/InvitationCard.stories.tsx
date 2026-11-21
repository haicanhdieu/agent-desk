import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { invitationCards } from '@/mocks';
import type { InvitationCardView } from '@/mocks/types';
import { InvitationCard } from './InvitationCard';

const meta = {
  title: 'Components/InvitationCard',
  component: InvitationCard,
  args: { pending: null, onAccept: fn(), onDecline: fn() },
  decorators: [
    (S) => (
      <div style={{ maxWidth: 560, padding: 16 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof InvitationCard>;
export default meta;
type Story = StoryObj<typeof meta>;

const at = (i: number): InvitationCardView => {
  const c = invitationCards[i];
  if (!c) throw new Error(`no invitation card ${i}`);
  return c;
};

export const Default: Story = { args: { card: at(0) } };
export const ProjectScope: Story = { args: { card: at(1) } };
export const Accepting: Story = { args: { card: at(0), pending: 'accept' } };
export const InviterDeleted: Story = { args: { card: at(2) } };
