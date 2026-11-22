import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, userEvent, within } from 'storybook/test';
import { AccountMenu, SignOutProvider } from './AccountMenu';

const user = { login: 'kim-hale', initials: 'KH' };

const meta = {
  title: 'Components/AccountMenu',
  component: AccountMenu,
  args: { user },
  decorators: [
    (Story) => (
      <SignOutProvider onSignOut={fn()}>
        <div style={{ minHeight: 120, padding: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <Story />
        </div>
      </SignOutProvider>
    ),
  ],
} satisfies Meta<typeof AccountMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};
export const Open: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /^Account menu/ }));
  },
};
export const Bot: Story = { args: { user: { login: 'agent-desk[bot]', initials: 'AD', bot: true } } };
