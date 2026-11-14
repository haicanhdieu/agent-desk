import type { Meta, StoryObj } from '@storybook/react-vite';
import { runDetails, terminalByRun } from '@/mocks';
import { RunTerminalArea } from './RunTerminalArea';

const meta = {
  title: 'Screens/RunTerminalArea',
  component: RunTerminalArea,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (S) => (
      <div style={{ height: 520, display: 'flex', flexDirection: 'column' }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof RunTerminalArea>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The agent declared the task done: Finish is offered, the terminal stays open. */
export const Done: Story = {
  args: {
    data: { ...runDetails.RunDone, agentNote: 'Opened PR #148 with the CSV export and tests.' },
    lines: terminalByRun[62],
  },
};

/** The agent asked a question: its note shows above the usual body. */
export const NeedsYouWithNote: Story = {
  args: {
    data: { ...runDetails.RunIdle, agentNote: 'Should the export include voided invoices?' },
    lines: terminalByRun[62],
  },
};
