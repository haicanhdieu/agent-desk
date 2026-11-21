import type { Meta, StoryObj } from '@storybook/react-vite';
import { orgInvitationRows } from '@/mocks';
import { ExpiryLabel } from './ExpiryLabel';

const meta = { title: 'Components/ExpiryLabel', component: ExpiryLabel } satisfies Meta<typeof ExpiryLabel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Relative: Story = { args: { expires: orgInvitationRows[0]!.expires } };
export const Exact: Story = { args: { expires: orgInvitationRows[3]!.expires } };
export const None: Story = { args: { expires: orgInvitationRows[4]!.expires } };
