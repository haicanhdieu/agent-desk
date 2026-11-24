import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { AddPlatformAdminDialog } from './AddPlatformAdminDialog';

const meta = {
  title: 'Components/AddPlatformAdminDialog',
  component: AddPlatformAdminDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    values: { email: '' },
    errors: {},
    saving: false,
    onChange: fn(),
    onSubmit: fn(),
    onClose: fn(),
  },
  decorators: [
    (S) => (
      <div style={{ position: 'relative', minHeight: 420 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof AddPlatformAdminDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};
export const Saving: Story = { args: { values: { email: 'new.person@example.com' }, saving: true } };
export const FieldError: Story = {
  args: { values: { email: 'nobody@example.com' }, errors: { email: 'No account has this email yet.' } },
};
export const FormError: Story = {
  args: {
    values: { email: 'new.person@example.com' },
    formError: { title: 'Could not add the platform admin.', requestId: '01JDK8Q3V2' },
  },
};
