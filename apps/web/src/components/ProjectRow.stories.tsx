import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { connections, projects } from '@/mocks';
import { DataTable } from './DataTable';
import { ProjectRow } from './ProjectRow';

const columns = ['Project', 'GitHub', 'Needs you', 'Running', 'Queued', 'Last run', ''].map((h) => ({
  key: h || 'more',
  header: h || <span className="sr-only">Actions</span>,
}));
const meta = {
  title: 'Components/ProjectRow',
  component: ProjectRow,
  parameters: { layout: 'padded' },
  decorators: [
    (S) => (
      <DataTable columns={columns}>
        <S />
      </DataTable>
    ),
  ],
} satisfies Meta<typeof ProjectRow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NeedsYou: Story = { args: { project: projects[0], href: '#' } };
export const Quiet: Story = { args: { project: projects[1], href: '#' } };
export const WebhookWarning: Story = { args: { project: projects[2], href: '#', switchToPollingHref: '#settings' } };
export const Polling: Story = { args: { project: { ...projects[1], connection: connections.pollingOk }, href: '#' } };
export const PollingFailed: Story = {
  args: { project: { ...projects[2], connection: connections.pollingRevoked }, href: '#' },
};
export const PollingRateLimited: Story = {
  args: { project: { ...projects[2], connection: connections.pollingRateLimited }, href: '#' },
};
export const LongRepo: Story = {
  args: { project: { ...projects[1], repo: `harbor-labs/${'very-long-'.repeat(8)}` }, href: '#' },
};

/** An unfinished setup: "Resume setup" sits before More. */
export const WithResume: Story = { args: { project: projects[1], href: '#', resumeHref: '#resume' } };
/** Without a resume href the button is left out (the other stories). */
export const WithoutResume: Story = { args: { project: projects[1], href: '#', settingsHref: '#settings' } };

/** A member or viewer: no "Agent & settings" item (the Desk is closed to them). */
export const MenuNoSettings: Story = {
  args: { project: projects[0], href: '#runs' },
  decorators: [
    (S) => (
      <div style={{ minHeight: 180 }}>
        <S />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /^More for/ }));
  },
};

/** The More menu: Runs and Agent & settings link out; Delete project (danger) shows for a caller who holds project:delete. */
export const MenuOpen: Story = {
  args: { project: projects[0], href: '#runs', settingsHref: '#settings', onDelete: () => undefined },
  decorators: [
    (S) => (
      <div style={{ minHeight: 180 }}>
        <S />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /^More for/ }));
  },
};
