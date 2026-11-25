import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { agentKindViews, agentPaneAgents, providerPickerOptions } from '@/mocks';
import type { AgentKindView, AgentPaneAgent } from '@/mocks/types';
import { AgentPane, type AgentPaneProps } from './AgentPane';
import type { ModelList } from './ModelPicker';
import type { ProviderPickerOption } from './ProviderPicker';

const providers: ProviderPickerOption[] = [
  ...providerPickerOptions.runnable.map((o) => ({ kind: o.kind, label: o.label, logo: o.logo, available: true })),
  ...providerPickerOptions.comingSoon.map((o) => ({ kind: o.id, label: o.label, logo: o.logo, available: false })),
];
const list: ModelList = { models: [{ id: 'opus', label: 'Opus' }], state: { kind: 'ready' } };
const agent = (name: string): AgentPaneAgent => {
  const a = agentPaneAgents.find((x) => x.name === name);
  if (!a) throw new Error(`no agent ${name}`);
  return a;
};

function setup(over: Partial<AgentPaneProps> = {}) {
  const props: AgentPaneProps = {
    mode: 'add',
    kinds: agentKindViews,
    providers,
    modelList: list,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    onReplaceCredential: vi.fn(),
    onTest: vi.fn(),
    ...over,
  };
  render(<AgentPane {...props} />);
  return props;
}
const pick = (name: string) => userEvent.click(screen.getByRole('radio', { name }));
const type = (label: string, text: string) => userEvent.type(screen.getByLabelText(label), text);

describe('AgentPane add', () => {
  it('without a provider shows only the picker and the hint', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Add agent' })).toBeInTheDocument();
    expect(screen.getByText('Pick a provider to set up its name, login and model.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save agent' })).toBeInTheDocument();
  });

  it('BR-5: Claude Code shows its methods and address, no Max turns and no no-login line', async () => {
    setup();
    await pick('Claude Code');
    expect(screen.getByRole('radio', { name: 'Subscription token' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'API key' })).toBeInTheDocument();
    expect(screen.getByLabelText('API address')).toBeInTheDocument();
    expect(screen.queryByLabelText('Max turns')).toBeNull();
    expect(screen.queryByText(/works without signing in/)).toBeNull();
  });

  it('BR-5: Codex shows its own methods, no address and no Claude-only text', async () => {
    setup();
    await pick('OpenAI Codex');
    expect(screen.getByRole('radio', { name: 'Sign-in file (auth.json)' })).toBeInTheDocument();
    expect(screen.queryByLabelText('API address')).toBeNull();
    expect(screen.queryByLabelText('API endpoint')).toBeNull();
    expect(document.body.textContent).not.toMatch(/ANTHROPIC_BASE_URL|Subscription token/);
  });

  it('BR-5: OpenCode offers two choices with nothing picked and the no-login line; no Model provider', async () => {
    setup();
    await pick('OpenCode');
    const group = screen.getByRole('radiogroup', { name: 'Authentication' });
    const choices = within(group).getAllByRole('radio');
    expect(choices.map((c) => c.textContent)).toEqual(['Credentials file', 'API endpoint and key']);
    expect(choices.every((c) => c.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(
      screen.getByText(
        'OpenCode works without signing in. Leave the credential empty to use it that way, or add one of these.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Credentials file')).toBeNull();
    expect(screen.queryByLabelText('API key')).toBeNull();
    expect(screen.queryByText(/Model provider/)).toBeNull();
  });

  it('Enter in the credential input submits the pane once, with no nested form and no replace call', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { onSubmit, onReplaceCredential } = setup();
    await pick('OpenAI Codex');
    await userEvent.click(screen.getByRole('radio', { name: 'API key' }));
    await type('Name', 'Enter');
    await type('API key', 'sk-enter{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ credential: { type: 'api_key', value: 'sk-enter' } }),
    );
    expect(onReplaceCredential).not.toHaveBeenCalled();
    expect(document.querySelector('form form')).toBeNull();
    expect(err.mock.calls.flat().join(' ')).not.toContain('validateDOMNesting');
    err.mockRestore();
  });

  it('BR-68: OpenCode with nothing picked saves without a credential and without a model', async () => {
    const { onSubmit } = setup();
    await pick('OpenCode');
    await type('Name', 'Plain');
    await userEvent.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(onSubmit).toHaveBeenCalledWith({
      provider: 'opencode',
      name: 'Plain',
      accountLabel: '',
      model: '',
      maxTurns: null,
      makeDefault: false,
      credential: null,
    });
  });

  it('Enter in the replace panel replaces the credential and does not submit the pane', async () => {
    const onReplaceCredential = vi.fn(() => Promise.resolve(true));
    const { onSubmit } = setup({ mode: 'edit', agent: agent('Claude - Personal'), onReplaceCredential });
    await userEvent.click(screen.getByRole('button', { name: 'Replace' }));
    await type('Subscription token', 'new-secret{Enter}');
    expect(onReplaceCredential).toHaveBeenCalledTimes(1);
    expect(onReplaceCredential).toHaveBeenCalledWith({ type: 'oauth_token', value: 'new-secret' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('BR-69: credentials file label, reveal, help as plain text, no endpoint, no baseUrl in the request', async () => {
    const hostile: AgentKindView[] = agentKindViews.map((k) =>
      k.kind === 'opencode'
        ? {
            ...k,
            credentialTypes: k.credentialTypes.map((c) =>
              c.type === 'auth_json' ? { ...c, help: 'Run `opencode auth export <img src=x onerror=alert(1)>`.' } : c,
            ),
          }
        : k,
    );
    const { onSubmit } = setup({ kinds: hostile });
    await pick('OpenCode');
    await type('Name', 'File');
    await userEvent.click(screen.getByRole('radio', { name: 'Credentials file' }));
    expect(screen.getByLabelText('Credentials file')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Show credentials file' })).toBeInTheDocument();
    expect(screen.getByText(/opencode auth export <img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.queryByLabelText('API endpoint')).toBeNull();
    const file = { OPENCODE: { type: 'oauth', refresh: 'r', access: 'a' } };
    await userEvent.click(screen.getByLabelText('Credentials file'));
    await userEvent.paste(JSON.stringify(file, null, 2));
    const typed = (screen.getByLabelText('Credentials file') as HTMLInputElement).value;
    expect(typed).not.toContain('\n');
    expect(JSON.parse(typed)).toEqual(file);
    await userEvent.click(screen.getByRole('button', { name: 'Save agent' }));
    const sent = vi.mocked(onSubmit!).mock.calls[0][0];
    expect(sent.credential).toEqual({ type: 'auth_json', value: typed });
  });

  it('BR-69: endpoint and key are two fields; one without the other shows a message and sends nothing', async () => {
    const { onSubmit } = setup();
    await pick('OpenCode');
    await type('Name', 'Own');
    await userEvent.click(screen.getByRole('radio', { name: 'API endpoint and key' }));
    const endpoint = screen.getByLabelText('API endpoint');
    expect(endpoint).toHaveAttribute('placeholder', expect.stringMatching(/^https:\/\//));
    expect(screen.getByText(/OpenAI-compatible chat-completions endpoint/)).toBeInTheDocument();
    await type('API key', 'sk-1');
    expect(screen.getByText('Enter the API endpoint for this key.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText('API key'));
    await userEvent.type(endpoint, 'https://llm.example/v1');
    expect(screen.getByText('Enter the API key for this endpoint.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('BR-69: the endpoint choice requires the model; the other choices do not', async () => {
    const { onSubmit } = setup();
    await pick('OpenCode');
    await type('Name', 'Own');
    await userEvent.click(screen.getByRole('radio', { name: 'API endpoint and key' }));
    await type('API endpoint', 'https://llm.example/v1');
    await type('API key', 'sk-1');
    await userEvent.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(screen.getByText('Enter the model your endpoint serves.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Model name'), 'qwen3-coder');
    await userEvent.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'qwen3-coder',
        credential: { type: 'api_key', value: 'sk-1', baseUrl: 'https://llm.example/v1' },
      }),
    );
  });

  it('BR-69: with a file or nothing the model picker starts with OpenCode default and its help', async () => {
    setup();
    await pick('OpenCode');
    const select = screen.getByLabelText('Default model');
    expect(within(select).getAllByRole('option')[0]).toHaveTextContent('OpenCode default');
    expect(screen.getByText(/Use provider\/model, for example anthropic\/claude-sonnet-4-5/)).toBeInTheDocument();
  });

  it('BR-69: switching the choice clears the typed secret and endpoint', async () => {
    setup();
    await pick('OpenCode');
    await userEvent.click(screen.getByRole('radio', { name: 'API endpoint and key' }));
    await type('API endpoint', 'https://llm.example/v1');
    await type('API key', 'sk-1');
    await userEvent.click(screen.getByRole('radio', { name: 'Credentials file' }));
    await userEvent.click(screen.getByRole('radio', { name: 'API endpoint and key' }));
    expect(screen.getByLabelText('API endpoint')).toHaveValue('');
    expect(screen.getByLabelText('API key')).toHaveValue('');
  });

  it('BR-69: the API baseUrl message shows under the endpoint field', async () => {
    setup({ fieldErrors: { baseUrl: 'Use a public https address.' } });
    await pick('OpenCode');
    await userEvent.click(screen.getByRole('radio', { name: 'API endpoint and key' }));
    expect(screen.getByLabelText('API endpoint')).toHaveAccessibleDescription(/Use a public https address\./);
  });

  it('a failed model list never blocks typing a model', async () => {
    const { onSubmit } = setup({ modelList: { models: [], state: { kind: 'error' } } });
    await pick('Claude Code');
    await type('Name', 'A');
    await userEvent.type(screen.getByLabelText('Model name'), 'opus');
    await type('Subscription token', 'tok');
    await userEvent.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ model: 'opus' }));
  });

  it('a required name blocks the save with a message', async () => {
    const { onSubmit } = setup();
    await pick('OpenAI Codex');
    await userEvent.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(screen.getByText('Enter a name.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('sends the credential once and keeps no value in the pane after submit', async () => {
    const { onSubmit } = setup();
    await pick('Claude Code');
    await type('Name', 'Claude - Work');
    await type('Subscription token', 'sk-ant-secret');
    await userEvent.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ credential: { type: 'oauth_token', value: 'sk-ant-secret' } }),
    );
    expect(screen.getByLabelText('Subscription token')).toHaveValue('');
    expect(document.body.innerHTML).not.toContain('sk-ant-secret');
  });

  it('the default checkbox starts unchecked and is sent when ticked', async () => {
    const { onSubmit } = setup();
    await pick('OpenAI Codex');
    await type('Name', 'X');
    const box = screen.getByRole('checkbox', { name: 'Use as the project default' });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ makeDefault: true, model: 'opus' }));
  });

  it('BR-8 to BR-11: shows the API field errors under their fields', async () => {
    setup({
      fieldErrors: { name: 'An agent with this name already exists.', accountLabel: 'Too long.', model: 'Bad model.' },
    });
    await pick('OpenAI Codex');
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription(/An agent with this name already exists\./);
    expect(screen.getByLabelText('Account label')).toHaveAccessibleDescription(/Too long\./);
    expect(screen.getByText('Bad model.')).toBeInTheDocument();
  });

  it('BR-44: has no run limit fields', async () => {
    setup();
    await pick('Claude Code');
    expect(document.body.textContent).not.toMatch(
      /Run time limit|Keep a paused run|End idle runs|Concurrent runs|Runs per ticket|resumes/i,
    );
  });

  it('has no Sign in button or link', async () => {
    setup();
    await pick('OpenAI Codex');
    expect(screen.queryByRole('button', { name: /^sign in$/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /^sign in$/i })).toBeNull();
  });

  it('shows the progress line as a status and disables Save while saving', () => {
    setup({ saving: true, progress: 'Saving credential…' });
    expect(screen.getByRole('status')).toHaveTextContent('Saving credential…');
    expect(screen.getByRole('button', { name: 'Saving credential…' })).toBeDisabled();
  });

  it('partial failure: banner with the reason and the kept-values line', () => {
    setup({
      mode: 'edit',
      agent: agent('Claude - New'),
      partial: { reason: 'The credential file is too large.', requestId: 'req_9' },
    });
    expect(
      screen.getByText('Agent saved, credential not saved: The credential file is too large.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Your typed values are kept. Save the credential again; the agent is not created twice.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Request ID: req_9')).toBeInTheDocument();
  });
});

describe('AgentPane edit', () => {
  it('BR-16: the provider is read-only text, fixed after creation, with no radios', () => {
    setup({ mode: 'edit', agent: agent('Claude - Work') });
    expect(screen.getByRole('heading', { name: 'Edit agent' })).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Fixed after creation')).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('shows the saved credential, Max turns for a provider that supports it and the connection block', () => {
    setup({ mode: 'edit', agent: agent('Claude - Personal') });
    expect(screen.getByText(/Set 10 Nov 2026 by kim-hale/)).toBeInTheDocument();
    expect(screen.getByLabelText('Max turns')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeEnabled();
  });

  it('Max turns is absent for a provider without it', () => {
    setup({ mode: 'edit', agent: agent('Codex') });
    expect(screen.queryByLabelText('Max turns')).toBeNull();
    expect(screen.queryByLabelText('API address')).toBeNull();
  });

  it('Save agent sends the changed fields and no credential', async () => {
    const { onSubmit } = setup({ mode: 'edit', agent: agent('Claude - Personal') });
    await userEvent.clear(screen.getByLabelText('Name'));
    await type('Name', 'Renamed');
    await type('Max turns', '30');
    await userEvent.click(screen.getByRole('button', { name: 'Save agent' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'claude', name: 'Renamed', maxTurns: 30, credential: null }),
    );
  });

  it('the project default is checked and disabled with its help', () => {
    setup({ mode: 'edit', agent: agent('Claude - Personal') });
    const box = screen.getByRole('checkbox', { name: 'Use as the project default' });
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
    expect(screen.getByText('Set another agent as default to change this.')).toBeInTheDocument();
  });

  it('BR-14: an address change asks for the credential again and blocks Save agent', async () => {
    setup({ mode: 'edit', agent: agent('Claude - Personal') });
    await type('API address', 'https://proxy.example.com');
    expect(screen.getByText('Credential needed again')).toBeInTheDocument();
    expect(screen.getByText(/Changed from the provider’s default address\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save agent' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save and test' })).toBeDisabled();
  });

  it('Replace saves the typed credential through onReplaceCredential and keeps no value', async () => {
    const onReplaceCredential = vi.fn(() => Promise.resolve(true));
    setup({ mode: 'edit', agent: agent('Claude - Personal'), onReplaceCredential });
    await userEvent.click(screen.getByRole('button', { name: 'Replace' }));
    await type('Subscription token', 'new-secret');
    await userEvent.click(screen.getByRole('button', { name: 'Save and test' }));
    expect(onReplaceCredential).toHaveBeenCalledWith({ type: 'oauth_token', value: 'new-secret' });
    expect(await screen.findByRole('button', { name: 'Replace' })).toHaveAttribute('aria-expanded', 'false');
    expect(document.body.innerHTML).not.toContain('new-secret');
  });

  it('BR-15: switching the auth type asks for the new credential and disables Save and test until typed', async () => {
    const { onReplaceCredential } = setup({ mode: 'edit', agent: agent('Codex') });
    await userEvent.click(screen.getByRole('button', { name: 'Replace' }));
    await userEvent.click(screen.getByRole('radio', { name: 'API key' }));
    expect(screen.getByText('The authentication changed. Paste the new credential.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save and test' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save agent' })).toBeDisabled();
    await type('API key', 'k');
    await userEvent.click(screen.getByRole('button', { name: 'Save and test' }));
    expect(onReplaceCredential).toHaveBeenCalledWith({ type: 'api_key', value: 'k' });
  });

  it('BR-15: OpenCode file to endpoint and key needs the endpoint and the key before Save and test', async () => {
    const { onReplaceCredential } = setup({ mode: 'edit', agent: agent('OpenCode - Credentials file') });
    expect(screen.queryByLabelText('API endpoint')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Replace' }));
    await userEvent.click(screen.getByRole('radio', { name: 'API endpoint and key' }));
    expect(screen.getByText('The authentication changed. Paste the new credential.')).toBeInTheDocument();
    await type('API key', 'k');
    expect(screen.getByRole('button', { name: 'Save and test' })).toBeDisabled();
    await type('API endpoint', 'https://llm.example/v1');
    await userEvent.click(screen.getByRole('button', { name: 'Save and test' }));
    expect(onReplaceCredential).toHaveBeenCalledWith({
      type: 'api_key',
      value: 'k',
      baseUrl: 'https://llm.example/v1',
    });
  });

  it('BR-68: an OpenCode agent with no credential shows No credential and the entering fields', () => {
    setup({ mode: 'edit', agent: agent('OpenCode - No sign-in') });
    expect(screen.getByText('No credential')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Authentication' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull();
  });

  it('a Claude Code agent with no credential shows the entering field and Needs credential', () => {
    setup({ mode: 'edit', agent: agent('Claude - New') });
    expect(screen.getByText('Needs credential')).toBeInTheDocument();
    expect(screen.getByLabelText('Subscription token')).toHaveValue('');
  });

  it('Test connection calls onTest; while testing it reads Testing… and is disabled', async () => {
    const { onTest } = setup({ mode: 'edit', agent: agent('Claude - Work') });
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(onTest).toHaveBeenCalled();
  });

  it('testing state', () => {
    setup({ mode: 'edit', agent: agent('Claude - Work'), testing: true });
    expect(screen.getByRole('button', { name: 'Testing…' })).toBeDisabled();
  });

  it('gone: the message, the reason and only Close', async () => {
    const { onClose } = setup({ mode: 'edit', agent: agent('Claude - Work'), gone: true });
    expect(screen.getByText('This agent no longer exists.')).toBeInTheDocument();
    expect(screen.getByText('Another admin deleted it. Close this pane and reload the list.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save agent' })).toBeNull();
    await userEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('AgentPane accessibility', () => {
  const check = async () => {
    const result = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(' | '))).toEqual([]);
  };

  it('the OpenCode endpoint and key form has no violations', async () => {
    setup();
    await pick('OpenCode');
    await userEvent.click(screen.getByRole('radio', { name: 'API endpoint and key' }));
    await check();
  });

  it('the replace panel after an auth change has no violations', async () => {
    setup({ mode: 'edit', agent: agent('OpenCode - Credentials file') });
    await userEvent.click(screen.getByRole('button', { name: 'Replace' }));
    await userEvent.click(screen.getByRole('radio', { name: 'API endpoint and key' }));
    await check();
  });
});

describe('AgentPane view', () => {
  it('BR-46: read-only, with the note, disabled fields, a disabled Test and only Close', () => {
    setup({ mode: 'view', agent: agent('Claude - Work') });
    expect(screen.getByRole('heading', { name: 'View agent' })).toBeInTheDocument();
    expect(screen.getByText('You can see this agent but not change it.')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save agent' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);
  });
});
