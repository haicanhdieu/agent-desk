import type { Meta, StoryObj } from '@storybook/react-vite';
import { OrgNav } from './OrgNav';

const meta = {
  title: 'Components/OrgNav',
  component: OrgNav,
  args: { projectsHref: '/o/acme/projects', settingsHref: '/o/acme/settings' },
  decorators: [
    (Story) => (
      <div style={{ height: 52 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OrgNav>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ProjectsActive: Story = { args: { active: 'projects' } };
export const SettingsActive: Story = { args: { active: 'settings' } };
export const NoSettings: Story = { args: { active: 'projects', settingsHref: undefined } };
export const NoneActive: Story = {};
