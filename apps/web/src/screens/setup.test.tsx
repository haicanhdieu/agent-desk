import { render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { agentSettings, rules, skillTemplates, user } from '@/mocks';
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
    credentialType="oauth_token"
    secretState="entering"
    modelList={toModelList({ status: 'success', data: agentModelsFixtures.live }, null)}
    maxConcurrent={2}
    accepted={{ at: '14:03:02', secretName: 'agentdesk/proj-invoicer-api-claude' }}
    {...extra}
  />
);
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
    ['Setup2', s2(), 'Add Claude credential'],
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
  it('while refreshing, Refresh repositories is disabled and says so', () => {
    render(<Setup1 {...s1Props} onRefresh={vi.fn()} refreshing />);
    expect(screen.getByRole('button', { name: 'Refreshing repositories' })).toBeDisabled();
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

describe('Setup2 (FR-3)', () => {
  it('token input is password, empty, and no text contains a token value', async () => {
    const { container } = render(s2());
    const input = screen.getByLabelText('Token');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue('');
    await userEvent.type(input, 'sk-ant-secret-123');
    expect(container).not.toHaveTextContent('sk-ant-secret-123');
    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Show token while typing' })).toBeInTheDocument();
  });
  it('renders credential types, model, concurrency and acceptance', () => {
    render(s2());
    expect(screen.getByRole('radio', { name: /Claude Code OAuth token/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /API key/ })).not.toBeChecked();
    expect(screen.getByLabelText('Default model')).toHaveDisplayValue('claude-opus-4-5-20251101');
    expect(screen.getByLabelText('Concurrent runs')).toHaveValue('2');
    expect(screen.getByText('Token accepted.')).toBeInTheDocument();
  });
  it('omits the acceptance banner when not accepted', () => {
    render(s2({ accepted: undefined }));
    expect(screen.queryByText('Token accepted.')).toBeNull();
  });
  it('Setup2 shows API address and a Default model picker with Other model… last, not the fixed opus/sonnet list', () => {
    render(s2());
    expect(screen.getByLabelText('API address')).toHaveValue('');
    expect(screen.getByText(/Public https addresses only\./)).toBeInTheDocument();
    const options = within(screen.getByLabelText('Default model')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
      'claude-opus-4-1-20250805',
      'Other model…',
    ]);
    expect(
      screen.getByText(/Loaded from the provider\. Rules that don't name a model use this one\./),
    ).toBeInTheDocument();
  });
  it('Continue passes the typed address and the picked or typed model', async () => {
    const onContinue = vi.fn();
    render(s2({ onContinue, baseUrl: '' }));
    await userEvent.type(screen.getByLabelText('API address'), '  https://gw.example.com/anthropic ');
    await userEvent.selectOptions(screen.getByLabelText('Default model'), 'claude-haiku-4-5-20251001');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseUrl: 'https://gw.example.com/anthropic', model: 'claude-haiku-4-5-20251001' }),
    );
    await userEvent.selectOptions(screen.getByLabelText('Default model'), 'Other model…');
    await userEvent.type(screen.getByLabelText('Model name'), 'my-model');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'my-model' }));
  });
  it('Continue with an empty Other model… shows a field error and saves nothing', async () => {
    const onContinue = vi.fn();
    render(s2({ onContinue }));
    await userEvent.selectOptions(screen.getByLabelText('Default model'), 'Other model…');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a model name.')).toBeInTheDocument();
  });
  it('a saved model missing from the list stays as typed text', () => {
    render(s2({ model: 'sonnet' }));
    expect(screen.getByLabelText('Default model')).toHaveDisplayValue('Other model…');
    expect(screen.getByLabelText('Model name')).toHaveValue('sonnet');
  });
  it('the shown model follows a list that arrives after mount until a model is picked', () => {
    const loading = toModelList({ status: 'pending' }, null);
    const { rerender } = render(s2({ modelList: loading }));
    expect(screen.getByLabelText('Default model')).toHaveDisplayValue('Other model…');
    rerender(s2());
    expect(screen.getByLabelText('Default model')).toHaveDisplayValue('claude-opus-4-5-20251101');
  });
  it('a pick is kept when the list changes under it', async () => {
    const { rerender } = render(s2());
    await userEvent.selectOptions(screen.getByLabelText('Default model'), 'claude-haiku-4-5-20251001');
    rerender(s2({ modelList: toModelList({ status: 'success', data: agentModelsFixtures.live }, null) }));
    expect(screen.getByLabelText('Default model')).toHaveDisplayValue('claude-haiku-4-5-20251001');
  });
  it('Continue hands back the saved address when nothing was typed, and an empty one once cleared', async () => {
    const onContinue = vi.fn();
    render(s2({ onContinue, baseUrl: 'https://gw.example.com/x' }));
    expect(screen.getByLabelText('API address')).toHaveValue('https://gw.example.com/x');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenLastCalledWith(expect.objectContaining({ baseUrl: 'https://gw.example.com/x' }));
    await userEvent.clear(screen.getByLabelText('API address'));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenLastCalledWith(expect.objectContaining({ baseUrl: '' }));
  });
  it('the model field error clears on the next pick', async () => {
    render(s2({ onContinue: vi.fn() }));
    await userEvent.selectOptions(screen.getByLabelText('Default model'), 'Other model…');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Enter a model name.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Model name'), 'm');
    expect(screen.queryByText('Enter a model name.')).toBeNull();
  });
  it('a baseUrl error shows on the API address field', () => {
    render(s2({ errors: { baseUrl: 'Use a public https address.' } }));
    const input = screen.getByLabelText('API address');
    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription(/Use a public https address\./);
  });
  it('fallback shows opus, sonnet, haiku with the reason note', () => {
    render(s2({ modelList: toModelList({ status: 'success', data: agentModelsFixtures.noCredential }, null) }));
    const options = within(screen.getByLabelText('Default model')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['opus', 'sonnet', 'haiku', 'Other model…']);
    expect(screen.getByText(/Save a credential to load the provider's list\./)).toBeInTheDocument();
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
    expect(screen.getAllByRole('link', { name: /^Preview / })).toHaveLength(2);
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
    await userEvent.type(screen.getByLabelText('Token'), 'tok-abc{Enter}');
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
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: /Projects/ })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: /Settings/ })).toBeInTheDocument();
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
