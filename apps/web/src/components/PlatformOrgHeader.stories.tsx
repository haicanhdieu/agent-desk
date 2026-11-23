import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { PlatformOrgHeader } from './PlatformOrgHeader';

const meta = {
  title: 'Components/PlatformOrgHeader',
  component: PlatformOrgHeader,
  args: {
    name: 'Acme',
    slug: 'acme',
    status: 'active',
    auditHref: '/platform/audit?org=acme',
    onSuspend: fn(),
    onReactivate: fn(),
  },
  decorators: [
    (S) => (
      <div style={{ padding: 16 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof PlatformOrgHeader>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {};
export const Suspended: Story = { args: { status: 'suspended' } };
