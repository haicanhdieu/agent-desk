import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { editOrgDirtyValues, editOrgFieldErrors, editOrgFormError, editOrgSlugTaken, editOrgValues } from '@/mocks';
import { EditOrgDialog } from './EditOrgDialog';

const meta = {
  title: 'Components/EditOrgDialog',
  component: EditOrgDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    values: editOrgValues,
    errors: {},
    dirty: false,
    saving: false,
    onChange: fn(),
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
} satisfies Meta<typeof EditOrgDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};
export const Dirty: Story = { args: { values: editOrgDirtyValues, dirty: true } };
export const Saving: Story = { args: { values: editOrgDirtyValues, dirty: true, saving: true } };
export const FieldErrors: Story = {
  args: { values: { name: '', slug: 'Acme!' }, dirty: true, errors: editOrgFieldErrors },
};
export const SlugTaken: Story = {
  args: { values: { name: 'Acme', slug: 'taken' }, dirty: true, errors: editOrgSlugTaken },
};
export const FormError: Story = { args: { values: editOrgDirtyValues, dirty: true, formError: editOrgFormError } };
