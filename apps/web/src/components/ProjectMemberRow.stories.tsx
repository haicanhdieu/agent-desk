import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { projectMemberRows } from '@/mocks';
import type { ProjectMemberRowView } from '@/mocks/types';
import { DataTable } from './DataTable';
import { ProjectMemberRow, projectMemberColumns } from './ProjectMemberRow';

const meta = {
  title: 'Components/ProjectMemberRow',
  component: ProjectMemberRow,
  parameters: { layout: 'padded' },
  args: { onChangeRole: fn(), onRemove: fn() },
  decorators: [
    (S) => (
      <DataTable columns={projectMemberColumns}>
        <S />
      </DataTable>
    ),
  ],
} satisfies Meta<typeof ProjectMemberRow>;
export default meta;
type Story = StoryObj<typeof meta>;

const find = (pick: (r: ProjectMemberRowView) => boolean): ProjectMemberRowView => {
  const r = projectMemberRows.find(pick);
  if (!r) throw new Error('no matching project member fixture');
  return r;
};

/** Another person with the Admin role: the menu is shown. */
export const Admin: Story = { args: { row: { ...find((r) => r.handle === 'cleo'), roles: 'Admin' } } };
export const Member: Story = { args: { row: find((r) => r.roles === 'Member' && r.handle === 'cleo') } };
export const Viewer: Story = { args: { row: find((r) => r.roles === 'Viewer' && r.handle === 'dana') } };
export const SeveralRoles: Story = { args: { row: find((r) => r.roles === 'Member, Viewer') } };
/** Access through an org-wide role only: labelled Organization, no actions menu. */
export const Inherited: Story = { args: { row: find((r) => r.inherited) } };
/** An org-wide role plus a project role: both shown, the menu changes the project part only. */
export const OrgAndProjectRole: Story = { args: { row: find((r) => r.orgRoles !== '' && !r.inherited) } };
/** The own row: tagged You, no actions menu (BR-11). */
export const You: Story = { args: { row: find((r) => r.you) } };
export const LongName: Story = { args: { row: find((r) => r.handle === 'alexandria') } };
export const Busy: Story = { args: { row: find((r) => r.handle === 'cleo'), busy: true } };
