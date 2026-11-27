import { render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { agentKindViews, agentSettings, providerPickerChoices, rules, skillTemplates, user } from '@/mocks';
import { toModelList } from '@/components';
import { agentModelsFixtures } from '@/mocks/dto/agentModels';
import { Setup1 } from './Setup1';
import { Setup2 } from './Setup2';
import { Setup3 } from './Setup3';
import { Setup4 } from './Setup4';
import { SetupReady } from './SetupReady';
import { SetupWorkspace } from './SetupWorkspace';

const repos = [
  { name: 'harbor-labs/invoicer-api', meta: 'Private, updated 2 hours ago' },
  { name: 'harbor-labs/invoicer-web', meta: 'Private, updated yesterday' },
  { name: 'harbor-labs/infra-k8s', meta: 'Private, updated 5 days ago' },
];
const repo = 'harbor-labs/invoicer-api';

const s1Props = { user, projectName: 'invoicer-api', repos, selected: repo, installedOn: 'harbor-labs' };
const s1 = <Setup1 {...s1Props} pingAt="14:01:37" />;
const s2 = (extra = {}) => (
  <Setup2
    user={user}
    projectName="invoicer-api"
    repo={repo}
    kinds={agentKindViews}
    providers={providerPickerChoices}
    secretState="entering"
    modelList={toModelList({ status: 'success', data: agentModelsFixtures.live }, null)}
    maxConcurrent={2}
    accepted={{ at: '14:03:02', secretName: 'agentdesk/proj-invoicer-api-claude' }}
    {...extra}
  />
);
/** The write-only secret box (a credential type card can carry the same name). */
const secretBox = (name: string) => screen.getByLabelText(name, { selector: 'input[type="password"]' });
/** The step's text without the provider cards and chips (which name every provider). */
const withoutPicker = (container: HTMLElement) => {
  const copy = container.cloneNode(true) as HTMLElement;
  copy.querySelector('fieldset')?.remove();
  return copy.textContent ?? '';
};
const pick = (name: string) => userEvent.click(screen.getByRole('radio', { name }));
const s3 = (selected = ['code-build', 'code-review']) => (
  <Setup3
    user={user}
    projectName="invoicer-api"
    repo={repo}
    branch="main"
    templates={skillTemplates}
    selected={selected}
    commitMessage="Add Agent Desk skills: code-build, code-review"
  />
);
const s4 = (
  <Setup4
    user={user}
    projectName="invoicer-api"
    repo={repo}
    rule={rules[0]}
    skills={['code-build', 'code-review']}
    followUp={{ command: 'code-review', target: 'pr', skill: 'code-review', enabled: true }}
    maxRunsPerTicket={agentSettings.maxRunsPerTicket}
  />
);
const ready = (
  <SetupReady
    user={user}
    projectName="invoicer-api"
    repo={repo}
    label={{ name: 'user-story', color: '#7C8FD8' }}
    command="/code-build"
    summary={[{ term: 'Repository', value: repo }]}
    lastEvent={{ mode: 'webhook', at: 'ping, 14:01:37' }}
  />
);

describe('setup steps', () => {
  it.each([
    ['Setup1', s1, 'Connect repository'],
    ['Setup2', s2(), 'Add agent'],
    ['Setup3', s3(), 'Add skills'],
    ['Setup4', s4, 'Add first rule'],
  ])('%s marks exactly one step current', (_n, el, label) => {
    const { container } = render(el);
    const cur = container.querySelectorAll('[aria-current="step"]');
    expect(cur).toHaveLength(1);
    expect(cur[0]).toHaveTextContent(label);
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('SetupReady marks no step current, shows the Ready step', () => {
    const { container } = render(ready);
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(0);
    expect(screen.getByText('Ready to trigger')).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });
});

describe('Setup1', () => {
  it('checks the selected repo and shows install + ping status', () => {
    render(s1);
    expect(screen.getByRole('radio', { name: /invoicer-api/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /invoicer-api/ })).toHaveAccessibleDescription(
      'Private, updated 2 hours ago',
    );
    expect(screen.getByRole('radio', { name: /invoicer-web/ })).not.toBeChecked();
    expect(screen.getByText('Installed on harbor-labs')).toBeInTheDocument();
    expect(screen.getByText('Webhook ping received at 14:01:37')).toBeInTheDocument();
    expect(screen.getByLabelText('Project name')).toHaveValue('invoicer-api');
    expect(screen.getByText('If the ping does not arrive')).toBeInTheDocument();
    expect(screen.getByText('Contents')).toBeInTheDocument();
  });
  it('Refresh repositories calls onRefresh', async () => {
    const onRefresh = vi.fn();
    render(<Setup1 {...s1Props} onRefresh={onRefresh} />);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh repositories' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
  it('shows nothing about reconnecting until GitHub rejects the account token', () => {
    render(<Setup1 {...s1Props} onRefresh={vi.fn()} onReconnect={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Reconnect GitHub' })).not.toBeInTheDocument();
  });
  it('when the GitHub token is rejected, says so and Reconnect GitHub calls onReconnect', async () => {
    const onReconnect = vi.fn();
    render(<Setup1 {...s1Props} onRefresh={vi.fn()} reconnectRequired onReconnect={onReconnect} />);
    expect(screen.getByRole('alert')).toHaveTextContent('GitHub needs you to sign in again');
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect GitHub' }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
  it('while the reconnect starts, Reconnect GitHub is disabled', () => {
    render(<Setup1 {...s1Props} reconnectRequired onReconnect={vi.fn()} reconnecting />);
    expect(screen.getByRole('button', { name: 'Reconnect GitHub' })).toBeDisabled();
  });
  it('while refreshing, Refresh repositories is disabled and says so', () => {
    render(<Setup1 {...s1Props} onRefresh={vi.fn()} refreshing />);
    expect(screen.getByRole('button', { name: 'Refreshing repositories' })).toBeDisabled();
  });
  it('Change which repositories the app can access opens the installation of the picked repo in a new tab', async () => {
    const onConnect = vi.fn();
    const withUrls = [
      {
        name: 'harbor-labs/invoicer-api',
        meta: 'Private',
        manageUrl: 'https://github.com/organizations/harbor-labs/settings/installations/1',
      },
      { name: 'kim-hale/docs-site', meta: 'Public', manageUrl: 'https://github.com/settings/installations/2' },
    ];
    render(<Setup1 {...s1Props} repos={withUrls} selected="harbor-labs/invoicer-api" onConnect={onConnect} />);
    const link = screen.getByRole('link', { name: 'Change which repositories the app can access' });
    expect(link).toHaveAttribute('href', 'https://github.com/organizations/harbor-labs/settings/installations/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await userEvent.click(screen.getByRole('radio', { name: /docs-site/ }));
    expect(link).toHaveAttribute('href', 'https://github.com/settings/installations/2');
    expect(onConnect).not.toHaveBeenCalled();
  });
  it('with no known installation page there is no link, and never the GitHub home page', () => {
    render(<Setup1 {...s1Props} />);
    expect(screen.queryByRole('link', { name: 'Change which repositories the app can access' })).toBeNull();
    expect(document.querySelector('a[href="https://github.com/"]')).toBeNull();
    expect(screen.getByText(/Missing a repository\?/)).toBeInTheDocument();
  });
  it('with no repositories, the empty state says to install the app or grant it access, and links the installation', () => {
    render(
      <Setup1
        {...s1Props}
        repos={[]}
        selected=""
        installedOn="harbor-labs"
        accessHref="https://github.com/settings/installations/2"
        onConnect={vi.fn()}
      />,
    );
    expect(screen.getByText('No repositories yet')).toBeInTheDocument();
    expect(screen.getByText(/grant it access/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change which repositories the app can access' })).toHaveAttribute(
      'href',
      'https://github.com/settings/installations/2',
    );
  });
  it('selecting another repo moves the radio', async () => {
    render(s1);
    await userEvent.click(screen.getByRole('radio', { name: /infra-k8s/ }));
    expect(screen.getByRole('radio', { name: /infra-k8s/ })).toBeChecked();
  });
});

describe('Setup1 trigger mode', () => {
  const modeGroup = () => screen.getByRole('radiogroup', { name: 'How Agent Desk hears about new comments' });

  it('defaults to Webhook, with the ping help pointing at Polling and no interval', () => {
    render(s1);
    expect(within(modeGroup()).getByRole('radio', { name: 'Webhook' })).toBeChecked();
    expect(within(modeGroup()).getByRole('radio', { name: 'Webhook' })).toHaveAccessibleDescription(
      'Near-instant. GitHub must reach Agent Desk at a public URL.',
    );
    expect(within(modeGroup()).getByRole('radio', { name: 'Polling' })).toHaveAccessibleDescription(
      'Works without a public URL. Runs start up to one interval later.',
    );
    expect(screen.getByText(/Choose Polling instead, or start the webhook relay/)).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Check every' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Continue' })).toBeInTheDocument();
  });

  it('choosing Polling shows the interval, swaps the aside and hides the webhook ping', async () => {
    const onModeChange = vi.fn();
    const onIntervalChange = vi.fn();
    render(<Setup1 {...s1Props} pingAt="14:01:37" onModeChange={onModeChange} onIntervalChange={onIntervalChange} />);
    await userEvent.click(within(modeGroup()).getByRole('radio', { name: 'Polling' }));
    expect(onModeChange).toHaveBeenCalledWith('polling');
    const interval = screen.getByRole('radiogroup', { name: 'Check every' });
    expect(
      within(interval)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['5 min', '10 min', '15 min', '30 min']);
    expect(within(interval).getByRole('radio', { name: '5 min' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(interval).getByRole('radio', { name: '10 min' }));
    expect(onIntervalChange).toHaveBeenCalledWith('10 min');
    expect(screen.getByText('You can change the mode later in project settings.')).toBeInTheDocument();
    expect(screen.getByText('Polling and the GitHub rate limit')).toBeInTheDocument();
    expect(screen.queryByText('If the ping does not arrive')).toBeNull();
    expect(screen.queryByText('Webhook ping received at 14:01:37')).toBeNull();
  });

  it('first check: no ping wait, Continue disabled', () => {
    render(<Setup1 {...s1Props} mode="polling" polling={{ state: 'checking' }} />);
    expect(screen.getByText('Checking issue comments for the first time')).toBeInTheDocument();
    expect(screen.getByText('No webhook or relay needed. This takes a few seconds.')).toBeInTheDocument();
    expect(screen.queryByText(/Waiting for webhook ping/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('connected: shows interval and last check, Continue enabled', () => {
    render(<Setup1 {...s1Props} mode="polling" polling={{ state: 'ok', lastChecked: '20s ago' }} />);
    expect(screen.getByText('Polling every 5 min · last checked 20s ago')).toBeInTheDocument();
    expect(
      screen.getByText('Agent Desk can read comments on this repository. A new command starts a run within 5 minutes.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue' })).toBeInTheDocument();
  });

  it('connected copy follows the chosen interval', () => {
    render(
      <Setup1 {...s1Props} mode="polling" pollInterval="15 min" polling={{ state: 'ok', lastChecked: '4 min ago' }} />,
    );
    expect(screen.getByText('Polling every 15 min · last checked 4 min ago')).toBeInTheDocument();
    expect(screen.getByText(/starts a run within 15 minutes\.$/)).toBeInTheDocument();
  });

  it('failed: shows the reason and Retry now, Continue disabled', async () => {
    const onRetry = vi.fn();
    render(
      <Setup1 {...s1Props} mode="polling" polling={{ state: 'failed', reason: 'token revoked' }} onRetry={onRetry} />,
    );
    expect(screen.getByText('Polling failed: token revoked')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });
});

describe('Setup2 (FR-3, BR-53)', () => {
  it('shows the new heading, intro, legend and the leave-and-return line', () => {
    render(s2());
    expect(screen.getByRole('heading', { level: 1, name: 'Add your agent' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Pick the agent you work with. Runs use it unless a rule picks another agent. You can add more agents later.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Agent' })).toBeInTheDocument();
    expect(screen.queryByText(/Add the Claude credential/)).toBeNull();
  });
  it('preselects nothing: three runnable cards, ten Coming soon chips, no credential field', () => {
    render(s2());
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    for (const name of ['Claude Code', 'OpenAI Codex', 'OpenCode']) {
      expect(screen.getByRole('radio', { name })).not.toBeChecked();
    }
    expect(screen.getAllByRole('img', { name: /, coming soon$/ })).toHaveLength(10);
    expect(screen.getByRole('img', { name: 'Google Antigravity, coming soon' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Google Antigravity/ })).toBeNull();
    expect(screen.queryByLabelText('Token')).toBeNull();
    expect(screen.queryByLabelText('Default model')).toBeNull();
    expect(screen.queryByLabelText('Concurrent runs')).toBeNull();
  });
  it('Continue with nothing picked shows "Pick an agent to continue." and saves nothing', async () => {
    const onContinue = vi.fn();
    render(s2({ onContinue }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByText('Pick an agent to continue.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Claude Code' }));
    expect(screen.queryByText('Pick an agent to continue.')).toBeNull();
  });
  it('shows the leave-and-return line under the step', () => {
    render(s2());
    expect(
      screen.getByText('Not ready yet? You can leave setup and come back; the project keeps your progress.'),
    ).toBeInTheDocument();
  });
  it('token input is password, empty, and no text contains a token value', async () => {
    const { container } = render(s2());
    await pick('Claude Code');
    const input = secretBox('Subscription token');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue('');
    await userEvent.type(input, 'sk-ant-secret-123');
    expect(container).not.toHaveTextContent('sk-ant-secret-123');
    expect(input).toHaveAttribute('type', 'password');
  });
  it('shows the acceptance banner only when accepted', async () => {
    const { rerender } = render(s2());
    await pick('Claude Code');
    expect(screen.getByText('Token accepted.')).toBeInTheDocument();
    rerender(s2({ accepted: undefined }));
    expect(screen.queryByText('Token accepted.')).toBeNull();
  });
  it('Claude Code: its two credential types, the address field, the model and concurrency', async () => {
    render(s2());
    await pick('Claude Code');
    expect(screen.getByRole('radio', { name: 'Subscription token' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'API key' })).not.toBeChecked();
    expect(screen.getByLabelText('API address')).toHaveValue('');
    expect(screen.getByText(/Public https addresses only\./)).toBeInTheDocument();
    expect(screen.getByLabelText('Default model')).toHaveDisplayValue('claude-opus-4-5-20251101');
    expect(screen.getByLabelText('Concurrent runs')).toHaveValue('2');
  });
  it('Codex: sign-in file or API key, no address field and no Claude-only text', async () => {
    const { container } = render(s2());
    await pick('OpenAI Codex');
    expect(screen.getByRole('radio', { name: 'Sign-in file (auth.json)' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'API key' })).not.toBeChecked();
    expect(secretBox('auth.json contents')).toBeInTheDocument();
    expect(screen.queryByLabelText('API address')).toBeNull();
    expect(container).not.toHaveTextContent('ANTHROPIC_BASE_URL');
    expect(withoutPicker(container)).not.toMatch(/Claude|Anthropic/);
    expect(screen.queryByRole('radio', { name: 'Subscription token' })).toBeNull();
  });
  it('OpenCode: nothing picked is valid, two choices, the no-login line, no token field and no Claude text', async () => {
    const { container } = render(s2());
    await pick('OpenCode');
    expect(screen.getByRole('radio', { name: 'Credentials file' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'API endpoint and key' })).not.toBeChecked();
    expect(
      screen.getByText(
        'OpenCode works without signing in. Leave the credential empty to use it that way, or add one of these.',
      ),
    ).toBeInTheDocument();
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByLabelText('API address')).toBeNull();
    expect(screen.queryByLabelText('Model provider')).toBeNull();
    expect(container).not.toHaveTextContent('ANTHROPIC_BASE_URL');
    expect(withoutPicker(container)).not.toMatch(/Claude|Anthropic/);
  });
  it('OpenCode with an empty credential continues and shows no "Paste the token to continue." (BR-68)', async () => {
    const onContinue = vi.fn();
    render(s2({ onContinue }));
    await pick('OpenCode');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'opencode', credential: '', credentialType: null, model: '' }),
    );
    expect(screen.queryByText('Paste the token to continue.')).toBeNull();
  });
  it.each(['Claude Code', 'OpenAI Codex'])(
    '%s with an empty credential shows "Paste the token to continue."',
    async (name) => {
      const onContinue = vi.fn();
      render(s2({ onContinue }));
      await pick(name);
      await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(onContinue).not.toHaveBeenCalled();
      expect(screen.getByText('Paste the token to continue.')).toBeInTheDocument();
    },
  );
  it('a saved credential lets Continue go with an empty field', async () => {
    const onContinue = vi.fn();
    render(s2({ onContinue, credentialSaved: true }));
    await pick('Claude Code');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ provider: 'claude', credential: '' }));
  });
  it('OpenCode endpoint and key go together (BR-69)', async () => {
    const onContinue = vi.fn();
    render(s2({ onContinue }));
    await pick('OpenCode');
    await userEvent.click(screen.getByRole('radio', { name: 'API endpoint and key' }));
    expect(screen.getByLabelText('API endpoint')).toBeInTheDocument();
    expect(secretBox('API key')).toBeInTheDocument();
    expect(screen.getByText(/OpenAI-compatible chat-completions endpoint/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('API endpoint'), 'https://llm.example.com/v1');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByText('Enter the API key for this endpoint.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('API endpoint'));
    await userEvent.type(secretBox('API key'), 'sk-live-xyz');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByText('Enter the API endpoint for this key.')).toBeInTheDocument();
  });
  it('OpenCode with the endpoint choice requires the model, then sends the endpoint, key and model', async () => {
    const onContinue = vi.fn();
    render(s2({ onContinue }));
    await pick('OpenCode');
    await userEvent.click(screen.getByRole('radio', { name: 'API endpoint and key' }));
    await userEvent.type(screen.getByLabelText('API endpoint'), ' https://llm.example.com/v1 ');
    await userEvent.type(secretBox('API key'), 'sk-live-xyz');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByText('Enter the model your endpoint serves.')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Default model'), 'Other model…');
    await userEvent.type(screen.getByLabelText('Model name'), 'qwen3-coder');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledWith({
      provider: 'opencode',
      credentialType: 'api_key',
      credential: 'sk-live-xyz',
      baseUrl: 'https://llm.example.com/v1',
      model: 'qwen3-coder',
      maxConcurrent: '2',
    });
  });
  it('OpenCode back to the credentials file removes the endpoint, clears the address and sends no address (BR-69)', async () => {
    const onContinue = vi.fn();
    render(s2({ onContinue }));
    await pick('OpenCode');
    await userEvent.click(screen.getByRole('radio', { name: 'API endpoint and key' }));
    await userEvent.type(screen.getByLabelText('API endpoint'), 'https://llm.example.com/v1');
    await userEvent.click(screen.getByRole('radio', { name: 'Credentials file' }));
    expect(screen.queryByLabelText('API endpoint')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ provider: 'opencode', baseUrl: '' }));
    await userEvent.click(screen.getByRole('radio', { name: 'API endpoint and key' }));
    expect(screen.getByLabelText('API endpoint')).toHaveValue('');
  });
  it('OpenCode with nothing or a file shows "OpenCode default" first; the endpoint choice does not (BR-69)', async () => {
    render(s2());
    await pick('OpenCode');
    const firstOption = () => within(screen.getByLabelText('Default model')).getAllByRole('option')[0];
    expect(firstOption()).toHaveTextContent('OpenCode default');
    await userEvent.click(screen.getByRole('radio', { name: 'Credentials file' }));
    expect(firstOption()).toHaveTextContent('OpenCode default');
    await userEvent.click(screen.getByRole('radio', { name: 'API endpoint and key' }));
    expect(firstOption()).not.toHaveTextContent('OpenCode default');
  });
  it('switching provider drops the typed secret and resets the type, address and model', async () => {
    const onContinue = vi.fn();
    const { container } = render(s2({ onContinue }));
    await pick('Claude Code');
    await userEvent.type(secretBox('Subscription token'), 'sk-ant-old-secret');
    await userEvent.click(screen.getByRole('radio', { name: 'API key' }));
    await userEvent.type(screen.getByLabelText('API address'), 'https://gw.example.com');
    await userEvent.selectOptions(screen.getByLabelText('Default model'), 'claude-haiku-4-5-20251001');
    await pick('OpenAI Codex');
    expect(container.innerHTML).not.toContain('sk-ant-old-secret');
    await pick('Claude Code');
    expect(screen.getByRole('radio', { name: 'Subscription token' })).toBeChecked();
    expect(secretBox('Subscription token')).toHaveValue('');
    expect(screen.getByLabelText('API address')).toHaveValue('');
    expect(screen.getByLabelText('Default model')).toHaveDisplayValue('claude-opus-4-5-20251101');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByText('Paste the token to continue.')).toBeInTheDocument();
  });
  it('the Coming soon providers cannot be picked', async () => {
    render(s2());
    await userEvent.click(screen.getByRole('img', { name: 'Cursor, coming soon' }));
    expect(screen.queryByLabelText('Token')).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });
  it('a return visit shows the saved provider read-only with its fields', () => {
    render(s2({ savedProvider: 'codex', credentialType: 'api_key', credentialSaved: true }));
    const codex = screen.getByRole('radio', { name: 'OpenAI Codex' });
    expect(codex).toBeChecked();
    expect(codex).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'OpenCode' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'API key' })).toBeChecked();
    expect(screen.queryByText('Pick an agent to continue.')).toBeNull();
  });
  it('BR-65: a return visit shows the agent name and the credential as set, with no token field', async () => {
    const onContinue = vi.fn();
    render(
      s2({
        onContinue,
        savedProvider: 'codex',
        credentialType: 'auth_json',
        credentialSaved: true,
        savedName: 'Codex main',
        credentialInfo: { setAt: '2 days ago', setBy: 'kim-hale' },
      }),
    );
    expect(screen.getByText('Codex main')).toBeInTheDocument();
    expect(screen.getByText(/Set 2 days ago by kim-hale\./)).toBeInTheDocument();
    expect(screen.queryByLabelText('auth.json contents')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(screen.getByLabelText('auth.json contents')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ provider: 'codex', credential: '' }));
  });
  it('a resumed endpoint credential edited without Replace opens the entry and shows the missing-key message', async () => {
    const onContinue = vi.fn();
    render(
      s2({
        onContinue,
        savedProvider: 'opencode',
        credentialType: 'api_key',
        credentialSaved: true,
        credentialInfo: { setAt: '2 days ago', setBy: 'kim-hale' },
        baseUrl: 'https://old.example.com/v1',
        model: 'my-model',
      }),
    );
    expect(screen.queryByRole('textbox', { name: 'API key' })).toBeNull();
    await userEvent.type(screen.getByLabelText('API endpoint'), '/x');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByText('Enter the API key for this endpoint.')).toBeInTheDocument();
    expect(secretBox('API key')).toBeInTheDocument();
  });
  it('switching the credential type on a resumed visit drops the saved row for the new type', async () => {
    const onContinue = vi.fn();
    render(
      s2({
        onContinue,
        savedProvider: 'codex',
        credentialType: 'auth_json',
        credentialSaved: true,
        credentialInfo: { setAt: '2 days ago', setBy: 'kim-hale' },
      }),
    );
    expect(screen.getByText(/Set 2 days ago by kim-hale\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'API key' }));
    expect(screen.queryByText(/Set 2 days ago by kim-hale\./)).toBeNull();
    expect(secretBox('API key')).toBeInTheDocument();
  });
  it('a rejected test shows the Banner and "Continue anyway", which advances', async () => {
    const onContinueAnyway = vi.fn();
    render(
      s2({
        savedProvider: 'claude',
        credentialSaved: true,
        onContinue: vi.fn(),
        testFailed: { status: 'Credential rejected', message: 'The provider refused the saved credential.' },
        onContinueAnyway,
      }),
    );
    expect(screen.getByText('Credential rejected')).toBeInTheDocument();
    expect(screen.getByText('The provider refused the saved credential.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue anyway' }));
    expect(onContinueAnyway).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });
  it('shows no "Continue anyway" when the test did not fail', () => {
    render(s2({ onContinue: vi.fn() }));
    expect(screen.queryByRole('button', { name: 'Continue anyway' })).toBeNull();
  });
  it('shows the progress line while saving', () => {
    render(s2({ savedProvider: 'claude', onContinue: vi.fn(), saving: true, progress: 'Saving credential...' }));
    expect(screen.getByRole('status')).toHaveTextContent('Saving credential...');
  });
  it('shows server field errors under their fields', async () => {
    render(s2({ errors: { credential: 'Token is not valid.', baseUrl: 'Use a public https address.' } }));
    await pick('Claude Code');
    expect(screen.getByLabelText('API address')).toBeInvalid();
    expect(screen.getByLabelText('API address')).toHaveAccessibleDescription(/Use a public https address\./);
    expect(screen.getByText('Token is not valid.')).toBeInTheDocument();
  });
  it('Continue passes the provider, the typed address and the picked or typed model', async () => {
    const onContinue = vi.fn();
    render(s2({ onContinue, credentialSaved: true }));
    await pick('Claude Code');
    await userEvent.type(screen.getByLabelText('API address'), '  https://gw.example.com/anthropic ');
    await userEvent.selectOptions(screen.getByLabelText('Default model'), 'claude-haiku-4-5-20251001');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenLastCalledWith(
      expect.objectContaining({
        provider: 'claude',
        baseUrl: 'https://gw.example.com/anthropic',
        model: 'claude-haiku-4-5-20251001',
      }),
    );
    await userEvent.selectOptions(screen.getByLabelText('Default model'), 'Other model…');
    await userEvent.type(screen.getByLabelText('Model name'), 'my-model');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'my-model' }));
  });
  it('Continue with an empty Other model… shows a field error and saves nothing', async () => {
    const onContinue = vi.fn();
    render(s2({ onContinue, credentialSaved: true }));
    await pick('Claude Code');
    await userEvent.selectOptions(screen.getByLabelText('Default model'), 'Other model…');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a model name.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Model name'), 'm');
    expect(screen.queryByText('Enter a model name.')).toBeNull();
  });
  it('a saved model missing from the list stays as typed text', () => {
    render(s2({ savedProvider: 'claude', model: 'sonnet' }));
    expect(screen.getByLabelText('Default model')).toHaveDisplayValue('Other model…');
    expect(screen.getByLabelText('Model name')).toHaveValue('sonnet');
  });
  it('the shown model follows a list that arrives after mount until a model is picked', () => {
    const loading = toModelList({ status: 'pending' }, null);
    const { rerender } = render(s2({ savedProvider: 'claude', modelList: loading }));
    expect(screen.getByLabelText('Default model')).toHaveDisplayValue('Other model…');
    rerender(s2({ savedProvider: 'claude' }));
    expect(screen.getByLabelText('Default model')).toHaveDisplayValue('claude-opus-4-5-20251101');
  });
  it('a model list per provider replaces the shared list for that provider', async () => {
    const codexList = toModelList({ status: 'success', data: agentModelsFixtures.noCredential }, null);
    render(s2({ modelLists: { codex: codexList } }));
    await pick('OpenAI Codex');
    const options = within(screen.getByLabelText('Default model')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['opus', 'sonnet', 'haiku', 'Other model…']);
    expect(screen.getByText(/Save a credential to load the provider's list\./)).toBeInTheDocument();
  });
  it('Continue hands back the saved address when nothing was typed, and an empty one once cleared', async () => {
    const onContinue = vi.fn();
    render(s2({ onContinue, baseUrl: 'https://gw.example.com/x', savedProvider: 'claude', credentialSaved: true }));
    expect(screen.getByLabelText('API address')).toHaveValue('https://gw.example.com/x');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenLastCalledWith(expect.objectContaining({ baseUrl: 'https://gw.example.com/x' }));
    await userEvent.clear(screen.getByLabelText('API address'));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenLastCalledWith(expect.objectContaining({ baseUrl: '' }));
  });
});

describe('Setup3', () => {
  it('checkboxes reflect selected and the primary button counts them', () => {
    render(s3());
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    boxes.forEach((b) => expect(b).toBeChecked());
    expect(screen.getByRole('link', { name: 'Commit 2 skills and continue' })).toBeInTheDocument();
    expect(screen.getByText(/No skills found in/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Preview / })).toHaveLength(2);
    expect(screen.getByLabelText('Commit message')).toHaveValue('Add Agent Desk skills: code-build, code-review');
  });
  it('count follows toggling; 1 is singular; 0 reads Continue and Skip stays', async () => {
    render(s3());
    await userEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.getByRole('link', { name: 'Commit 1 skill and continue' })).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('checkbox')[1]);
    expect(screen.queryByRole('link', { name: /Commit/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip' })).toBeInTheDocument();
  });
});

describe('step detail of a done Agent step', () => {
  it('reads "<provider label>, <model>" by default', () => {
    render(s3());
    expect(screen.getByText('Claude Code, opus')).toBeInTheDocument();
    expect(screen.queryByText(/Claude Code token/)).toBeNull();
  });
});

describe('Setup4', () => {
  it('shows the Model field with the step 2 default help', () => {
    const modelList = toModelList({ status: 'success', data: agentModelsFixtures.live }, null);
    render(
      <Setup4
        user={user}
        projectName="invoicer-api"
        repo={repo}
        rule={rules[0]}
        skills={['code-build', 'code-review']}
        followUp={{ command: 'code-review', target: 'pr', skill: 'code-review', enabled: true }}
        maxRunsPerTicket={agentSettings.maxRunsPerTicket}
        modelList={modelList}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveDisplayValue('Default model');
    expect(screen.getByText('Default model is the one picked in step 2.')).toBeInTheDocument();
    expect(screen.getByLabelText('With agent')).toHaveDisplayValue('Claude');
  });
  it('shows the locked agent as "Project default (<name>)" when the default agent is named', () => {
    render(
      <Setup4
        user={user}
        projectName="invoicer-api"
        repo={repo}
        rule={rules[0]}
        skills={['code-build']}
        followUp={{ command: 'code-review', target: 'pr', skill: 'code-review', enabled: true }}
        maxRunsPerTicket={agentSettings.maxRunsPerTicket}
        defaultAgentName="Codex"
      />,
    );
    const agent = screen.getByLabelText('With agent');
    expect(agent).toBeDisabled();
    expect(agent).toHaveDisplayValue('Project default (Codex)');
  });
  it('reads the PRD sentence', () => {
    const { container } = render(s4);
    const p = container.querySelector('p[class*="sentence"]');
    expect(p).toHaveTextContent(
      'When a comment starting with /code-build is posted on an issue labelled user-story, run skill code-build with agent Claude.',
    );
  });
  it('stepper step 3 detail lists both skills, as on the board', () => {
    render(s4);
    expect(screen.getAllByText('code-build, code-review').length).toBeGreaterThan(0);
  });
  it('follow-up strip toggles and guards card is labelled', async () => {
    render(s4);
    const t = screen.getByRole('switch', { name: 'Also add code-review rule' });
    expect(t).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(t);
    expect(t).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('region', { name: 'Guards on every rule' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Save rules and finish' })).toBeInTheDocument();
  });
  it('marks the step optional and Skip calls onSkip', async () => {
    const onSkip = vi.fn();
    render(
      <Setup4
        user={user}
        projectName="invoicer-api"
        repo={repo}
        rule={rules[0]}
        skills={[]}
        followUp={{ command: 'code-review', target: 'pr', skill: 'code-review', enabled: true }}
        maxRunsPerTicket={agentSettings.maxRunsPerTicket}
        onSkip={onSkip}
      />,
    );
    expect(screen.getByText('Step 5 of 5, optional')).toBeInTheDocument();
    expect(screen.getAllByText('optional')).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
  it('without onSkip, Skip is a link', () => {
    render(s4);
    expect(screen.getByRole('link', { name: 'Skip' })).toBeInTheDocument();
  });
});

describe('SetupReady', () => {
  it('without a rule, shows an empty state with a link to add one instead of a command', () => {
    render(
      <SetupReady
        user={user}
        projectName="invoicer-api"
        repo={repo}
        summary={[]}
        lastEvent={{ mode: 'webhook', at: 'ping, 14:01:37' }}
        rulesHref="/o/alice/p/p1/desk/rules"
      />,
    );
    expect(screen.getByText('No rule yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a rule' })).toHaveAttribute('href', '/o/alice/p/p1/desk/rules');
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to runs' })).toBeInTheDocument();
  });

  it('Copy writes the command to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(ready);
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('/code-build');
  });

  it('shows the command, a Copy button and the summary', () => {
    render(ready);
    const code = screen.getByText('/code-build', { selector: 'pre' });
    expect(code).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open issues in GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to runs' })).toBeInTheDocument();
    expect(screen.getByText('Listening for your first command')).toBeInTheDocument();
    expect(
      within(screen.getByRole('heading', { level: 1 })).getByText('Trigger your first run from GitHub'),
    ).toBeInTheDocument();
  });

  it('webhook: names the last event and its source', () => {
    render(ready);
    expect(screen.getByText(/Last event: ping, 14:01:37 \(webhook\)\./)).toBeInTheDocument();
    expect(screen.queryByText(/Last webhook/)).toBeNull();
  });

  it('polling: names the last check instead', () => {
    render(
      <SetupReady
        user={user}
        projectName="invoicer-api"
        repo={repo}
        label={{ name: 'user-story', color: '#7C8FD8' }}
        command="/code-build"
        summary={[]}
        lastEvent={{ mode: 'polling', at: '20s ago' }}
      />,
    );
    expect(screen.getByText(/Last checked: 20s ago \(polling\)\./)).toBeInTheDocument();
    expect(screen.queryByText(/Last event/)).toBeNull();
  });
});

describe('Setup2 credential callback', () => {
  it('Enter submits the typed token to onSubmitCredential and the value is not rendered afterward', async () => {
    const onSubmitCredential = vi.fn();
    const { container } = render(s2({ accepted: undefined, onSubmitCredential }));
    await pick('Claude Code');
    await userEvent.type(secretBox('Subscription token'), 'tok-abc{Enter}');
    expect(onSubmitCredential).toHaveBeenCalledWith('oauth_token', 'tok-abc');
    expect(container.textContent).not.toContain('tok-abc');
  });
});

describe('setup screens pass the org to the top bar', () => {
  const harbor = { id: 'org-harbor', slug: 'harbor-labs', name: 'Harbor Labs' };
  const org = {
    current: harbor,
    orgs: [harbor],
    platformAdmin: false,
    orgHref: (o: { slug: string }) => `/o/${o.slug}/projects`,
    createHref: '/orgs/new',
    projectsHref: '/o/harbor-labs/projects',
    settingsHref: '/o/harbor-labs/settings',
  };

  const bar = { org };
  const workspace = (
    <SetupWorkspace user={user} projectName="invoicer-api" repo={repo} plugins={{ plugins: [] }} {...bar} />
  );

  it.each([
    ['Setup1', <Setup1 key="1" {...s1Props} {...bar} />],
    ['Setup2', s2(bar)],
    ['SetupWorkspace', workspace],
    [
      'Setup3',
      <Setup3
        key="3"
        user={user}
        projectName="invoicer-api"
        repo={repo}
        branch="main"
        templates={skillTemplates}
        selected={[]}
        commitMessage="m"
        {...bar}
      />,
    ],
    [
      'Setup4',
      <Setup4
        key="4"
        user={user}
        projectName="invoicer-api"
        repo={repo}
        rule={rules[0]}
        skills={[]}
        followUp={{ command: 'code-review', target: 'pr', skill: 'code-review', enabled: true }}
        maxRunsPerTicket={agentSettings.maxRunsPerTicket}
        {...bar}
      />,
    ],
    [
      'SetupReady',
      <SetupReady
        key="r"
        user={user}
        projectName="invoicer-api"
        repo={repo}
        label={{ name: 'user-story', color: '#7C8FD8' }}
        command="/code-build"
        summary={[{ term: 'Repository', value: repo }]}
        lastEvent={{ mode: 'webhook', at: 'ping, 14:01:37' }}
        {...bar}
      />,
    ],
  ])('%s shows the org bar', (_n, el) => {
    render(el);
    const nav = screen.getByRole('navigation', { name: 'Organization sections' });
    expect(within(nav).getByRole('link', { name: /Projects/ })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: /Org settings/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Harbor Labs/ })).toBeInTheDocument();
  });
});

describe('SetupReady without rule:create', () => {
  it('hides the Add a rule action but keeps the empty state', () => {
    render(
      <SetupReady
        user={user}
        projectName="invoicer-api"
        repo={repo}
        summary={[]}
        lastEvent={{ mode: 'webhook', at: 'ping, 14:01:37' }}
        rulesHref="/o/alice/p/p1/desk/rules"
        canAddRule={false}
      />,
    );
    expect(screen.getByText('No rule yet')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add a rule' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to runs' })).toBeInTheDocument();
  });
});
