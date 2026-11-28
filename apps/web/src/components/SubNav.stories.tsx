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

const groups = [
  {
    heading: 'Desk',
    items: [
      { label: 'Runs', href: '#', icon: 'runs' as const, active: true, badge: 3 },
      { label: 'Routing rules', href: '#', icon: 'rule' as const },
    ],
  },
];

export const WithBadge: Story = { args: { 'aria-label': 'Desk', groups } };
export const WithBackLink: Story = {
  args: { 'aria-label': 'Desk', groups, back: { label: 'All projects', href: '#' }, onToggleCollapsed: () => {} },
};
export const WithHeaderAndFooter: Story = {
  args: { 'aria-label': 'Desk', groups, header: <strong>invoicer-api</strong>, footer: <span>v1.2</span> },
};
export const Loading: Story = {
  args: { 'aria-label': 'Desk', groups, state: 'loading', back: { label: 'All projects', href: '#' } },
};
export const ErrorState: Story = { args: { 'aria-label': 'Desk', groups, state: 'error', onRetry: () => {} } };
export const Collapsed: Story = {
  args: { 'aria-label': 'Desk', groups, collapsed: true, onToggleCollapsed: () => {} },
};
