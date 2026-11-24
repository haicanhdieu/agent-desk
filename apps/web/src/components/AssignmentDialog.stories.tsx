import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { assignmentProjects, assignmentRoles } from '@/mocks';
import { AssignmentDialog } from './AssignmentDialog';

const meta = {
  title: 'Components/AssignmentDialog',
  component: AssignmentDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    person: { name: 'Ada Lovelace', handle: 'ada' },
    roles: assignmentRoles,
    projects: assignmentProjects,
    values: { access: 'org', roleKey: '', projectId: '' },
    errors: {},
    saving: false,
    onChange: fn(),
    onSubmit: fn(),
    onClose: fn(),
  },
  decorators: [
    (S) => (
      <div style={{ position: 'relative', minHeight: 560 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof AssignmentDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Org: Story = {};
export const Project: Story = {
  args: { values: { access: 'project', roleKey: 'member', projectId: 'proj-api' } },
};
export const Saving: Story = {
  args: { values: { access: 'org', roleKey: 'owner', projectId: '' }, saving: true },
};
export const FormError: Story = {
  args: {
    values: { access: 'project', roleKey: 'member', projectId: 'proj-api' },
    formError: { title: 'Could not add the assignment.', requestId: '01JDK8Q3V2' },
  },
};
