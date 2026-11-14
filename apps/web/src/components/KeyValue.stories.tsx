import type { Meta, StoryObj } from '@storybook/react-vite';
import { KeyValue } from './KeyValue';

const meta = {
  title: 'Components/KeyValue',
  component: KeyValue,
  decorators: [
    (S) => (
      <div style={{ width: 312 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof KeyValue>;
export default meta;
type Story = StoryObj<typeof meta>;

const items = [
  { term: 'Skill', value: <span className="mono">code-build</span> },
  { term: 'Agent', value: 'Claude' },
  { term: 'Started', value: <span className="num">14:05:12</span> },
];
export const Default: Story = { args: { items } };
export const Wide120: Story = { args: { items, termWidth: 120 } };
export const Wide150: Story = { args: { items, termWidth: 150 } };
