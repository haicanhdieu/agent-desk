import type { Meta, StoryObj } from '@storybook/react-vite';
import { Meter } from './Meter';

const meta = { title: 'Components/Meter', component: Meter, decorators: [(S) => <div style={{ width: 312 }}><S /></div>] } satisfies Meta<typeof Meter>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Run: Story = { args: { value: 460, max: 1800, 'aria-label': '26% of run time limit used' } };
export const Late: Story = { args: { value: 1800, max: 1800, tone: 'late', 'aria-label': '100% of run time limit used' } };
export const Empty: Story = { args: { value: 0, max: 1800, 'aria-label': '0% of run time limit used' } };
export const OverMax: Story = { args: { value: 2400, max: 1800, tone: 'late', 'aria-label': '100% of run time limit used' } };
