import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProjectNav, ProjectStrip } from './ProjectNav';

const meta = { title: 'Components/ProjectNav', component: ProjectNav, decorators: [(S) => <div style={{ width: 480, height: 52 }}><S /></div>] } satisfies Meta<typeof ProjectNav>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Tabs: Story = { args: { active: 'runs', needsYou: 1 } };
export const Quiet: Story = { args: { active: 'desk' } };
export const Strip: Story = { render: () => <ProjectStrip org="harbor-labs" project="invoicer-api" active="runs" needsYou={1} /> };
