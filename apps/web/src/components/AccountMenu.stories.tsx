import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, userEvent, within } from 'storybook/test';
import { AccountInfoProvider, AccountMenu, SignOutProvider } from './AccountMenu';

const user = { login: 'kim-hale', initials: 'KH' };

const meta = {
  title: 'Components/AccountMenu',
  component: AccountMenu,
  args: { user },
  decorators: [
    (Story) => (
      <SignOutProvider onSignOut={fn()}>
        <AccountInfoProvider name="Kim Hale" email="kim.hale@harbor-labs.example">
          <div style={{ minHeight: 220, padding: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <Story />
          </div>
        </AccountInfoProvider>
      </SignOutProvider>
    ),
  ],
} satisfies Meta<typeof AccountMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

const openMenu = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  await userEvent.click(within(canvasElement).getByRole('button', { name: /^Account menu/ }));
};

export const Closed: Story = {};
export const Open: Story = { play: openMenu };
export const OpenLongName: Story = {
  decorators: [
    (Story) => (
      <AccountInfoProvider
        name="Kimberly Alexandria Hale-Montgomery the Third of Harbor Labs"
        email="kimberly.alexandria.hale-montgomery@harbor-labs-international.example"
      >
        <Story />
      </AccountInfoProvider>
    ),
  ],
  play: openMenu,
};
export const Bot: Story = { args: { user: { login: 'agent-desk[bot]', initials: 'AD', bot: true } } };
