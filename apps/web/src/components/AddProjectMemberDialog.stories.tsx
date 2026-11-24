import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { memberPickerOptions, projectRoleCards } from '@/mocks';
import type { MemberPickerOption } from '@/mocks/types';
import { AddProjectMemberDialog, type AddProjectMemberDialogProps } from './AddProjectMemberDialog';

const meta = {
  title: 'Components/AddProjectMemberDialog',
  component: AddProjectMemberDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    projectName: 'api',
    orgName: 'Acme',
    picker: {
      query: '',
      onQueryChange: fn(),
      options: memberPickerOptions,
      total: memberPickerOptions.length,
      hasMore: false,
      state: { kind: 'idle' },
      picked: null,
      onPick: fn(),
      onLoadMore: fn(),
    },
    roles: projectRoleCards,
    roleId: null,
    errors: {},
    saving: false,
    onRoleChange: fn(),
    onSubmit: fn(),
    onCancel: fn(),
  },
  decorators: [
    (S) => (
      <div style={{ position: 'relative', minHeight: 680 }}>
        <S />
      </div>
    ),
  ],
  render: (args) => <Live {...args} />,
} satisfies Meta<typeof AddProjectMemberDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Keeps picking a person and a role live around the controlled dialog. */
function Live(args: AddProjectMemberDialogProps) {
  const [picked, setPicked] = useState<MemberPickerOption | null>(args.picker.picked);
  const [roleId, setRoleId] = useState<string | null>(args.roleId);
  return (
    <AddProjectMemberDialog
      {...args}
      roleId={roleId}
      onRoleChange={(id) => {
        setRoleId(id);
        args.onRoleChange(id);
      }}
      picker={{
        ...args.picker,
        picked,
        onPick: (o) => {
          setPicked(o);
          args.picker.onPick(o);
        },
      }}
    />
  );
}

const first = memberPickerOptions[0] ?? null;
const viewer = projectRoleCards[2]?.roleId ?? null;

export const Default: Story = {};
export const Picked: Story = { args: { picker: { ...meta.args.picker, picked: first }, roleId: viewer } };
export const FieldErrors: Story = {
  args: { errors: { userId: 'Choose a person.', roleId: 'Choose a role.' } },
};
export const Saving: Story = {
  args: { picker: { ...meta.args.picker, picked: first }, roleId: viewer, saving: true },
};
export const FormError: Story = {
  args: {
    picker: { ...meta.args.picker, picked: first },
    roleId: viewer,
    formError: { title: 'Something went wrong', detail: 'Try again in a moment.', requestId: 'req-7f3a91' },
  },
};
export const GoneFromOrg: Story = {
  args: {
    picker: { ...meta.args.picker, picked: first },
    roleId: viewer,
    errors: { userId: 'This person is no longer in the organization.' },
  },
};
export const AlreadyOnProject: Story = {
  args: {
    roleId: viewer,
    formError: {
      title: 'This person already has a role on this project.',
      detail: 'Use Change role to change it.',
    },
  },
};
