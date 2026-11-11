import type { Meta, StoryObj } from '@storybook/react-vite';

function Welcome() {
  return <p>Agent Desk design system</p>;
}

const meta = { title: 'Foundations/Welcome', component: Welcome } satisfies Meta<typeof Welcome>;
export default meta;

export const Default: StoryObj<typeof meta> = {};
