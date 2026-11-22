import type { Meta, StoryObj } from '@storybook/react-vite';
import { orgSettingsFixtures } from '@/mocks';
import type { OrgSettingsTabKey } from '@/mocks/types';
import { OrgSettingsLayout } from './OrgSettingsLayout';

const base = `/o/${orgSettingsFixtures.org.slug}/settings`;
const tabsFor = (keys: OrgSettingsTabKey[]) => Object.fromEntries(keys.map((k) => [k, `${base}/${k}`]));

const meta = {
  title: 'Components/OrgSettingsLayout',
  component: OrgSettingsLayout,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (S) => (
      <div style={{ display: 'flex', flexDirection: 'column', height: 420 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof OrgSettingsLayout>;
export default meta;
type Story = StoryObj<typeof meta>;

const body = <div style={{ padding: 24 }}>Page content</div>;

export const Owner: Story = {
  args: { tabs: tabsFor(orgSettingsFixtures.tabs.owner), active: 'members', children: body },
};
export const Admin: Story = {
  args: { tabs: tabsFor(orgSettingsFixtures.tabs.admin), active: 'general', children: body },
};
export const ProjectAdmin: Story = {
  args: { tabs: tabsFor(orgSettingsFixtures.tabs.projectAdmin), active: 'invitations', children: body },
};
