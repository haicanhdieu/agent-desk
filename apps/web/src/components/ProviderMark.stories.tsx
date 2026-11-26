import type { Meta, StoryObj } from '@storybook/react-vite';
import { providerPickerOptions } from '@/mocks';
import { ProviderMark, type ProviderMarkProps } from './ProviderMark';

const meta = { title: 'Components/ProviderMark', component: ProviderMark } satisfies Meta<typeof ProviderMark>;
export default meta;
type Story = StoryObj<typeof meta>;

const runnable = providerPickerOptions.runnable.map((c) => ({ kind: c.logo, label: c.label }));
const comingSoon = providerPickerOptions.comingSoon.map((c) => ({ kind: c.logo, label: c.label }));

function Grid({ size, tint, items }: Pick<ProviderMarkProps, 'size' | 'tint'> & { items: typeof runnable }) {
  return (
    <ul style={{ display: 'flex', flexWrap: 'wrap', gap: 16, listStyle: 'none', margin: 0, padding: 0 }}>
      {items.map((p) => (
        <li key={p.kind} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ProviderMark kind={p.kind} label={p.label} size={size} tint={tint} />
          <span>{p.label}</span>
        </li>
      ))}
    </ul>
  );
}

export const Default: Story = { args: { kind: 'claude', label: 'Claude Code', size: 'md' } };
export const AllSmall: Story = {
  args: { kind: 'claude', label: 'Claude Code', size: 'md' },
  render: () => <Grid size="sm" items={[...runnable, ...comingSoon]} />,
};
export const AllMedium: Story = {
  args: { kind: 'claude', label: 'Claude Code', size: 'md' },
  render: () => <Grid size="md" items={[...runnable, ...comingSoon]} />,
};
export const AllLarge: Story = {
  args: { kind: 'claude', label: 'Claude Code', size: 'md' },
  render: () => <Grid size="lg" items={[...runnable, ...comingSoon]} />,
};
export const MutedTint: Story = {
  args: { kind: 'claude', label: 'Claude Code', size: 'md' },
  render: () => <Grid size="md" tint="muted" items={comingSoon} />,
};
export const MonogramFallback: Story = { args: { kind: 'not-a-provider', label: 'Future agent', size: 'lg' } };
