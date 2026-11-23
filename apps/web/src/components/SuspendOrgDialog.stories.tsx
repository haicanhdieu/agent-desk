import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { SuspendOrgDialog } from './SuspendOrgDialog';

const meta = {
  title: 'Components/SuspendOrgDialog',
  component: SuspendOrgDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    mode: 'suspend',
    orgName: 'Acme',
    open: true,
    reason: '',
    saving: false,
    onReason: fn(),
    onSubmit: fn(),
    onClose: fn(),
  },
  decorators: [
    (S) => (
      <div style={{ position: 'relative', minHeight: 460 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof SuspendOrgDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Suspend: Story = {};
export const SuspendSaving: Story = { args: { reason: 'Billing hold', saving: true } };
export const SuspendFieldError: Story = { args: { error: 'Give a reason of 1 to 500 characters.' } };
export const SuspendFormError: Story = {
  args: {
    reason: 'Billing hold',
    formError: { title: 'Could not suspend the organization.', requestId: '01JDK8Q3V2' },
  },
};
export const Reactivate: Story = { args: { mode: 'reactivate', orgName: 'Acme' } };
