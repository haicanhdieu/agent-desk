import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, userEvent, within } from 'storybook/test';
import { envPagedVariableRows, envSecretRows, envVariableRows } from '@/mocks';
import { EnvEntryList, type EnvSaveError, type EnvSaveResult } from './EnvEntryList';

const done = (): EnvSaveResult => Promise.resolve(null);

const meta = {
  title: 'Components/EnvEntryList',
  component: EnvEntryList,
  parameters: { layout: 'padded' },
  args: {
    kind: 'variable',
    entries: envVariableRows,
    canWrite: true,
    onCreate: fn(done),
    onUpdate: fn(done),
    onRemove: fn(done),
    onRetry: fn(),
  },
  decorators: [
    (S) => (
      <div style={{ maxWidth: 880 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof EnvEntryList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Variables: Story = {};
export const Secrets: Story = { args: { kind: 'secret', entries: envSecretRows } };
export const Empty: Story = { args: { entries: [] } };
export const EmptySecrets: Story = { args: { kind: 'secret', entries: [] } };
export const Loading: Story = { args: { entries: [], loading: true } };
export const LoadingSecrets: Story = { args: { kind: 'secret', entries: [], loading: true } };
export const Error: Story = {
  args: {
    entries: [],
    loadError: { message: 'Could not load the environment. Reload to try again.', requestId: 'req_7f3a91c2' },
  },
};
export const Adding: Story = { args: { initial: { adding: true } } };
export const AddingSecret: Story = { args: { kind: 'secret', entries: envSecretRows, initial: { adding: true } } };
export const Editing: Story = { args: { initial: { editing: 'DB_HOST' } } };
export const ReplacingSecret: Story = {
  args: { kind: 'secret', entries: envSecretRows, initial: { editing: 'NPM_TOKEN' } },
};
export const Saving: Story = { args: { initial: { editing: 'DB_HOST', saving: true } } };
export const Removing: Story = { args: { initial: { removing: 'DB_HOST' } } };

const serverError: EnvSaveError = {
  banner: { title: 'Internal server error', detail: 'Try again in a moment.', requestId: 'req_5b21d0e4' },
};
/** Save fails with a server error: Banner with the Request ID, typed input kept. */
export const RowError: Story = {
  args: {
    initial: { editing: 'DB_HOST' },
    onUpdate: fn(() => Promise.resolve(serverError)),
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Save' }));
  },
};
export const FieldError: Story = {
  args: { initial: { adding: true } },
  play: async ({ canvasElement }) => {
    const form = within(canvasElement).getByRole('group', { name: 'Add variable' });
    await userEvent.type(within(form).getByLabelText('Name'), '9_LIVES');
    await userEvent.click(within(form).getByRole('button', { name: 'Add variable' }));
  },
};
export const ReadOnly: Story = { args: { canWrite: false } };
export const ReadOnlySecrets: Story = { args: { kind: 'secret', entries: envSecretRows, canWrite: false } };

const pageSize = 20;
/** Page 2 of 45 variables, with the page control under the list. */
export const Paged: Story = {
  args: {
    entries: envPagedVariableRows(45).slice(pageSize, pageSize * 2),
    total: 45,
    pagination: { page: 2, pageSize, total: 45, onPageChange: fn(), onPageSizeChange: fn() },
  },
};

const longName =
  'A_VERY_LONG_ENVIRONMENT_VARIABLE_NAME_THAT_KEEPS_GOING_AND_GOING_UNTIL_IT_HITS_THE_LIMIT_OF_THE_COLUMN';
const longValue =
  'postgres://user:pa55@db.internal.example.com:5432/invoicer?sslmode=require&application_name=agent-desk'.repeat(3);
/** Name and value truncate with an ellipsis and keep the full text in the title. */
export const LongNameAndValue: Story = {
  args: { entries: [...envVariableRows, { name: longName, value: longValue }] },
};
