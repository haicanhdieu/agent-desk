import type { Meta, StoryObj } from '@storybook/react-vite';
import { transcriptFixtures } from '@/mocks';
import { Transcript } from './Transcript';

const meta = {
  title: 'Components/Transcript',
  component: Transcript,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ display: 'flex', flexDirection: 'column', height: 560 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Transcript>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { state: 'ready', items: transcriptFixtures.default } };
export const Long: Story = { args: { state: 'ready', items: transcriptFixtures.long, hasEarlier: true } };
export const Truncated: Story = { args: { state: 'ready', items: transcriptFixtures.truncated } };
export const ToolSteps: Story = { args: { state: 'ready', items: transcriptFixtures.toolSteps } };
export const Notices: Story = { args: { state: 'ready', items: transcriptFixtures.notices } };
export const Markdown: Story = { args: { state: 'ready', items: transcriptFixtures.markdown } };
export const Loading: Story = { args: { state: 'loading', items: [] } };
export const Error: Story = { args: { state: 'error', items: [], requestId: '01JDK8Q3V2' } };
export const ErrorNoRequestId: Story = { args: { state: 'error', items: [] } };
export const Empty: Story = { args: { state: 'ready', items: [] } };
