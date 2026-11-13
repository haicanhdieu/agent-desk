import type { TermLine, TermTone } from '@/components';
import type { PluginState, ScriptVersion, SetupPhase } from '@/components';

// Prototype boards: DeskSetup, DeskSetupTest, SetupWorkspace, RunSetupFailed.
const t = (text: string, tone?: TermTone) => (tone ? { text, tone } : { text });

export const setupScript = [
  '# Runs in the repo root after each clone, before the agent starts.',
  '# Non-root user, no system packages. A non-zero exit fails the run.',
  'set -euo pipefail',
  '',
  '# The image has Node 22, git and gh. Add the .NET SDK for this user.',
  'curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0',
  'export PATH="$HOME/.dotnet:$PATH"',
  '',
  'dotnet tool restore',
  'dotnet restore',
].join('\n');

/** The DeskSetupTest draft: line 10 points restore at a private feed. */
export const setupDraft = setupScript.replace(/dotnet restore$/, 'dotnet restore --configfile nuget.config');

export const setupVersions: ScriptVersion[] = [
  { version: 4, author: 'kim-hale', ago: '2 days ago', note: 'Restore .NET tools before restore' },
  { version: 3, author: 'kim-hale', ago: '5 days ago', note: 'Build once so the first agent build is fast' },
  { version: 2, author: 'dana-ortiz', ago: 'Nov 3', note: 'Add dotnet restore' },
  { version: 1, author: 'kim-hale', ago: 'Nov 3' },
];

const pluginIds = ['superpowers@claude-plugins-official', 'context7@claude-plugins-official', 'acme-lint@acme-tools'];
const withStates = (states: PluginState[]) => pluginIds.map((id, i) => ({ id, state: states[i] }));

export const setupPlugins = {
  /** What the next run will do. */
  planned: withStates(['will_install', 'will_install', 'blocked']),
  /** What a test or run did. */
  result: withStates(['installed', 'installed', 'skipped']),
};

export const setupPhases: Record<'passed' | 'failed' | 'running', SetupPhase[]> = {
  passed: [
    { label: 'Clone', state: 'done', detail: 'main a91c3e2' },
    { label: 'Plugins', state: 'done', detail: '2 installed, 1 blocked' },
    { label: 'Setup', state: 'done', detail: 'exit 0 after 2m 31s' },
    { label: 'Shell', state: 'done', detail: 'ready for you' },
  ],
  failed: [
    { label: 'Clone', state: 'done', detail: 'main a91c3e2' },
    { label: 'Plugins', state: 'done', detail: '2 installed, 1 blocked' },
    { label: 'Setup', state: 'failed', detail: 'exit 1 after 48s' },
    { label: 'Shell', state: 'done', detail: 'ready for you' },
  ],
  running: [
    { label: 'Clone', state: 'done', detail: 'main a91c3e2' },
    { label: 'Plugins', state: 'done', detail: '2 installed, 1 blocked' },
    { label: 'Setup', state: 'active', detail: 'running for 21s' },
    { label: 'Shell', state: 'pending' },
  ],
};

const pluginLines: TermLine[] = [
  [t('agentdesk: plugins begin', 'accent')],
  [t('agentdesk: plugin installed superpowers@claude-plugins-official', 'green')],
  [t('agentdesk: plugin installed context7@claude-plugins-official', 'green')],
  [t('agentdesk: plugin skipped acme-lint@acme-tools (store not approved)', 'yellow')],
  [t('agentdesk: plugins end', 'accent')],
];

const restoreFails: TermLine[] = [
  [t('+ curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0', 'dim')],
  [t('dotnet-install: Installed version is 8.0.404')],
  [t('+ dotnet tool restore', 'dim')],
  [t("Tool 'dotnet-ef' (version '8.0.4') was restored. Available commands: dotnet-ef")],
  [t('+ dotnet restore --configfile nuget.config', 'dim')],
  [t('error NU1301: Unable to load the service index for source https://nuget.harbor.internal/v3/index.json.', 'red')],
  [t('agentdesk: setup failed exit=1', 'red')],
];

const prompt = (cmd = ''): TermLine => [
  t('runner@setup-test-7f3k', 'green'),
  t(':'),
  t('~/invoicer-api', 'accent'),
  t(`$ ${cmd}`),
];

/** Test workspace terminal after a failed setup: the log, then the idle shell the user debugs in. */
export const setupTestTerminal: TermLine[] = [
  [t('agent-desk runner 0.5.0', 'accent'), t('  setup test  ·  harbor-labs/invoicer-api  ·  draft (not saved)', 'dim')],
  [t('clone ', 'dim'), t('main @ a91c3e2'), t(' … done in 5.2s', 'dim')],
  ...pluginLines,
  [t('agentdesk: setup begin', 'accent')],
  ...restoreFails,
  [t('agentdesk: session started', 'accent')],
  prompt('curl -sI https://nuget.harbor.internal/v3/index.json'),
  [t('curl: (6) Could not resolve host: nuget.harbor.internal')],
  prompt(),
];

/** Run 58: setup version 5 failed, Claude never started. */
export const setupFailedRunTerminal: TermLine[] = [
  [t('agent-desk runner 0.5.0', 'accent'), t('  run 58  ·  harbor-labs/invoicer-api', 'dim')],
  [t('clone ', 'dim'), t('pull/133/head @ 0c9d2aa'), t(' … done in 6.0s', 'dim')],
  ...pluginLines,
  [t('agentdesk: setup begin', 'accent'), t('  version 5', 'dim')],
  ...restoreFails,
  [],
  [t('[agent-desk] ', 'accent'), t('setup failed at 11:42:51. Claude was not started. Run failed.')],
];
