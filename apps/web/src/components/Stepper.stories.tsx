import type { Meta, StoryObj } from '@storybook/react-vite';
import { Stepper } from './Stepper';

const steps = [
  { label: 'Connect repository', detail: 'harbor-labs/invoicer-api' },
  { label: 'Add Claude credential', detail: 'Claude Code token, opus' },
  { label: 'Add skills', optional: true, detail: 'code-build, code-review' },
  { label: 'Add first rule' },
];
const meta = {
  title: 'Components/Stepper',
  component: Stepper,
  decorators: [
    (S) => (
      <div style={{ width: 260 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof Stepper>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Step1: Story = { args: { steps, current: 0 } };
export const Step2: Story = { args: { steps, current: 1 } };
export const Step3Optional: Story = { args: { steps, current: 2 } };
export const Step4: Story = { args: { steps, current: 3 } };
export const AllDone: Story = { args: { steps: [{ label: 'Ready to trigger' }], current: 1 } };
