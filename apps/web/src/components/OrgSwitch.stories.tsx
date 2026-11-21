import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { orgSwitchFixtures } from '@/mocks';
import { OrgSwitch } from './OrgSwitch';

const links = { orgHref: (o: { slug: string }) => `/o/${o.slug}`, createHref: '/orgs/new' };

const meta = {
  title: 'Components/OrgSwitch',
  component: OrgSwitch,
  args: links,
  decorators: [
    (Story) => (
      <div style={{ minHeight: 220, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OrgSwitch>;
export default meta;
type Story = StoryObj<typeof meta>;

const openOnLoad: Story['play'] = async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole('button', { name: /^Switch organization/ }));
};

export const OneOrg: Story = { args: orgSwitchFixtures.oneOrg };
export const SeveralOrgs: Story = { args: orgSwitchFixtures.severalOrgs };
export const Open: Story = { args: orgSwitchFixtures.severalOrgs, play: openOnLoad };
export const PlatformAdmin: Story = { args: orgSwitchFixtures.platformAdmin, play: openOnLoad };
export const PlatformAdminNoOrg: Story = { args: orgSwitchFixtures.platformAdminNoOrg, play: openOnLoad };
export const LongName: Story = { args: orgSwitchFixtures.longName, play: openOnLoad };
