import type { Meta, StoryObj } from '@storybook/react-vite';
import { RouteLoadError, RouteSkeleton } from './RouteStates';

const meta = {
  title: 'Components/RouteStates',
  parameters: { layout: 'padded' },
  decorators: [
    // The route's own main holds these states: they draw none themselves.
    (S) => (
      <main style={{ maxWidth: 720 }}>
        <S />
      </main>
    ),
  ],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = { render: () => <RouteSkeleton /> };

export const LoadError: Story = {
  render: () => <RouteLoadError title="Internal server error" requestId="req_01JD7Q3M8V2K" onRetry={() => undefined} />,
};

export const LoadErrorWithDetail: Story = {
  render: () => (
    <RouteLoadError
      title="Service unavailable"
      detail="The API did not answer in time."
      requestId="req_01JD7Q3M8V2K"
      onRetry={() => undefined}
    />
  ),
};
