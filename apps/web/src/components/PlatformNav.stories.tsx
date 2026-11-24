import type { Meta, StoryObj } from '@storybook/react-vite';
import { PlatformNav } from './PlatformNav';

const meta = {
  title: 'Components/PlatformNav',
  component: PlatformNav,
  args: { links: { orgs: '/platform/orgs', admins: '/platform/admins', audit: '/platform/audit' } },
  decorators: [
    (Story) => (
      <div style={{ height: 52 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PlatformNav>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { active: 'orgs' } };
export const AdminsActive: Story = { args: { active: 'admins' } };
