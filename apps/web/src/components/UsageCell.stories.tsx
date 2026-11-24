import type { Meta, StoryObj } from '@storybook/react-vite';
import { usageCellNoCost, usageCellNone, usageCellPartial, usageCellValue } from '@/mocks/usage';
import { UsageCell } from './UsageCell';

const meta = {
  title: 'Components/UsageCell',
  component: UsageCell,
  decorators: [
    (Story) => (
      <table>
        <tbody>
          <tr>
            <Story />
          </tr>
        </tbody>
      </table>
    ),
  ],
} satisfies Meta<typeof UsageCell>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Value: Story = { args: { usage: usageCellValue } };
export const Partial: Story = { args: { usage: usageCellPartial } };
export const NoCost: Story = { args: { usage: usageCellNoCost } };
export const None: Story = { args: { usage: usageCellNone } };
