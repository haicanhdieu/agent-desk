import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { manyPickerOptions, memberPickerOptions } from '@/mocks';
import type { MemberPickerOption } from '@/mocks/types';
import { MemberPicker, type MemberPickerProps } from './MemberPicker';

const meta = {
  title: 'Components/MemberPicker',
  component: MemberPicker,
  parameters: { layout: 'padded' },
  args: {
    query: '',
    options: memberPickerOptions,
    total: memberPickerOptions.length,
    hasMore: false,
    state: { kind: 'idle' },
    picked: null,
    orgName: 'Acme',
    onQueryChange: fn(),
    onPick: fn(),
    onLoadMore: fn(),
  },
  decorators: [
    (S) => (
      <div style={{ width: 360, minHeight: 360 }}>
        <S />
      </div>
    ),
  ],
  render: (args) => <OpenPicker {...args} />,
  // The list opens on focus, so the stories focus the field to show it open.
  play: ({ canvasElement }) => {
    canvasElement.querySelector('input')?.focus();
  },
} satisfies Meta<typeof MemberPicker>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Keeps typing and picking live around the controlled picker. */
function OpenPicker(args: MemberPickerProps) {
  const [query, setQuery] = useState(args.query);
  const [picked, setPicked] = useState<MemberPickerOption | null>(args.picked);
  return (
    <MemberPicker
      {...args}
      id="story-picker"
      query={query}
      picked={picked}
      onQueryChange={(q) => {
        setQuery(q);
        setPicked(null);
        args.onQueryChange(q);
      }}
      onPick={(o) => {
        setPicked(o);
        setQuery('');
        args.onPick(o);
      }}
    />
  );
}

const retry = fn();

export const EmptyInput: Story = {};
export const Results: Story = { args: { query: 'a' } };
export const Selected: Story = { args: { picked: memberPickerOptions[0] ?? null } };
export const Loading: Story = { args: { options: [], total: 0, state: { kind: 'loading' } } };
export const Searching: Story = { args: { query: 'mi', state: { kind: 'searching' } } };
export const Error: Story = { args: { options: [], total: 0, state: { kind: 'error', onRetry: retry } } };
export const NoMatch: Story = { args: { query: 'zz', options: [], total: 0 } };
export const AllAdded: Story = { args: { options: [], total: 0 } };
export const MorePages: Story = {
  args: { options: manyPickerOptions.slice(0, 20), total: 45, hasMore: true },
};
export const LoadingMore: Story = {
  args: { options: manyPickerOptions.slice(0, 20), total: 45, hasMore: true, state: { kind: 'loadingMore' } },
};
export const LoadMoreError: Story = {
  args: {
    options: manyPickerOptions.slice(0, 20),
    total: 45,
    hasMore: true,
    state: { kind: 'loadMoreError', onRetry: retry },
  },
};
/** 200 people: only the visible window is in the DOM. */
export const LongList: Story = { args: { options: manyPickerOptions, total: 200 } };
export const LongName: Story = {
  args: {
    options: [
      {
        userId: 'user-long',
        name: `Alexandria ${'Montgomery-Featherstonehaugh '.repeat(3)}`.trim(),
        handle: 'alexandria',
      },
      ...memberPickerOptions,
    ],
    total: 6,
  },
};
