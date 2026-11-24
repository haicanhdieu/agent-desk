import type { Meta, StoryObj } from '@storybook/react-vite';
import { PlatformLayout } from './PlatformLayout';

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

export const Default: Story = { args: { children: body } };
export const OrgGroup: Story = {
  args: {
    active: 'overview',
    org: { state: 'ready', name: 'Acme', links: { overview: base } },
    children: body,
  },
};
export const OrgGroupAllTabs: Story = {
  args: {
    active: 'members',
    org: {
      state: 'ready',
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
export const OrgGroupLoading: Story = { args: { org: { state: 'loading' }, children: body } };
export const OrgGroupError: Story = {
  args: {
    active: 'members',
    org: {
      state: 'error',
      name: 'Organization',
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
