import type { Meta, StoryObj } from '@storybook/react-vite';
import { OrgStatus } from './OrgStatus';

const meta = {
  title: 'Components/OrgStatus',
  component: OrgStatus,
} satisfies Meta<typeof OrgStatus>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = { args: { status: 'active' } };
export const Suspended: Story = { args: { status: 'suspended' } };
