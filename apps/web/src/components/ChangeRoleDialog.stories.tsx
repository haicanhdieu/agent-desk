import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, userEvent, within } from 'storybook/test';
import { roleCards } from '@/mocks';
import { ChangeRoleDialog } from './ChangeRoleDialog';

const ownerId = roleCards.ownerCaller[0]?.roleId ?? null;
const memberId = roleCards.ownerCaller[2]?.roleId ?? null;

const meta = {
  title: 'Components/ChangeRoleDialog',
  component: ChangeRoleDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    memberName: 'Dana Whitfield',
    orgName: 'Acme',
    options: roleCards.adminCaller,
    current: memberId,
    self: false,
    currentIsOwner: false,
    saving: false,
    onSave: fn(),
    onCancel: fn(),
  },
  decorators: [
    (S) => (
      <div style={{ position: 'relative', minHeight: 640 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof ChangeRoleDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

const pick =
  (name: string): Story['play'] =>
  async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('radio', { name }));
  };

/** An admin caller: no Owner card. */
export const Default: Story = {};
export const OwnerCaller: Story = { args: { options: roleCards.ownerCaller } };
export const OwnerPicked: Story = { args: { options: roleCards.ownerCaller }, play: pick('Owner') };
const ownSelf = {
  options: roleCards.ownerCaller,
  current: ownerId,
  self: true,
  currentIsOwner: true,
  memberName: 'Alex Rivera',
};
export const StepDown: Story = { args: ownSelf, play: pick('Admin') };
export const LastOwner: Story = { args: { ...ownSelf, error: { kind: 'lastOwner' } }, play: pick('Member') };
export const Saving: Story = { args: { saving: true, current: ownerId, options: roleCards.ownerCaller } };
export const Error: Story = { args: { error: { kind: 'forbidden', requestId: 'req_7f3a91c2' } } };
