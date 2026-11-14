import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FilterChip, FilterChips } from './FilterChip';

const meta = { title: 'Components/FilterChip', component: FilterChip } satisfies Meta<typeof FilterChip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = { args: { label: 'Running', count: 1, on: false, onClick: () => {} } };
export const On: Story = { args: { label: 'All', count: 7, on: true, onClick: () => {} } };
/** A chip that is a link to a filtered URL (the Runs page). */
export const AsLink: Story = { args: { label: 'Queued', count: 1, on: false, href: '/runs?filter=queued' } };

function GroupDemo() {
  const [sel, setSel] = useState('All');
  const items: [string, number][] = [
    ['All', 7],
    ['Needs you', 1],
    ['Running', 1],
    ['Queued', 1],
    ['Failed', 1],
  ];
  return (
    <FilterChips aria-label="Filter runs by status">
      {items.map(([l, c]) => (
        <FilterChip key={l} label={l} count={c} on={sel === l} onClick={() => setSel(l)} />
      ))}
    </FilterChips>
  );
}

export const Group: Story = {
  args: { label: 'All', on: true, onClick: () => {} },
  render: () => <GroupDemo />,
};
