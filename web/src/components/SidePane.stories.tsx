import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '@/ds';
import { SidePane } from './SidePane';
import { RuleForm } from './RuleForm';

const meta = {
  title: 'Components/SidePane',
  component: SidePane,
  parameters: { layout: 'fullscreen' },
  decorators: [(S) => <div style={{ display: 'flex', justifyContent: 'flex-end', height: 640 }}><S /></div>],
} satisfies Meta<typeof SidePane>;
export default meta;
type Story = StoryObj<typeof meta>;

export const EditRule: Story = {
  args: {
    title: 'Edit rule',
    onClose: () => {},
    children: (
      <RuleForm
        value={{ command: 'code-review', target: 'pr', labels: [], skill: 'code-review', agent: 'Claude (opus)', enabled: true }}
        skills={['code-build', 'code-review']}
        agents={['Claude (opus)']}
        agentLocked
        onChange={() => {}}
      />
    ),
    footer: (
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="danger" icon="trash">Delete rule</Button>
        <span style={{ flex: 1 }} />
        <Button variant="ghost">Cancel</Button>
        <Button variant="primary">Save rule</Button>
      </div>
    ),
  },
};
export const Narrow: Story = { args: { title: 'Details', width: 360, onClose: () => {}, children: <p className="muted">Content</p> } };
