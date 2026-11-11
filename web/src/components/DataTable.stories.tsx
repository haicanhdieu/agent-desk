import type { Meta, StoryObj } from '@storybook/react-vite';
import { DataTable } from './DataTable';

const meta = { title: 'Components/DataTable', component: DataTable } satisfies Meta<typeof DataTable>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Projects: Story = {
  args: {
    columns: [
      { key: 'repo', header: 'Repository' }, { key: 'skills', header: 'Skills', width: 120 },
      { key: 'runs', header: 'Active runs', align: 'right', width: 140 },
    ],
    children: (
      <>
        <tr><td>acme/billing-service</td><td>3</td><td style={{ textAlign: 'right' }}>2</td></tr>
        <tr><td>acme/customer-portal</td><td>2</td><td style={{ textAlign: 'right' }}>0</td></tr>
      </>
    ),
  },
};
