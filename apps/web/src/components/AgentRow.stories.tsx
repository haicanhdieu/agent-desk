import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, userEvent, within } from 'storybook/test';
import { agentRowViews } from '@/mocks';
import type { AgentRowView } from '@/mocks/types';
import { AgentRow } from './AgentRow';
import { viewport } from '@/screens/viewports';

const meta = {
  title: 'Components/AgentRow',
  component: AgentRow,
  parameters: { layout: 'padded' },
  args: { onEdit: fn(), onTest: fn(), onSetDefault: fn(), onDelete: fn() },
  decorators: [
    (S) => (
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        <S />
      </ul>
    ),
  ],
} satisfies Meta<typeof AgentRow>;
export default meta;
type Story = StoryObj<typeof meta>;

const named = (name: string): AgentRowView => {
  const row = agentRowViews.find((r) => r.name === name);
  if (!row) throw new Error(`no agent fixture named ${name}`);
  return row;
};

/** The project default: the Default chip, and no Set as default in its menu. */
export const Default: Story = { args: { agent: named('Claude - Personal') } };
export const CredentialRejected: Story = { args: { agent: named('Claude - Work') } };
export const Codex: Story = { args: { agent: named('Codex') } };
export const OpenCodeEndpointAndKey: Story = { args: { agent: named('OpenCode - Own endpoint') } };
export const OpenCodeCredentialsFile: Story = { args: { agent: named('OpenCode - Credentials file') } };
/** OpenCode needs no credential: neutral "No credential", not amber. */
export const OpenCodeNoSignIn: Story = { args: { agent: named('OpenCode - No sign-in') } };
/** A provider that needs a credential and has none: Needs credential. */
export const NeedsCredential: Story = { args: { agent: named('Claude - New') } };
/** A connection test runs on this row. */
export const Testing: Story = { args: { agent: named('Claude - Work'), testing: true } };
/** A write on this row is in flight: the menu is disabled. */
export const Busy: Story = { args: { agent: named('Claude - Work'), busy: true } };
/** Only Edit as View, no menu. */
export const ReadOnly: Story = { args: { agent: named('Claude - Work'), readOnly: true } };
export const LongName: Story = {
  args: { agent: { ...named('Claude - Work'), name: 'A very long agent name '.repeat(12) } },
};
/** Markup in a name is shown as text. */
export const HostileName: Story = {
  args: { agent: { ...named('Claude - Work'), name: '<b>x</b><img src=x onerror=alert(1)>' } },
};
/** The menu of a non-default agent: Test connection, Set as default, Delete. */
export const RowMenuOpen: Story = {
  args: { agent: named('Claude - Work') },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: `Actions for ${args.agent.name}` }));
  },
};
/** The default's menu: Delete is disabled and says why. */
export const DefaultMenuOpen: Story = {
  args: { agent: named('Claude - Personal') },
  play: RowMenuOpen.play,
};
/** The project's only agent: Delete is disabled with its own reason. */
export const OnlyAgentMenuOpen: Story = {
  args: { agent: named('Claude - Personal'), onlyAgent: true },
  play: RowMenuOpen.play,
};

/** Phone (BR-65): the row stacks (name and Default chip, subline, model, status, Edit and the menu) in a 390px window. */
export const Phone: Story = { args: { agent: named('Claude - Personal') }, globals: viewport(390, 844) };
/** Phone: a 256-character name is cut with an ellipsis and does not widen the row. */
export const PhoneLongName: Story = {
  args: { agent: { ...named('Claude - Work'), name: 'A-very-long-agent-name-'.repeat(11).slice(0, 256) } },
  globals: viewport(390, 844),
};
