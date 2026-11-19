import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { agentModelsFixtures } from '@/mocks/dto/agentModels';
import { ModelPicker, toModelList, type ModelPickerProps } from './ModelPicker';

const live = toModelList({ status: 'success', data: agentModelsFixtures.live }, null);
const builtin = (reason: keyof typeof agentModelsFixtures, baseUrl: string | null = null) =>
  toModelList({ status: 'success', data: agentModelsFixtures[reason] }, baseUrl);

/** Controlled wrapper so the stories react to picks and typing. */
function Stateful(props: ModelPickerProps) {
  const [value, setValue] = useState<string | null>(props.value);
  return <ModelPicker {...props} value={value} onChange={setValue} />;
}

const meta = {
  title: 'Components/ModelPicker',
  component: ModelPicker,
  render: (args) => <Stateful {...args} />,
  args: {
    label: 'Default model',
    list: live,
    value: 'claude-sonnet-4-5-20250929',
    onChange: () => undefined,
    help: "Rules that don't name a model use this one.",
    typedHelp: "Sent to Claude Code exactly as typed. Rules that don't name a model use this one.",
  },
  decorators: [
    (S) => (
      <div style={{ width: 420 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof ModelPicker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const LiveList: Story = {};
export const Loading: Story = {
  args: { list: toModelList({ status: 'pending' }, null), value: null, withDefault: true },
};
export const Error: Story = { args: { list: toModelList({ status: 'error' }, null), value: null, withDefault: true } };
export const FallbackNoCredential: Story = { args: { list: builtin('noCredential'), value: 'sonnet' } };
export const FallbackUnreachableWithHost: Story = {
  args: {
    list: builtin('unreachable', 'https://gateway.harbor-labs.com/v1/anthropic'),
    value: 'anthropic/claude-sonnet-4-5',
  },
};
export const FallbackUnreachableNoHost: Story = { args: { list: builtin('unreachable'), value: 'opus' } };
export const FallbackRejected: Story = { args: { list: builtin('rejected'), value: 'opus' } };
export const FallbackRejectedWithHost: Story = {
  args: { list: builtin('rejected', 'https://gateway.harbor-labs.com/v1/anthropic'), value: 'opus' },
};
export const FallbackEmpty: Story = { args: { list: builtin('empty'), value: 'opus' } };
export const FallbackDisabled: Story = { args: { list: builtin('disabled'), value: 'opus' } };
export const TypedModel: Story = { args: { value: 'anthropic/claude-sonnet-4-5' } };
export const SavedModelNotListed: Story = { args: { value: 'sonnet' } };
export const LongId: Story = { args: { value: 'a'.repeat(200) } };
export const WithDefaultOption: Story = {
  args: { label: 'Model', withDefault: true, value: null, help: 'Follows the agent default model.' },
};
export const WithError: Story = {
  args: {
    value: 'bad name',
    error: 'Use 1 to 200 letters, digits or . _ : / @ [ ] + -, starting with a letter or digit.',
  },
};
/** A saved listed model stays selected while the list loads. */
export const LoadingSavedModel: Story = {
  args: { list: toModelList({ status: 'pending' }, null), value: 'claude-sonnet-4-5-20250929' },
};
