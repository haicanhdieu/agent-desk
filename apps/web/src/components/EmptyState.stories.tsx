import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '@/ds';
import { EmptyState } from './EmptyState';

const meta = { title: 'Components/EmptyState', component: EmptyState } satisfies Meta<typeof EmptyState>;
export default meta;
type Story = StoryObj<typeof meta>;

export const TitleOnly: Story = { args: { title: 'No runs match these filters' } };
export const WithBodyAndAction: Story = {
  args: {
    title: 'No runs yet',
    body: 'Comment /build on a GitHub issue to start the first run.',
    action: (
      <Button variant="primary" href="#">
        Open GitHub
      </Button>
    ),
  },
};
