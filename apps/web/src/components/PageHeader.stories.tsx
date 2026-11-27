import type { Meta, StoryObj } from '@storybook/react-vite';
import { Banner, Button } from '@/ds';
import { PageHeader } from './PageHeader';

const meta = {
  title: 'Components/PageHeader',
  component: PageHeader,
  args: { title: 'Runs' },
} satisfies Meta<typeof PageHeader>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { meta: <span>24 runs this week</span> } };
export const WithActions: Story = { args: { actions: <Button variant="primary">New run</Button> } };
export const WithBanner: Story = {
  args: { banner: <Banner tone="warn">The runner pool is at capacity.</Banner> },
};
export const Loading: Story = { args: { loading: true } };
