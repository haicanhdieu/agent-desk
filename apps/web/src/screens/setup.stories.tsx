import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { ShellFrame } from './shellFrame';
import { CommandChip } from '@/ds';
import {
  agentKindViews,
  agentSettings,
  connectionCopy,
  providerPickerChoices,
  promptSystemLines,
  rules,
  setupPlugins,
  setupScript,
  skillTemplates,
  TRIAGE_PROMPT,
  user,
} from '@/mocks';
import { Setup1 as Setup1Screen } from './Setup1';
import { Setup2 as Setup2Screen } from './Setup2';
import { Setup3 as Setup3Screen } from './Setup3';
import { toModelList } from '@/components';
import { agentModelsFixtures } from '@/mocks/dto/agentModels';
import { Setup4 as Setup4Screen } from './Setup4';
import { SetupReady as SetupReadyScreen } from './SetupReady';
import { SetupWorkspace as SetupWorkspaceScreen } from './SetupWorkspace';
import { viewport } from './viewports';

// Artboards come from canvas.json: Setup1, Setup1Polling, Setup1PollingOk, SetupWorkspace 1440x1000; the rest 1440x900.
// The shell draws the bar; SetupLayout puts the stepper in the shell's menu slot and draws the single <main>.
const meta = {
  title: 'Screens/Setup',
  globals: viewport(1440, 900),
  parameters: { layout: 'fullscreen', artboardHeight: 900 },
  decorators: [
    (S, ctx) => {
      const h = ctx.parameters.artboardHeight as number;
      // A story with `parameters.shell` brings its own ShellFrame; the others sit in the wizard shell.
      if (ctx.parameters.shell) return <S />;
      return (
        <div style={{ width: 1440, height: h }}>
          <WizardFrame height={h}>
            <S />
          </WizardFrame>
        </div>
      );
    },
  ],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const harbor = { id: 'org-harbor', slug: 'harbor-labs', name: 'Harbor Labs' };
/** The scope crumb of the wizard's bar: an owner of one org. */
const org = {
  current: harbor,
  orgs: [harbor],
  platformAdmin: false,
  orgHref: (o: { slug: string }) => `/o/${o.slug}/projects`,
  createHref: '/platform/orgs/new',
};

const tall = { parameters: { artboardHeight: 1000 }, globals: viewport(1440, 1000) };

const repo = 'harbor-labs/invoicer-api';
const projectName = 'invoicer-api';
const rule = rules[0];

const manageUrl = 'https://github.com/organizations/harbor-labs/settings/installations/1001';

const setup1 = {
  projectName,
  repos: [
    { name: repo, meta: 'Private, updated 2 hours ago', manageUrl },
    { name: 'harbor-labs/invoicer-web', meta: 'Private, updated yesterday', manageUrl },
    { name: 'harbor-labs/infra-k8s', meta: 'Private, updated 5 days ago', manageUrl },
  ],
  selected: repo,
  installedOn: 'harbor-labs',
  nextHref: '#',
};

export const Setup1: Story = {
  name: 'Setup 1, connect repository, webhook',
  ...tall,
  render: () => <Setup1Screen {...setup1} pingAt="14:01:37" />,
};

export const Setup1Polling: Story = {
  name: 'Setup 1, polling, first check',
  ...tall,
  render: () => <Setup1Screen {...setup1} mode="polling" polling={{ state: 'checking' }} />,
};

export const Setup1PollingOk: Story = {
  name: 'Setup 1, polling connected',
  ...tall,
  render: () => <Setup1Screen {...setup1} mode="polling" polling={{ state: 'ok', lastChecked: '20s ago' }} />,
};

export const Setup1RefreshRepos: Story = {
  name: 'Setup 1, refresh repositories',
  ...tall,
  render: () => <Setup1Screen {...setup1} pingAt="14:01:37" onRefresh={() => undefined} />,
};

export const Setup1ReconnectGithub: Story = {
  name: 'Setup 1, reconnect GitHub',
  ...tall,
  render: () => (
    <Setup1Screen {...setup1} onRefresh={() => undefined} reconnectRequired onReconnect={() => undefined} />
  ),
};

export const Setup1Refreshing: Story = {
  name: 'Setup 1, refreshing repositories',
  ...tall,
  render: () => <Setup1Screen {...setup1} pingAt="14:01:37" onRefresh={() => undefined} refreshing />,
};

export const Setup1NoRepositories: Story = {
  name: 'Setup 1, no repositories, app not installed',
  ...tall,
  render: () => (
    <Setup1Screen
      {...setup1}
      repos={[]}
      selected=""
      installedOn=""
      onConnect={() => undefined}
      onRefresh={() => undefined}
    />
  ),
};

export const Setup1NoRepositoriesAccess: Story = {
  name: 'Setup 1, no repositories, app installed without access',
  ...tall,
  render: () => (
    <Setup1Screen
      {...setup1}
      repos={[]}
      selected=""
      accessHref={manageUrl}
      onConnect={() => undefined}
      onRefresh={() => undefined}
    />
  ),
};

export const Setup1PollingFailed: Story = {
  name: 'Setup 1, polling failed',
  ...tall,
  render: () => (
    <Setup1Screen
      {...setup1}
      mode="polling"
      polling={{ state: 'failed', reason: connectionCopy.reasons.tokenRevoked }}
    />
  ),
};

/** Standard names while no credential exists, per provider (the Add agent pane's `no_credential` note). */
const builtinList = (ids: string[]) =>
  toModelList(
    {
      status: 'success',
      data: { source: 'builtin', reason: 'no_credential', models: ids.map((id) => ({ id, label: id })) },
    },
    null,
  );
const liveModels = toModelList({ status: 'success', data: agentModelsFixtures.live }, null);
const noCredentialModels = toModelList({ status: 'success', data: agentModelsFixtures.noCredential }, null);

const setup2Props = {
  projectName,
  repo,
  kinds: agentKindViews,
  providers: providerPickerChoices,
  secretState: 'entering' as const,
  modelList: liveModels,
  modelLists: {
    claude: noCredentialModels,
    codex: builtinList(['gpt-5-codex', 'gpt-5']),
    opencode: builtinList([]),
  },
  maxConcurrent: agentSettings.maxConcurrent,
  onContinue: () => undefined,
};
type Canvas = ReturnType<typeof within>;
const pickRadio = (c: Canvas, name: string) => userEvent.click(c.getByRole('radio', { name }));

/** The board: nothing picked, the three agents and the ten Coming soon chips; no field shows yet. */
export const Setup2DefaultAgent: Story = {
  name: 'Setup 2, add agent, nothing picked',
  render: () => <Setup2Screen {...setup2Props} />,
};

/** No credential yet: the standard names with the reason note (Claude Code picked). */
export const Setup2DefaultAgentFallback: Story = {
  name: 'Setup 2, add agent, no credential yet',
  render: () => <Setup2Screen {...setup2Props} />,
  play: async ({ canvasElement }) => {
    await pickRadio(within(canvasElement), 'Claude Code');
  },
};

/** Claude Code picked with live models: the address field shows. */
export const Setup2AgentClaude: Story = {
  name: 'Setup 2, add agent, Claude Code picked',
  render: () => (
    <Setup2Screen
      {...setup2Props}
      modelLists={{ ...setup2Props.modelLists, claude: liveModels }}
      accepted={{ at: '14:03:02', secretName: 'agentdesk/proj-invoicer-api-claude' }}
    />
  ),
  play: async ({ canvasElement }) => {
    await pickRadio(within(canvasElement), 'Claude Code');
  },
};

/** The board: Codex picked, a sign-in file or an API key, no address field. */
export const Setup2AgentCodex: Story = {
  name: 'Setup 2, add agent, OpenAI Codex picked',
  render: () => <Setup2Screen {...setup2Props} />,
  play: async ({ canvasElement }) => {
    await pickRadio(within(canvasElement), 'OpenAI Codex');
  },
};

/** OpenCode picked with its endpoint and key choice: two fields, the endpoint help and the required model. */
export const Setup2AgentOpenCode: Story = {
  name: 'Setup 2, add agent, OpenCode, API endpoint and key',
  ...tall,
  render: () => <Setup2Screen {...setup2Props} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await pickRadio(c, 'OpenCode');
    await pickRadio(c, 'API endpoint and key');
  },
};

/** The board: the test failed; the credential stays saved and "Continue anyway" appears beside Continue. */
export const Setup2AgentRejected: Story = {
  name: 'Setup 2, add agent, the test failed',
  ...tall,
  render: () => (
    <Setup2Screen
      {...setup2Props}
      onContinueAnyway={() => undefined}
      testFailed={{
        status: 'Credential rejected',
        message: 'The provider refused the saved credential. Replace it, then test again.',
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await pickRadio(c, 'Claude Code');
    await pickRadio(c, 'API key');
  },
};

/** Saving: the progress line and a busy Continue. */
export const Setup2AgentSaving: Story = {
  name: 'Setup 2, add agent, saving',
  render: () => <Setup2Screen {...setup2Props} saving progress="Saving credential..." />,
  play: async ({ canvasElement }) => {
    await pickRadio(within(canvasElement), 'Claude Code');
  },
};

/** Messages under the fields (the API's pointers). */
export const Setup2AgentFieldErrors: Story = {
  name: 'Setup 2, add agent, field errors',
  ...tall,
  render: () => (
    <Setup2Screen
      {...setup2Props}
      errors={{
        credential: 'Paste the token to continue.',
        baseUrl: 'Use a public https address.',
        model: 'Enter a model name.',
        maxConcurrent: 'Enter a whole number from 1 to 10.',
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    await pickRadio(within(canvasElement), 'Claude Code');
  },
};

/** Continue with no agent picked: the message under the cards. */
export const Setup2AgentNoneChosen: Story = {
  name: 'Setup 2, add agent, Continue with nothing picked',
  render: () => <Setup2Screen {...setup2Props} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Continue' }));
  },
};

const workspace = { projectName, repo, plugins: { plugins: setupPlugins.planned } };

/** New optional step between the credential and skills (five steps once it ships). */
export const SetupWorkspace: Story = {
  name: 'Setup, prepare workspace, test passed',
  ...tall,
  render: () => (
    <SetupWorkspaceScreen
      {...workspace}
      script={setupScript}
      test={{
        state: 'passed',
        title: 'Test passed in 2m 41s',
        detail: 'Clone, 2 plugins installed, 1 blocked, setup exited 0. The test workspace stays up 13 more minutes.',
      }}
    />
  ),
};

export const SetupWorkspaceStart: Story = {
  name: 'Setup, prepare workspace, not tested',
  ...tall,
  render: () => <SetupWorkspaceScreen {...workspace} />,
};

export const SetupWorkspaceRunning: Story = {
  name: 'Setup, prepare workspace, test running',
  ...tall,
  render: () => (
    <SetupWorkspaceScreen
      {...workspace}
      script={setupScript}
      test={{ state: 'running', detail: 'Plugins done. Running the setup script, 21s so far.' }}
    />
  ),
};

export const SetupWorkspaceFailed: Story = {
  name: 'Setup, prepare workspace, test failed',
  ...tall,
  render: () => (
    <SetupWorkspaceScreen
      {...workspace}
      script={setupScript}
      test={{
        state: 'failed',
        title: 'Setup failed: exit 1 after 48s',
        detail:
          'dotnet restore could not reach a package feed. Open the terminal to look around; you can still continue.',
      }}
    />
  ),
};

export const Setup3: Story = {
  name: 'Setup 3, skills',
  render: () => (
    <Setup3Screen
      projectName={projectName}
      repo={repo}
      branch="main"
      templates={skillTemplates}
      selected={skillTemplates.map((t) => t.name)}
      commitMessage="Add Agent Desk skills: code-build, code-review"
    />
  ),
};

export const Setup4: Story = {
  name: 'Setup 4, first rule',
  render: () => (
    <Setup4Screen
      projectName={projectName}
      repo={repo}
      rule={rule}
      skills={['code-build', 'code-review']}
      followUp={{ command: 'code-review', target: 'pr', skill: 'code-review', enabled: true }}
      maxRunsPerTicket={agentSettings.maxRunsPerTicket}
      promptPreview={{ state: 'ready', systemLines: promptSystemLines }}
      modelList={liveModels}
      defaultAgentName="Claude"
    />
  ),
};

/** Step 5 is optional: the stepper tags it and the footer offers Skip, which finishes setup without a rule. */
export const Setup4Skip: Story = {
  name: 'Setup 4, first rule, optional with Skip',
  render: () => (
    <Setup4Screen
      projectName={projectName}
      repo={repo}
      rule={rule}
      skills={[]}
      followUp={{ command: 'code-review', target: 'pr', skill: 'code-review', enabled: true }}
      maxRunsPerTicket={agentSettings.maxRunsPerTicket}
      promptPreview={{ state: 'ready', systemLines: promptSystemLines }}
      modelList={liveModels}
      defaultAgentName="Claude"
      onSkip={() => undefined}
    />
  ),
};

/** The first rule as a custom prompt (state of board Setup4; taller so the system lines fit). */
export const Setup4Prompt: Story = {
  name: 'Setup 4, first rule as a custom prompt',
  parameters: { artboardHeight: 1080 },
  globals: viewport(1440, 1080),
  render: () => (
    <Setup4Screen
      projectName={projectName}
      repo={repo}
      rule={{ ...rule, command: 'triage', labels: [], skill: '', kind: 'prompt', prompt: TRIAGE_PROMPT }}
      skills={['code-build', 'code-review']}
      followUp={{ command: 'code-review', target: 'pr', skill: 'code-review', enabled: true }}
      maxRunsPerTicket={agentSettings.maxRunsPerTicket}
      promptPreview={{ state: 'ready', systemLines: promptSystemLines }}
      modelList={liveModels}
      defaultAgentName="Claude"
    />
  ),
};

const readySummary = (trigger: string) => [
  { term: 'Repository', value: <span className="mono">{repo}</span> },
  { term: connectionCopy.triggerTerm, value: trigger },
  { term: 'Agent', value: 'Claude, opus, 30 min limit, 2 at a time' },
  { term: 'Skills', value: <span className="mono">code-build, code-review</span> },
  {
    term: 'Rules',
    value: (
      <>
        <CommandChip>/code-build</CommandChip> on issues labelled user-story; <CommandChip>/code-review</CommandChip> on
        pull requests
      </>
    ),
  },
];

const ready = {
  projectName,
  repo,
  label: { name: 'user-story', color: '#7C8FD8' },
  command: '/code-build',
};

export const SetupReady: Story = {
  name: 'Setup, ready',
  render: () => (
    <SetupReadyScreen
      {...ready}
      lastEvent={{ mode: 'webhook', at: 'ping, 14:01:37' }}
      summary={readySummary(connectionCopy.triggerSummary('webhook'))}
    />
  ),
};

export const SetupReadyWithWarning: Story = {
  name: 'Setup, ready, setup warning',
  render: () => (
    <SetupReadyScreen
      {...ready}
      lastEvent={{ mode: 'webhook', at: 'ping, 14:01:37' }}
      summary={readySummary(connectionCopy.triggerSummary('webhook'))}
      warning={{
        title: 'The last workspace setup test failed',
        detail: 'Runs still start, but setup may fail in them. Open Workspace setup to see the log.',
        href: '#',
      }}
    />
  ),
};

export const SetupReadyPolling: Story = {
  name: 'Setup, ready, polling',
  render: () => (
    <SetupReadyScreen
      {...ready}
      lastEvent={{ mode: 'polling', at: '20s ago' }}
      summary={readySummary(connectionCopy.triggerSummary('polling'))}
    />
  ),
};

export const SetupReadyNoRule: Story = {
  name: 'Setup, ready, no rule',
  render: () => (
    <SetupReadyScreen
      {...ready}
      command={undefined}
      label={undefined}
      lastEvent={{ mode: 'webhook', at: 'ping, 14:01:37' }}
      summary={readySummary(connectionCopy.triggerSummary('webhook'))}
    />
  ),
};

// The wizard in the one shell: the stepper takes the menu slot (the drawer below 1024px) and the page draws its own
// main, with "Exit setup" in the stepper column, or in a header row at the top of the page below 1024px.
const wizardStory = (story: Story): Story => ({
  ...story,
  parameters: { ...story.parameters, shell: true },
});
function WizardFrame({ height = 900, children }: { height?: number; children: ReactNode }) {
  return (
    <ShellFrame
      wizard
      height={height}
      topBar={{
        user,
        crumbs: [{ label: 'Projects', href: '#projects' }, { label: 'New project' }],
        org,
      }}
    >
      {children}
    </ShellFrame>
  );
}
const wizardSkills = (
  <Setup3Screen
    projectName={projectName}
    repo={repo}
    branch="main"
    templates={skillTemplates}
    selected={skillTemplates.map((t) => t.name)}
    commitMessage="Add Agent Desk skills: code-build, code-review"
    exitHref="#projects"
  />
);

export const Setup3ExitSetup: Story = wizardStory({
  name: 'Setup 3, skills, in the shell with Exit setup',
  render: () => <WizardFrame>{wizardSkills}</WizardFrame>,
});

export const Setup3PreviewDialog: Story = wizardStory({
  name: 'Setup 3, skills, template preview dialog',
  render: () => <WizardFrame>{wizardSkills}</WizardFrame>,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getAllByRole('button', { name: /^Preview / })[0]);
  },
});

export const Setup4ExitSetup: Story = wizardStory({
  name: 'Setup 4, first rule, in the shell with Exit setup',
  render: () => (
    <Setup4Screen
      projectName={projectName}
      repo={repo}
      rule={rule}
      skills={['code-build', 'code-review']}
      followUp={{ command: 'code-review', target: 'pr', skill: 'code-review', enabled: true }}
      maxRunsPerTicket={agentSettings.maxRunsPerTicket}
      promptPreview={{ state: 'ready', systemLines: promptSystemLines }}
      modelList={liveModels}
      defaultAgentName="Claude"
      exitHref="#projects"
    />
  ),
});

export const SetupReadyExitSetup: Story = wizardStory({
  name: 'Setup, ready, in the shell with Exit setup',
  render: () => (
    <SetupReadyScreen
      {...ready}
      lastEvent={{ mode: 'webhook', at: 'ping, 14:01:37' }}
      summary={readySummary(connectionCopy.triggerSummary('webhook'))}
      exitHref="#projects"
    />
  ),
});
