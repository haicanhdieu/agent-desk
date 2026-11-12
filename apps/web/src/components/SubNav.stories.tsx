import type { Meta, StoryObj } from '@storybook/react-vite';
import { SubNav } from './SubNav';

const meta = { title: 'Components/SubNav', component: SubNav } satisfies Meta<typeof SubNav>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    'aria-label': 'Desk',
    groups: [
      {
        heading: 'Desk',
        items: [
          { label: 'Skills', href: '#', icon: 'skill-file', active: true },
          { label: 'Routing rules', href: '#', icon: 'rule' },
          { label: 'Agent & settings', href: '#', icon: 'bot' },
        ],
      },
      { heading: 'Repository', content: <span className="mono">invoicer-api</span> },
    ],
  },
};
