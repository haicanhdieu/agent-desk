import type { Meta, StoryObj } from '@storybook/react-vite';
import { PlatformLayout } from './PlatformLayout';

const links = { orgs: '/platform/orgs', admins: '/platform/admins', audit: '/platform/audit' };
const base = '/platform/orgs/org-1';

const meta = {
  title: 'Components/PlatformLayout',
  component: PlatformLayout,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (S) => (
      <div style={{ display: 'flex', flexDirection: 'column', height: 420 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof PlatformLayout>;
export default meta;
type Story = StoryObj<typeof meta>;

const body = <div style={{ padding: 24 }}>Page content</div>;

export const Default: Story = { args: { active: 'orgs', links, children: body } };
export const OrgGroup: Story = {
  args: {
    active: 'overview',
    links,
    org: { name: 'Acme', links: { overview: base } },
    children: body,
  },
};
export const OrgGroupAllTabs: Story = {
  args: {
    active: 'members',
    links,
    org: {
      name: 'Harbor Labs International Holdings of the North Atlantic',
      links: {
        overview: base,
        projects: `${base}/projects`,
        members: `${base}/members`,
        invitations: `${base}/invitations`,
      },
    },
    children: body,
  },
};
