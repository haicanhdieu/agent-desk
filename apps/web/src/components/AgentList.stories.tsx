import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, userEvent, within } from 'storybook/test';
import { agentRowView, agentRowViews, manyAgents } from '@/mocks';
import type { AgentRowView } from '@/mocks/types';
import { AgentList } from './AgentList';
import { viewport } from '@/screens/viewports';

const noop = () => undefined;
const paging = {
  page: 1,
  pageSize: 20 as const,
  total: agentRowViews.length,
  onPageChange: noop,
  onPageSizeChange: noop,
};

const meta = {
  title: 'Components/AgentList',
  component: AgentList,
  parameters: { layout: 'padded' },
  args: {
    rows: agentRowViews,
    state: 'ready',
    pagination: paging,
    onAdd: fn(),
    onRetry: fn(),
    onEdit: fn(),
    onTest: fn(),
    onSetDefault: fn(),
    onDelete: fn(),
  },
} satisfies Meta<typeof AgentList>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Also the stale state: cached rows stay on screen while a refetch runs. */
export const Populated: Story = {};
export const Loading: Story = { args: { rows: [], state: 'loading' } };
/** The fallback of BR-62: its own Add agent button. */
export const Empty: Story = { args: { rows: [], state: 'empty' } };
export const LoadError: Story = { args: { rows: [], state: 'error', error: { requestId: 'req_8f3a21' } } };
/** Page 2 of 24: "Showing 21–24 of 24" pinned under the rows. */
export const Paged: Story = {
  args: {
    rows: manyAgents(24).slice(20).map(agentRowView),
    pagination: { ...paging, page: 2, total: 24 },
  },
};
export const Testing: Story = { args: { testingId: agentRowViews[1].id } };
export const Busy: Story = { args: { busyId: agentRowViews[1].id } };
export const ReadOnly: Story = { args: { readOnly: true } };
export const OnlyAgent: Story = {
  args: { rows: agentRowViews.slice(0, 1), pagination: { ...paging, total: 1 } },
};
export const RowMenuOpen: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: `Actions for ${agentRowViews[1].name}` }));
  },
};

function MovingDefault({ rows }: { rows: AgentRowView[] }) {
  const [defaultId, setDefaultId] = useState(rows[0].id);
  return (
    <AgentList
      rows={rows.map((r) => ({ ...r, isDefault: r.id === defaultId }))}
      state="ready"
      pagination={paging}
      onAdd={noop}
      onRetry={noop}
      onEdit={noop}
      onTest={noop}
      onDelete={noop}
      onSetDefault={(a) => setDefaultId(a.id)}
    />
  );
}
/** Set as default moves the Default chip to the chosen row. */
export const DefaultChanged: Story = {
  render: () => <MovingDefault rows={agentRowViews} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: `Actions for ${agentRowViews[1].name}` }));
    await userEvent.click(c.getByRole('button', { name: 'Set as default' }));
  },
};

/** Phone (BR-65): stacked rows, the heading and Add agent wrap, the pager stays under the rows. */
export const Phone: Story = { args: { pagination: { ...paging, total: 24 } }, globals: viewport(390, 844) };
export const PhoneLoading: Story = { args: { rows: [], state: 'loading' }, globals: viewport(390, 844) };
export const PhoneEmpty: Story = { args: { rows: [], state: 'empty' }, globals: viewport(390, 844) };
export const PhoneError: Story = {
  args: { rows: [], state: 'error', error: { requestId: 'req_8f3a21' } },
  globals: viewport(390, 844),
};
