import type { Meta, StoryObj } from '@storybook/react-vite';
import { TerminalFindBar } from './TerminalFindBar';

const meta = {
  title: 'Components/TerminalFindBar',
  component: TerminalFindBar,
  args: {
    query: 'setup',
    total: 4,
    current: 0,
    onQueryChange: () => undefined,
    onNext: () => undefined,
    onPrev: () => undefined,
    onClose: () => undefined,
  },
} satisfies Meta<typeof TerminalFindBar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithMatches: Story = {};
export const Empty: Story = { args: { query: '', total: 0 } };
export const NoMatches: Story = { args: { query: 'zzz', total: 0 } };
