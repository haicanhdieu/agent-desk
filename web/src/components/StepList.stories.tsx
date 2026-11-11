import type { Meta, StoryObj } from '@storybook/react-vite';
import { CommandChip, StatusBadge, TicketRef } from '@/ds';
import { StepLine, StepList } from './StepList';

const meta = { title: 'Components/StepList', component: StepList, parameters: { layout: 'padded' } } satisfies Meta<typeof StepList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const OneTicketTwoRuns: Story = {
  args: {
    items: [
      <><span>You comment <CommandChip>/code-build</CommandChip> on</span><StepLine><TicketRef kind="issue" number={142} /><b>Export invoices as CSV</b></StepLine></>,
      <StepLine><StatusBadge status="running" /><span className="muted">Run 60 builds the feature and opens</span><TicketRef kind="pr" number={148} /></StepLine>,
      <StepLine><StatusBadge status="idle" variant="pill">Needs you</StatusBadge><span className="muted">Run 62 asks you one question</span></StepLine>,
    ],
  },
};
