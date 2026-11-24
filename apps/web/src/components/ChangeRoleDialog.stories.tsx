import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, userEvent, within } from 'storybook/test';
import { accessProjectGrants, accessProjects, projectRoleCards, roleCards } from '@/mocks';
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
    projectAccess: { grants: [], projects: accessProjects, roles: projectRoleCards, canEdit: true },
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

/** An admin caller: no Owner card, no project grants yet. */
export const Default: Story = {};
const withGrants = { grants: accessProjectGrants, projects: accessProjects, roles: projectRoleCards, canEdit: true };
/** The member's project grants, each with a role select and a remove button. */
export const ProjectGrants: Story = { args: { projectAccess: withGrants } };
/** Picking a project and a role, ready to press Add project. */
export const AddProject: Story = {
  args: { projectAccess: withGrants },
  play: async ({ canvasElement }) => {
    await userEvent.selectOptions(
      within(canvasElement).getByRole('combobox', { name: 'Project to add' }),
      'storefront',
    );
  },
};
/** A project grant changed: Save access is on. */
export const ProjectChanged: Story = {
  args: { projectAccess: withGrants },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Remove access to invoicer-web' }));
  },
};
/** Read-only project list: the caller may change the org role only. */
export const ProjectReadOnly: Story = { args: { projectAccess: { ...withGrants, canEdit: false } } };
/** The project Members page uses the same dialog without the Project access section. */
export const RoleOnly: Story = { args: { projectAccess: undefined } };
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
export const Saving: Story = {
  args: { saving: true, current: ownerId, options: roleCards.ownerCaller, projectAccess: withGrants },
};
export const Error: Story = {
  args: { error: { kind: 'forbidden', requestId: 'req_7f3a91c2' }, projectAccess: withGrants },
};
