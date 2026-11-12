import type { Meta, StoryObj } from '@storybook/react-vite';
import { connectionCopy } from '@/mocks';
import { ProjectMenu, ProjectSwitch } from './ProjectSwitch';

const meta = { title: 'Components/ProjectSwitch', component: ProjectSwitch } satisfies Meta<typeof ProjectSwitch>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Button: Story = { args: { org: 'harbor-labs', project: 'invoicer-api' } };
export const LongName: Story = { args: { org: 'harbor-labs', project: 'a-very-long-repository-name-that-keeps-going-and-going-and-going-forever' } };
export const OpenMenu: Story = {
  args: { org: 'harbor-labs', project: 'invoicer-api' },
  render: (args) => (
    <div style={{ width: 320, background: 'var(--panel)', border: '1px solid var(--line2)', borderRadius: 10 }}>
      <div style={{ padding: '8px 16px' }}><ProjectSwitch {...args} /></div>
      <ProjectMenu
        items={[
          { name: 'invoicer-api', needsYou: 1, current: true, href: '#' },
          { name: 'invoicer-web', needsYou: 0, href: '#' },
          { name: 'docs-site', needsYou: 0, warning: 'webhooks', href: '#' },
        ]}
      />
    </div>
  ),
};
export const MenuWithPolling: Story = {
  args: { org: 'harbor-labs', project: 'invoicer-api' },
  render: (args) => (
    <div style={{ width: 320, background: 'var(--panel)', border: '1px solid var(--line2)', borderRadius: 10 }}>
      <div style={{ padding: '8px 16px' }}><ProjectSwitch {...args} /></div>
      <ProjectMenu
        items={[
          { name: 'invoicer-api', needsYou: 1, current: true, href: '#' },
          { name: 'invoicer-web', needsYou: 0, href: '#' },
          { name: 'docs-site', needsYou: 0, warning: connectionCopy.menuWarning.polling, warningTone: 'err', href: '#' },
          { name: 'billing-jobs', needsYou: 0, warning: connectionCopy.menuWarning.webhook, href: '#' },
        ]}
      />
    </div>
  ),
};
