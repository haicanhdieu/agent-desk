import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { providerPickerOptions } from '@/mocks';
import { ProviderPicker, type ProviderPickerOption } from './ProviderPicker';

const options: ProviderPickerOption[] = [
  ...providerPickerOptions.runnable.map((o) => ({ kind: o.kind, label: o.label, logo: o.logo, available: true })),
  ...providerPickerOptions.comingSoon.map((o) => ({ kind: o.id, label: o.label, logo: o.logo, available: false })),
];

const meta = {
  title: 'Components/ProviderPicker',
  component: ProviderPicker,
  args: { options, value: null, onChange: fn() },
  decorators: [
    (S) => (
      <div style={{ maxWidth: 520 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof ProviderPicker>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing is picked: three cards and the Coming soon chips. */
export const NothingPicked: Story = {};
export const Picked: Story = { args: { value: 'opencode' } };
/** Edit pane: the choice is fixed. */
export const ReadOnly: Story = { args: { value: 'codex', readOnly: true } };
export const WithError: Story = { args: { error: 'Pick a provider.' } };

function Interactive() {
  const [value, setValue] = useState<string | null>(null);
  return <ProviderPicker options={options} value={value} onChange={setValue} />;
}
export const Selectable: Story = { render: () => <Interactive /> };
