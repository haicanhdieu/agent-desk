import type { Meta, StoryObj } from '@storybook/react-vite';
import { runUsageViews } from '@/mocks/runUsage';
import { RunUsage } from './RunUsage';
import { SidePanel } from './SidePanel';

const meta = {
  title: 'Components/RunUsage',
  component: RunUsage,
  decorators: [
    (S) => (
      <div style={{ height: 620, display: 'flex' }}>
        <SidePanel>
          <S />
        </SidePanel>
      </div>
    ),
  ],
} satisfies Meta<typeof RunUsage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SingleModel: Story = { args: { usage: runUsageViews.SingleModel } };
export const MultiModel: Story = { args: { usage: runUsageViews.MultiModel } };
/** The per-run call cap was reached: the cost is a lower bound. */
export const Partial: Story = { args: { usage: runUsageViews.Partial } };
export const UnpricedModel: Story = { args: { usage: runUsageViews.UnpricedModel } };
export const WithReasoning: Story = { args: { usage: runUsageViews.WithReasoning } };
export const NoUsage: Story = { args: { usage: runUsageViews.NoUsage } };
export const Zero: Story = { args: { usage: runUsageViews.Zero } };
export const LongModelName: Story = { args: { usage: runUsageViews.LongModelName } };
export const HostileModelName: Story = { args: { usage: runUsageViews.HostileModelName } };
export const Collapsed: Story = { args: { usage: runUsageViews.Collapsed, initialOpen: false } };
export const ModelsCollapsed: Story = { args: { usage: runUsageViews.ModelsCollapsed, initialModelsOpen: false } };
export const SinglePriceDate: Story = { args: { usage: runUsageViews.SinglePriceDate } };
export const PriceDateRange: Story = { args: { usage: runUsageViews.PriceDateRange } };
