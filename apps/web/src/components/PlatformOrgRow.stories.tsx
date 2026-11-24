import type { Meta, StoryObj } from '@storybook/react-vite';
import { platformOrgRows, type PlatformOrgRowView } from '@/mocks/platform/orgs';
import { DataTable } from './DataTable';
import { PlatformOrgRow, platformOrgColumns } from './PlatformOrgRow';

const meta = {
  title: 'Components/PlatformOrgRow',
  component: PlatformOrgRow,
  parameters: { layout: 'padded' },
  decorators: [
    (S) => (
      <DataTable columns={platformOrgColumns}>
        <S />
      </DataTable>
    ),
  ],
} satisfies Meta<typeof PlatformOrgRow>;
export default meta;
type Story = StoryObj<typeof meta>;

const pick = (pred: (r: PlatformOrgRowView) => boolean): PlatformOrgRowView => {
  const r = platformOrgRows.find(pred);
  if (!r) throw new Error('no matching platform org fixture');
  return r;
};

export const Default: Story = { args: { row: pick((r) => r.status === 'active' && !!r.owner && !!r.lastActivity) } };
export const Suspended: Story = { args: { row: pick((r) => r.status === 'suspended') } };
export const NoOwner: Story = { args: { row: pick((r) => r.owner === null) } };
export const NoActivity: Story = { args: { row: pick((r) => r.lastActivity === null) } };
export const LongName: Story = { args: { row: pick((r) => r.name.length > 60) } };
