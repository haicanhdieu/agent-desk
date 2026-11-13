import type { Meta, StoryObj } from '@storybook/react-vite';
import { setupPlugins } from '@/mocks';
import { PluginList } from './PluginList';

const meta = {
  title: 'Components/PluginList',
  component: PluginList,
  args: { plugins: setupPlugins.planned },
  decorators: [
    (S) => (
      <div style={{ width: 312 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof PluginList>;
export default meta;
type Story = StoryObj<typeof meta>;

/** What the next run will do. */
export const Planned: Story = {};
/** What a test or run did, including a failed install. */
export const Result: Story = {
  args: { plugins: [...setupPlugins.result, { id: 'playwright@claude-plugins-official', state: 'failed' }] },
};
export const Empty: Story = { args: { plugins: [] } };
export const Loading: Story = { args: { loading: true } };
export const WithError: Story = {
  args: { error: 'Could not read .claude/settings.json: the repository is unreachable.' },
};
