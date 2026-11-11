import type { Meta, StoryObj } from '@storybook/react-vite';
import { LabelChip } from '@/ds';
import { CodeBlock } from './CodeBlock';

const meta = {
  title: 'Components/CodeBlock',
  component: CodeBlock,
  args: { caption: <>Comment on an issue labelled <LabelChip name="user-story" color="var(--label-story)" /></>, code: '/code-build', onCopy: () => {} },
  decorators: [(S) => <div style={{ width: 640 }}><S /></div>],
} satisfies Meta<typeof CodeBlock>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const MultiLine: Story = { args: { caption: 'Comment', code: '/code-build\nPlease also update the changelog.' } };
