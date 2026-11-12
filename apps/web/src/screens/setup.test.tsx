import { render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { agentSettings, rules, skillTemplates, user } from '@/mocks';
import { Setup1 } from './Setup1';
import { Setup2 } from './Setup2';
import { Setup3 } from './Setup3';
import { Setup4 } from './Setup4';
import { SetupReady } from './SetupReady';

const repos = [
  { name: 'harbor-labs/invoicer-api', meta: 'Private, updated 2 hours ago' },
  { name: 'harbor-labs/invoicer-web', meta: 'Private, updated yesterday' },
  { name: 'harbor-labs/infra-k8s', meta: 'Private, updated 5 days ago' },
];
const repo = 'harbor-labs/invoicer-api';

const s1Props = { user, projectName: 'invoicer-api', repos, selected: repo, installedOn: 'harbor-labs' };
const s1 = <Setup1 {...s1Props} pingAt="14:01:37" />;
const s2 = (extra = {}) => (
  <Setup2 user={user} projectName="invoicer-api" repo={repo} credentialType="oauth_token" secretState="entering"
    models={['opus (latest Opus)', 'sonnet (latest Sonnet)', 'Custom model id']} maxConcurrent={2}
    accepted={{ at: '14:03:02', secretName: 'agentdesk/proj-invoicer-api-claude' }} {...extra} />
);
const s3 = (selected = ['code-build', 'code-review']) => (
  <Setup3 user={user} projectName="invoicer-api" repo={repo} branch="main" templates={skillTemplates} selected={selected}
    commitMessage="Add Agent Desk skills: code-build, code-review" />
);
const s4 = (
  <Setup4 user={user} projectName="invoicer-api" repo={repo} rule={rules[0]} skills={['code-build', 'code-review']}
    followUp={{ command: 'code-review', target: 'pr', skill: 'code-review', enabled: true }}
    maxRunsPerTicket={agentSettings.maxRunsPerTicket} />
);
const ready = (
  <SetupReady user={user} projectName="invoicer-api" repo={repo} label={{ name: 'user-story', color: '#7C8FD8' }} command="/code-build"
    summary={[{ term: 'Repository', value: repo }]} lastEvent={{ mode: 'webhook', at: 'ping, 14:01:37' }} />
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
    expect(screen.getByRole('radio', { name: /invoicer-api/ })).toHaveAccessibleDescription('Private, updated 2 hours ago');
    expect(screen.getByRole('radio', { name: /invoicer-web/ })).not.toBeChecked();
    expect(screen.getByText('Installed on harbor-labs')).toBeInTheDocument();
    expect(screen.getByText('Webhook ping received at 14:01:37')).toBeInTheDocument();
    expect(screen.getByLabelText('Project name')).toHaveValue('invoicer-api');
    expect(screen.getByText('If the ping does not arrive')).toBeInTheDocument();
    expect(screen.getByText('Contents')).toBeInTheDocument();
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
    expect(within(modeGroup()).getByRole('radio', { name: 'Webhook' })).toHaveAccessibleDescription('Near-instant. GitHub must reach Agent Desk at a public URL.');
    expect(within(modeGroup()).getByRole('radio', { name: 'Polling' })).toHaveAccessibleDescription('Works without a public URL. Runs start up to one interval later.');
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
    expect(within(interval).getAllByRole('radio').map((r) => r.textContent)).toEqual(['5 min', '10 min', '15 min', '30 min']);
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
    expect(screen.getByText('Agent Desk can read comments on this repository. A new command starts a run within 5 minutes.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue' })).toBeInTheDocument();
  });

  it('connected copy follows the chosen interval', () => {
    render(<Setup1 {...s1Props} mode="polling" pollInterval="15 min" polling={{ state: 'ok', lastChecked: '4 min ago' }} />);
    expect(screen.getByText('Polling every 15 min · last checked 4 min ago')).toBeInTheDocument();
    expect(screen.getByText(/starts a run within 15 minutes\.$/)).toBeInTheDocument();
  });

  it('failed: shows the reason and Retry now, Continue disabled', async () => {
    const onRetry = vi.fn();
    render(<Setup1 {...s1Props} mode="polling" polling={{ state: 'failed', reason: 'token revoked' }} onRetry={onRetry} />);
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
    expect(screen.getByLabelText('Model')).toHaveDisplayValue('opus (latest Opus)');
    expect(screen.getByLabelText('Concurrent runs')).toHaveValue('2');
    expect(screen.getByText('Token accepted.')).toBeInTheDocument();
  });
  it('omits the acceptance banner when not accepted', () => {
    render(s2({ accepted: undefined }));
    expect(screen.queryByText('Token accepted.')).toBeNull();
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
  it('reads the PRD sentence', () => {
    const { container } = render(s4);
    const p = container.querySelector('p[class*="sentence"]');
    expect(p).toHaveTextContent('When a comment starting with /code-build is posted on an issue labelled user-story, run skill code-build with agent Claude.');
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
});

describe('SetupReady', () => {
  it('shows the command, a Copy button and the summary', () => {
    render(ready);
    const code = screen.getByText('/code-build', { selector: 'pre' });
    expect(code).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open issues in GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to runs' })).toBeInTheDocument();
    expect(screen.getByText('Listening for your first command')).toBeInTheDocument();
    expect(within(screen.getByRole('heading', { level: 1 })).getByText('Trigger your first run from GitHub')).toBeInTheDocument();
  });

  it('webhook: names the last event and its source', () => {
    render(ready);
    expect(screen.getByText(/Last event: ping, 14:01:37 \(webhook\)\./)).toBeInTheDocument();
    expect(screen.queryByText(/Last webhook/)).toBeNull();
  });

  it('polling: names the last check instead', () => {
    render(
      <SetupReady user={user} projectName="invoicer-api" repo={repo} label={{ name: 'user-story', color: '#7C8FD8' }} command="/code-build"
        summary={[]} lastEvent={{ mode: 'polling', at: '20s ago' }} />,
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
