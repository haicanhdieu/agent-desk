import type { Meta, StoryObj } from '@storybook/react-vite';
import { setupVersions } from '@/mocks';
import { VersionHistory } from './VersionHistory';

const meta = {
  title: 'Components/VersionHistory',
  component: VersionHistory,
  args: { versions: setupVersions },
  decorators: [
    (S) => (
      <div style={{ width: 312 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof VersionHistory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const OnlyOne: Story = { args: { versions: setupVersions.slice(-1) } };
export const Empty: Story = { args: { versions: [] } };
export const Loading: Story = { args: { loading: true } };
export const WithError: Story = { args: { error: 'Could not load the version history. Reload to try again.' } };
