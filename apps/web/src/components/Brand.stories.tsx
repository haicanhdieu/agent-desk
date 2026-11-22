import type { Meta, StoryObj } from '@storybook/react-vite';
import { Brand } from './Brand';

const meta = { title: 'Components/Brand', component: Brand } satisfies Meta<typeof Brand>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Link: Story = { args: { href: '/projects' } };
export const LogoOnly: Story = { args: { withName: false, href: '/projects' } };
export const Medium: Story = { args: { size: 26 } };
export const Large: Story = { args: { withName: false, size: 36 } };
