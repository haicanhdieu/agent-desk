import type { Meta, StoryObj } from '@storybook/react-vite';
import { AgentStatus } from './AgentStatus';

const meta = {
  title: 'Components/AgentStatus',
  component: AgentStatus,
  args: { status: 'ok' },
} satisfies Meta<typeof AgentStatus>;
export default meta;
type Story = StoryObj<typeof meta>;

const STATUSES = [
  'ok',
  'no_credential',
  'not_tested',
  'rejected',
  'unreachable',
  'invalid',
  'unsupported',
  'testing',
] as const;

/** Every status word with its glyph and tone. */
export const AllStatuses: Story = {
  render: () => (
    <ul style={{ display: 'grid', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
      {STATUSES.map((s) => (
        <li key={s}>
          <AgentStatus status={s} />
        </li>
      ))}
    </ul>
  ),
};
export const Testing: Story = { args: { status: 'testing' } };
/** OpenCode needs no credential: neutral "No credential", not amber. */
export const OpenCodeNoCredential: Story = { args: { status: 'no_credential', credentialOptional: true } };
/** A status the web does not know reads "Can't verify". */
export const UnknownStatus: Story = { args: { status: 'something_new' } };
