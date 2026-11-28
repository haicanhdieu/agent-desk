import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, userEvent, within } from 'storybook/test';
import { agentKindViews, agentPaneAgents, providerPickerOptions } from '@/mocks';
import { agentModelsFixtures } from '@/mocks/dto/agentModels';
import type { AgentPaneAgent } from '@/mocks/types';
import { AgentPane } from './AgentPane';
import { toModelList } from './ModelPicker';
import type { ProviderPickerOption } from './ProviderPicker';
import { viewport } from '@/screens/viewports';

const providers: ProviderPickerOption[] = [
  ...providerPickerOptions.runnable.map((o) => ({ kind: o.kind, label: o.label, logo: o.logo, available: true })),
  ...providerPickerOptions.comingSoon.map((o) => ({ kind: o.id, label: o.label, logo: o.logo, available: false })),
];
const live = toModelList({ status: 'success', data: agentModelsFixtures.live }, null);
const builtin = (reason: 'no_credential' | 'unreachable', baseUrl: string | null = null) =>
  toModelList(
    { status: 'success', data: { source: 'builtin', reason, models: agentModelsFixtures.unreachable.models } },
    baseUrl,
  );

const meta = {
  title: 'Components/AgentPane',
  component: AgentPane,
  parameters: { layout: 'fullscreen' },
  args: {
    mode: 'add',
    kinds: agentKindViews,
    providers,
    modelList: builtin('no_credential'),
    onClose: fn(),
    onSubmit: fn(),
    onReplaceCredential: fn(),
    onTest: fn(),
  },
  decorators: [
    (S) => (
      <div style={{ display: 'flex', justifyContent: 'flex-end', height: 820 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof AgentPane>;
export default meta;
type Story = StoryObj<typeof meta>;

const named = (name: string): AgentPaneAgent => {
  const a = agentPaneAgents.find((x) => x.name === name);
  if (!a) throw new Error(`no agent fixture named ${name}`);
  return a;
};
type Canvas = ReturnType<typeof within>;
const pickProvider = (c: Canvas, name: string) => userEvent.click(c.getByRole('radio', { name }));
const pickAuth = (c: Canvas, name: string) => userEvent.click(c.getByRole('radio', { name }));

// Add pane
export const AddWithoutProvider: Story = {};
export const AddClaudeCode: Story = {
  play: async ({ canvasElement }) => pickProvider(within(canvasElement), 'Claude Code'),
};
export const AddCodex: Story = {
  play: async ({ canvasElement }) => pickProvider(within(canvasElement), 'OpenAI Codex'),
};
/** OpenCode needs no login: nothing is picked and the no-login line shows. */
export const AddOpenCodeNothingPicked: Story = {
  play: async ({ canvasElement }) => pickProvider(within(canvasElement), 'OpenCode'),
};
export const AddOpenCodeCredentialsFile: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await pickProvider(c, 'OpenCode');
    await pickAuth(c, 'Credentials file');
  },
};
export const AddOpenCodeEndpointAndKey: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await pickProvider(c, 'OpenCode');
    await pickAuth(c, 'API endpoint and key');
  },
};
/** An endpoint without its key: the message shows and nothing is sent. */
export const AddOpenCodeEndpointNoKey: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await pickProvider(c, 'OpenCode');
    await pickAuth(c, 'API endpoint and key');
    await userEvent.type(c.getByLabelText('API endpoint'), 'https://llm.example/v1');
  },
};
/** OpenCode saved with an empty credential: the agent is created and nothing is sent to the credential route. */
export const AddOpenCodeEmptyCredentialSaving: Story = {
  args: { saving: true, progress: 'Saving agent…' },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await pickProvider(c, 'OpenCode');
    await userEvent.type(c.getByLabelText('Name'), 'OpenCode - Plain');
  },
};
export const AddSaving: Story = {
  args: { saving: true, progress: 'Saving credential…' },
  play: async ({ canvasElement }) => pickProvider(within(canvasElement), 'Claude Code'),
};
export const AddTesting: Story = {
  args: { saving: true, progress: 'Testing connection…' },
  play: async ({ canvasElement }) => pickProvider(within(canvasElement), 'Claude Code'),
};
export const AddFieldErrors: Story = {
  args: {
    fieldErrors: {
      name: 'An agent with this name already exists.',
      accountLabel: 'Use 256 characters or fewer.',
      model: 'Enter a model name.',
    },
  },
  play: async ({ canvasElement }) => pickProvider(within(canvasElement), 'OpenAI Codex'),
};
export const AddEndpointFieldError: Story = {
  args: { fieldErrors: { baseUrl: 'Use a public https address.' } },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await pickProvider(c, 'OpenCode');
    await pickAuth(c, 'API endpoint and key');
  },
};
/** The agent was created but its credential was not saved. */
export const Partial: Story = {
  args: {
    mode: 'edit',
    agent: named('Claude - New'),
    modelList: live,
    partial: { reason: 'The credential file is too large.', requestId: 'req_01HZX' },
  },
};

// Edit pane
export const EditClaudeCode: Story = { args: { mode: 'edit', agent: named('Claude - Personal'), modelList: live } };
export const EditCodex: Story = { args: { mode: 'edit', agent: named('Codex'), modelList: live } };
export const EditOpenCodeEndpointAndKey: Story = {
  args: { mode: 'edit', agent: named('OpenCode - Own endpoint'), modelList: live },
};
export const EditOpenCodeCredentialsFile: Story = {
  args: { mode: 'edit', agent: named('OpenCode - Credentials file'), modelList: live },
};
/** A credentials file is saved; Replace opens the panel and the choice changes to endpoint and key. */
export const EditOpenCodeChoiceChange: Story = {
  args: { mode: 'edit', agent: named('OpenCode - Credentials file'), modelList: live },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Replace' }));
    await pickAuth(c, 'API endpoint and key');
  },
};
export const EditReplace: Story = {
  args: { mode: 'edit', agent: named('Claude - Work'), modelList: live },
  play: async ({ canvasElement }) => userEvent.click(within(canvasElement).getByRole('button', { name: 'Replace' })),
};
/** The API address changed: the credential is needed again and Save agent is blocked. */
export const EditAddressChanged: Story = {
  args: { mode: 'edit', agent: named('Claude - Personal'), modelList: live },
  play: async ({ canvasElement }) =>
    userEvent.type(within(canvasElement).getByLabelText('API address'), 'https://proxy.example.com'),
};
export const EditSaving: Story = {
  args: { mode: 'edit', agent: named('Claude - Personal'), modelList: live, saving: true, progress: 'Saving agent…' },
};
export const EditTesting: Story = {
  args: { mode: 'edit', agent: named('Claude - Work'), modelList: live, testing: true },
};
export const EditTestFailed: Story = { args: { mode: 'edit', agent: named('Claude - Work'), modelList: live } };
export const EditNoCredential: Story = { args: { mode: 'edit', agent: named('Claude - New'), modelList: live } };
/** OpenCode with no credential is ready: neutral status and the choices with nothing picked. */
export const EditOpenCodeNoCredential: Story = {
  args: { mode: 'edit', agent: named('OpenCode - No sign-in'), modelList: live },
};
export const EditFieldErrors: Story = {
  args: {
    mode: 'edit',
    agent: named('Claude - Personal'),
    modelList: live,
    fieldErrors: { name: 'An agent with this name already exists.', model: 'Enter a model name.' },
  },
};
export const EditModelLoading: Story = {
  args: {
    mode: 'edit',
    agent: named('Claude - Personal'),
    modelList: toModelList({ status: 'pending' }, null),
  },
};
export const EditModelFallback: Story = {
  args: {
    mode: 'edit',
    agent: named('OpenCode - Own endpoint'),
    modelList: builtin('unreachable', 'https://llm.harbor-labs.example/v1'),
  },
};
export const EditModelError: Story = {
  args: { mode: 'edit', agent: named('Claude - Personal'), modelList: toModelList({ status: 'error' }, null) },
};
export const EditGone: Story = { args: { mode: 'edit', agent: named('Claude - Work'), gone: true } };

// View pane
export const ReadOnly: Story = { args: { mode: 'view', agent: named('Claude - Work'), modelList: live } };

/** Phone (BR-65): the pane is the full width; its footer wraps with the note on its own line. */
export const PhoneAdd: Story = {
  globals: viewport(390, 844),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('radio', { name: 'OpenCode' }));
  },
};
export const PhoneEdit: Story = {
  args: { mode: 'edit', agent: agentPaneAgents[0], modelList: live },
  globals: viewport(390, 844),
};
