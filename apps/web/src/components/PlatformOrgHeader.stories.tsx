import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, userEvent, within } from 'storybook/test';
import { PlatformOrgHeader } from './PlatformOrgHeader';

const meta = {
  title: 'Components/PlatformOrgHeader',
  component: PlatformOrgHeader,
  args: {
    name: 'Acme',
    slug: 'acme',
    status: 'active',
    auditHref: '/platform/audit?org=acme',
    onSuspend: fn(),
    onReactivate: fn(),
  },
  decorators: [
    (S) => (
      <div style={{ padding: 16, minHeight: 200 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof PlatformOrgHeader>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {};
export const Suspended: Story = { args: { status: 'suspended' } };
export const WithEdit: Story = { args: { onEdit: fn() } };
export const WithOpenLink: Story = { args: { openHref: '/o/acme/projects' } };
export const WithoutOpenLink: Story = {};
export const SuspendedWithOpenLink: Story = { args: { status: 'suspended', openHref: '/o/acme/projects' } };
const openMenu = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'More actions' }));
};

export const MenuOpen: Story = { args: { onEdit: fn(), openHref: '/o/acme/projects' }, play: openMenu };
export const MenuOpenSuspended: Story = {
  args: { onEdit: fn(), status: 'suspended', openHref: '/o/acme/projects' },
  play: openMenu,
};
