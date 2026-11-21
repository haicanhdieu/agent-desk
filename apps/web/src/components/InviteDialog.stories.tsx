import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { invitationLink, inviteProjectOptions, inviteRoleOptions } from '@/mocks';
import { InviteDialog, type InviteDialogStep, type InviteDialogValues } from './InviteDialog';

const empty: InviteDialogValues = { email: '', roleId: '', scope: 'org', projectIds: [] };
const filled: InviteDialogValues = { email: 'new.person@example.com', roleId: 'member', scope: 'org', projectIds: [] };
const form = (
  values: InviteDialogValues,
  extra: Partial<Extract<InviteDialogStep, { kind: 'form' }>> = {},
): InviteDialogStep => ({ kind: 'form', values, errors: {}, saving: false, ...extra });

const meta = {
  title: 'Components/InviteDialog',
  component: InviteDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    step: form(empty),
    roles: inviteRoleOptions.owner,
    projects: inviteProjectOptions,
    projectsOnly: false,
    onChange: fn(),
    onSubmit: fn(),
    onCancel: fn(),
    onCopy: fn(),
    onDone: fn(),
  },
  decorators: [
    (S) => (
      <div style={{ position: 'relative', minHeight: 640 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof InviteDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

const firstProject = inviteProjectOptions[0];

export const Default: Story = {};
export const ProjectScope: Story = {
  args: { step: form({ ...filled, scope: 'projects', projectIds: firstProject ? [firstProject.id] : [] }) },
};
export const ProjectAdmin: Story = {
  args: {
    step: form({ ...filled, roleId: 'viewer', scope: 'projects' }),
    roles: inviteRoleOptions.projectAdmin,
    projects: inviteProjectOptions.slice(0, 1),
    projectsOnly: true,
  },
};
export const Saving: Story = { args: { step: form(filled, { saving: true }) } };
export const FieldError: Story = {
  args: {
    step: form(
      { email: 'not-an-email', roleId: '', scope: 'projects', projectIds: [] },
      {
        errors: {
          email: 'Enter a valid email address.',
          roleId: 'Choose a role.',
          projectIds: 'Choose at least one project.',
        },
      },
    ),
  },
};
export const FormError: Story = {
  args: { step: form(filled, { formError: 'Could not create the invitation. Try again.' }) },
};
export const Created: Story = {
  args: { step: { kind: 'created', email: filled.email, expiresOn: 'Nov 23, 2026', link: invitationLink } },
};
