import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppShell, type PaginationProps } from '@/components';
import type { DeskFrameData } from './DeskFrame';
import {
  agentSettings,
  connectionCopy,
  connections,
  deskFrame as plainDeskFrame,
  orgSwitchFixtures,
  pagedRules,
  pagedSkills,
  pagedVersions,
  promptSystemLines,
  rules,
  TRIAGE_PROMPT,
  setupDraft,
  setupPhases,
  setupPlugins,
  setupScript,
  setupTestTerminal,
  setupVersions,
  skillDiffDraft,
  skillPreviewSamples,
  skills,
} from '@/mocks';
import { DeskSetup as DeskSetupScreen, type DeskSetupProps } from './DeskSetup';
import { DeskAgent as DeskAgentScreen } from './DeskAgent';
import { DeskRules as DeskRulesScreen, RulePane } from './DeskRules';
import { DeskSkills as DeskSkillsScreen, type DeskSkillsProps } from './DeskSkills';
import { toModelList } from '@/components';
import { agentModelsFixtures } from '@/mocks/dto/agentModels';
import { StatusIcon } from '@/ds';
import { viewport } from './viewports';

// Artboards come from canvas.json: DeskSkills, DeskSkillDelete, DeskRules, DeskSetup, DeskSetupTest 1440x900; DeskAgent 1440x1320;
// DeskRulesPrompt, DeskRulesPromptNew, DeskRulesPromptError 1440x1080.
const meta = {
  title: 'Screens/Desk',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const artboard = (height: number): NonNullable<Story['decorators']> => [
  (S) => (
    <div style={{ width: 1440, height }}>
      <AppShell height={height} topBar={null}>
        <S />
      </AppShell>
    </div>
  ),
];

/** The Desk boards under the app bar: the org crumb, the account menu, and the Runs and Desk tabs with Desk active. */
const deskFrame: DeskFrameData = {
  ...plainDeskFrame,
  org: { ...orgSwitchFixtures.severalOrgsSettings, orgHref: (o) => `#${o.slug}`, createHref: '#new-org' },
  links: {
    projects: '#projects',
    runs: '#runs',
    desk: '#desk',
    skills: '#skills',
    rules: '#rules',
    agent: '#agent',
  },
};

const skillsProps: DeskSkillsProps = {
  frame: deskFrame,
  skills,
  activeName: 'code-build',
  dirty: true,
  changedLines: [17],
  commitMessage: 'code-build: run dotnet format before opening the PR',
};

export const DeskSkills: Story = {
  name: 'Skills editor',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => <DeskSkillsScreen {...skillsProps} />,
};

export const DeskSkillsSetupWarning: Story = {
  name: 'Skills, setup warning',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => (
    <DeskSkillsScreen
      {...skillsProps}
      frame={{
        ...deskFrame,
        warning: {
          title: 'The setup script changed since the last passing test',
          detail: 'Runs use the saved script as it is. Test it again to be sure it still works.',
          href: '#',
        },
      }}
    />
  ),
};

const pending = () => new Promise<never>(() => undefined);
const previewProps: DeskSkillsProps = {
  ...skillsProps,
  activeName: 'qa-e2e',
  dirty: false,
  changedLines: [],
  view: 'preview',
};
const emptyBodySkills = skills.map((s) =>
  s.name === 'qa-e2e' ? { ...s, body: skillPreviewSamples.frontMatterOnly } : s,
);

export const DeskSkillsPreview: Story = {
  name: 'Skills, preview',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => <DeskSkillsScreen {...previewProps} />,
};

export const DeskSkillsPreviewEmpty: Story = {
  name: 'Skills, preview empty',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => <DeskSkillsScreen {...previewProps} skills={emptyBodySkills} />,
};

export const DeskSkillsPreviewLoading: Story = {
  name: 'Skills, preview loading',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => <DeskSkillsScreen {...previewProps} preview={{ load: pending }} />,
};

export const DeskSkillsPreviewError: Story = {
  name: 'Skills, preview error',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => <DeskSkillsScreen {...previewProps} preview={{ load: () => Promise.reject(new Error('offline')) }} />,
};

export const DeskSkillsPreviewDiagramLoading: Story = {
  name: 'Skills, preview diagram loading',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => <DeskSkillsScreen {...previewProps} preview={{ loadMermaid: pending }} />,
};

export const DeskSkillsDiff: Story = {
  name: 'Skills, diff',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => <DeskSkillsScreen {...skillsProps} changedLines={[]} view="diff" initialDraft={skillDiffDraft} />,
};

export const DeskSkillsDiffEmpty: Story = {
  name: 'Skills, diff empty',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => <DeskSkillsScreen {...skillsProps} dirty={false} changedLines={[]} view="diff" />,
};

export const DeskSkillDelete: Story = {
  name: 'Skills, delete confirmation',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => <DeskSkillsScreen {...skillsProps} deleting="code-e2e" rulesUsing={['/code-e2e']} />,
};

const modelField = {
  list: toModelList({ status: 'success', data: agentModelsFixtures.live }, null),
  defaultModel: 'claude-opus-4-5-20251101',
  settingsHref: '#',
};

export const DeskRules: Story = {
  name: 'Routing rules, editing',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => (
    <DeskRulesScreen
      frame={deskFrame}
      rules={rules}
      skills={skills.map((s) => s.name)}
      editingId="r2"
      maxRunsPerTicket={agentSettings.maxRunsPerTicket}
      promptPreview={promptReady}
      modelField={modelField}
    />
  ),
};

const promptReady = { state: 'ready', systemLines: promptSystemLines } as const;

/** Editing a custom prompt rule: the prompt, its counter and the read-only lines Agent Desk adds. */
export const DeskRulesPrompt: Story = {
  name: 'Routing rules, custom prompt',
  decorators: artboard(1080),
  globals: viewport(1440, 1080),
  render: () => (
    <DeskRulesScreen
      frame={deskFrame}
      rules={rules}
      skills={skills.map((s) => s.name)}
      editingId="r6"
      maxRunsPerTicket={agentSettings.maxRunsPerTicket}
      promptPreview={promptReady}
      modelField={modelField}
    />
  ),
};

/** New custom prompt rule: nothing typed yet, the system lines still loading. */
export const DeskRulesPromptNew: Story = {
  name: 'Routing rules, new custom prompt',
  decorators: artboard(1080),
  globals: viewport(1440, 1080),
  render: () => (
    <DeskRulesScreen
      frame={deskFrame}
      rules={rules}
      skills={skills.map((s) => s.name)}
      maxRunsPerTicket={agentSettings.maxRunsPerTicket}
      form={
        <RulePane
          title="New rule"
          value={{
            command: 'release-notes',
            target: 'pr',
            labels: [],
            skill: '',
            kind: 'prompt',
            prompt: '',
            agent: 'Claude',
            enabled: true,
          }}
          skills={skills.map((s) => s.name)}
          modelField={modelField}
          promptPreview={{ state: 'loading' }}
          onChange={() => undefined}
          onClose={() => undefined}
          onSave={() => undefined}
        />
      }
    />
  ),
};

/** Prompt over the limit, and the system lines failed to load. */
export const DeskRulesPromptError: Story = {
  name: 'Routing rules, custom prompt errors',
  decorators: artboard(1080),
  globals: viewport(1440, 1080),
  render: () => (
    <DeskRulesScreen
      frame={deskFrame}
      rules={rules}
      skills={skills.map((s) => s.name)}
      editingId="r6"
      maxRunsPerTicket={agentSettings.maxRunsPerTicket}
      form={
        <RulePane
          title="Edit rule"
          value={{
            command: 'triage',
            target: 'issue',
            labels: [],
            skill: '',
            kind: 'prompt',
            prompt: `${TRIAGE_PROMPT}\n${'Check every linked issue as well. '.repeat(120)}`,
            agent: 'Claude',
            enabled: true,
          }}
          skills={skills.map((s) => s.name)}
          modelField={modelField}
          promptPreview={{ state: 'error', onRetry: () => undefined }}
          errors={{ prompt: 'Keep the prompt to 4000 characters or fewer.' }}
          onChange={() => undefined}
          onClose={() => undefined}
          onSave={() => undefined}
          onDelete={() => undefined}
        />
      }
    />
  ),
};

/** New rule pane after a save the server refused: a duplicate command (409 with pointer /command). */
export const DeskRulesNewRuleError: Story = {
  name: 'Routing rules, new rule refused',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => (
    <DeskRulesScreen
      frame={deskFrame}
      rules={rules}
      skills={skills.map((s) => s.name)}
      maxRunsPerTicket={agentSettings.maxRunsPerTicket}
      form={
        <RulePane
          title="New rule"
          value={{
            command: 'code-build',
            target: 'pr',
            labels: [],
            skill: 'code-build',
            agent: 'Claude',
            enabled: true,
          }}
          skills={skills.map((s) => s.name)}
          modelField={modelField}
          errors={{ command: 'A rule for /code-build already exists in this project.' }}
          onChange={() => undefined}
          onClose={() => undefined}
          onSave={() => undefined}
        />
      }
    />
  ),
};

const ok = <StatusIcon status="succeeded" size={12} />;

const github = (last: { term: string; text: string }) => [
  {
    term: 'App installation',
    value: (
      <span className="row" style={{ gap: 6 }}>
        {ok}harbor-labs, 1 repository
      </span>
    ),
  },
  { term: 'Repository', value: <span className="mono">harbor-labs/invoicer-api</span> },
  {
    term: last.term,
    value: (
      <span className="row" style={{ gap: 6 }}>
        {ok}
        {last.text}
      </span>
    ),
  },
  {
    term: 'Default branch',
    value: (
      <>
        <span className="mono">main</span> <span className="faint">protected, bot can commit skills</span>
      </>
    ),
  },
];

const agentGithub = github({
  term: connectionCopy.lastEventTerm,
  text: 'issue_comment, 2 min ago, accepted (webhook)',
});
const liveModels = toModelList({ status: 'success', data: agentModelsFixtures.live }, null);
const savedCredential = { type: 'oauth_token' as const, setAt: '12 Oct 2026', setBy: 'kim-hale' };

export const DeskAgent: Story = {
  name: 'Agent & settings, replacing credential',
  decorators: artboard(1320),
  globals: viewport(1440, 1320),
  render: () => (
    <DeskAgentScreen
      frame={deskFrame}
      settings={agentSettings}
      modelList={liveModels}
      replacingCredential
      github={agentGithub}
    />
  ),
};

export const DeskAgentCustomModel: Story = {
  name: 'Agent & settings, custom model and address',
  decorators: artboard(1320),
  globals: viewport(1440, 1320),
  render: () => (
    <DeskAgentScreen
      frame={deskFrame}
      settings={{
        ...agentSettings,
        model: 'anthropic/claude-sonnet-4-5',
        baseUrl: 'https://gateway.harbor-labs.com/anthropic',
        credential: savedCredential,
      }}
      modelList={toModelList(
        { status: 'success', data: agentModelsFixtures.unreachable },
        'https://gateway.harbor-labs.com/anthropic',
      )}
      github={agentGithub}
    />
  ),
};

export const DeskAgentAddressChanged: Story = {
  name: 'Agent & settings, API address changed',
  decorators: artboard(1320),
  globals: viewport(1440, 1320),
  render: () => (
    <DeskAgentScreen
      frame={deskFrame}
      settings={{ ...agentSettings, credential: savedCredential }}
      modelList={liveModels}
      initialAddress="https://gateway.harbor-labs.com/anthropic"
      github={agentGithub}
    />
  ),
};

const autoResumeStory = (name: string, autoResumeMax: number, limitsErrors?: { autoResumeMax: string }): Story => ({
  name,
  decorators: artboard(1480),
  globals: viewport(1440, 1480),
  render: () => (
    <DeskAgentScreen
      frame={deskFrame}
      settings={{ ...agentSettings, autoResumeMax }}
      modelList={liveModels}
      limitsErrors={limitsErrors}
      github={agentGithub}
    />
  ),
});

/** Limits: Automatic resumes after a crash, at its default of 5. */
export const DeskAgentAutoResume: Story = autoResumeStory('Agent & settings, automatic resumes after a crash', 5);

/** The same field changed to 2. */
export const DeskAgentAutoResumeChanged: Story = autoResumeStory('Agent & settings, automatic resumes changed to 2', 2);

/** A refused save: 12 typed, the field marked invalid with the message under the help text. */
export const DeskAgentAutoResumeError: Story = autoResumeStory('Agent & settings, automatic resumes out of range', 12, {
  autoResumeMax: 'Automatic resumes must be between 0 and 10',
});

export const DeskAgentLoadingModels: Story = {
  name: 'Agent & settings, loading model list',
  decorators: artboard(1320),
  globals: viewport(1440, 1320),
  render: () => <DeskAgentScreen frame={deskFrame} settings={agentSettings} github={agentGithub} />,
};

export const DeskAgentModelsFailed: Story = {
  name: 'Agent & settings, model list failed',
  decorators: artboard(1320),
  globals: viewport(1440, 1320),
  render: () => (
    <DeskAgentScreen
      frame={deskFrame}
      settings={agentSettings}
      modelList={toModelList({ status: 'error' }, null)}
      github={agentGithub}
    />
  ),
};

export const DeskAgentSaveErrors: Story = {
  name: 'Agent & settings, refused saves',
  decorators: artboard(1320),
  globals: viewport(1440, 1320),
  render: () => (
    <DeskAgentScreen
      frame={deskFrame}
      settings={{ ...agentSettings, timeoutMinutes: 60 }}
      triggerError="Internal server error"
      limitsErrors={{ timeoutMinutes: 'Too big: expected number to be <=3300' }}
      github={github({ term: connectionCopy.lastEventTerm, text: 'issue_comment, 2 min ago, accepted (webhook)' })}
    />
  ),
};

export const DeskAgentPolling: Story = {
  name: 'Agent & settings, polling',
  decorators: artboard(1320),
  globals: viewport(1440, 1320),
  render: () => (
    <DeskAgentScreen
      frame={deskFrame}
      settings={agentSettings}
      connection={connections.pollingOk}
      github={github({ term: connectionCopy.lastCheckedTerm, text: '20s ago, no new comments (polling)' })}
    />
  ),
};

export const DeskAgentCheckingNow: Story = {
  name: 'Agent & settings, checking now',
  decorators: artboard(1320),
  globals: viewport(1440, 1320),
  render: () => (
    <DeskAgentScreen
      frame={deskFrame}
      settings={agentSettings}
      connection={connections.pollingOk}
      checkingNow
      github={github({ term: connectionCopy.lastCheckedTerm, text: '20s ago, no new comments (polling)' })}
    />
  ),
};

export const DeskAgentCheckNowRefused: Story = {
  name: 'Agent & settings, check now refused',
  decorators: artboard(1320),
  globals: viewport(1440, 1320),
  render: () => (
    <DeskAgentScreen
      frame={deskFrame}
      settings={agentSettings}
      connection={connections.pollingRevoked}
      checkNowError="Polling is paused: the connection's token was revoked. Reconnect it, then check again."
      github={github({ term: connectionCopy.lastCheckedTerm, text: '2 hours ago (polling)' })}
    />
  ),
};

const setupProps: DeskSetupProps = {
  frame: deskFrame,
  script: { version: 4, body: setupScript, savedBy: 'kim-hale', savedAgo: '2 days ago' },
  plugins: { plugins: setupPlugins.planned },
  versions: setupVersions,
  lastTest: {
    result: 'passed',
    matchesSaved: true,
    summary: 'Today 14:22 by kim-hale, 2m 41s. Clone, 2 plugins installed, 1 blocked, setup exited 0.',
  },
};

export const DeskSetup: Story = {
  name: 'Workspace setup',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => <DeskSetupScreen {...setupProps} />,
};

export const DeskSetupTest: Story = {
  name: 'Workspace setup, test failed, terminal open',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => (
    <DeskSetupScreen
      {...setupProps}
      draft={setupDraft}
      changedLines={[10]}
      test={{
        status: 'failed',
        phases: setupPhases.failed,
        plugins: setupPlugins.result,
        lines: setupTestTerminal,
        scriptLabel: 'Draft, 1 line changed from v4',
        checkout: 'main a91c3e2',
        started: '14:31:05 by kim-hale',
      }}
    />
  ),
};

export const DeskSetupStale: Story = {
  name: 'Workspace setup, script changed since the last pass',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => (
    <DeskSetupScreen
      {...setupProps}
      lastTest={{
        result: 'passed',
        matchesSaved: false,
        summary: 'Yesterday 17:05 by kim-hale, on version 3. Test again before the next run.',
      }}
    />
  ),
};

export const DeskSetupConflict: Story = {
  name: 'Workspace setup, save refused (changed since opened)',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => (
    <DeskSetupScreen
      {...setupProps}
      draft={setupDraft}
      changedLines={[10]}
      saveError="dana-ortiz saved version 5 since you opened this page. Copy your changes, reload, and apply them again."
    />
  ),
};

export const DeskSetupEmpty: Story = {
  name: 'Workspace setup, no script yet',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => <DeskSetupScreen {...setupProps} script={null} versions={[]} lastTest={undefined} />,
};

export const DeskSetupVersionsError: Story = {
  name: 'Workspace setup, version history failed to load',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => (
    <DeskSetupScreen
      {...setupProps}
      versions={[]}
      versionsError="Could not load the version history. Reload to try again."
    />
  ),
};

export const DeskSetupLoading: Story = {
  name: 'Workspace setup, loading',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => <DeskSetupScreen {...setupProps} loading />,
};

export const DeskSetupLoadError: Story = {
  name: 'Workspace setup, load failed',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => <DeskSetupScreen {...setupProps} loadError="The server did not answer. Reload to try again." />,
};

const noop = () => undefined;
const pagination = (page: number, total: number): PaginationProps => ({
  page,
  pageSize: 20,
  total,
  onPageChange: noop,
  onPageSizeChange: noop,
});

/** Page 2 of 2 of 24 routing rules: the control sits between the list and the guards card. */
export const DeskRulesPaged: Story = {
  name: 'Routing rules, page 2 of 2',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => (
    <DeskRulesScreen
      frame={deskFrame}
      rules={pagedRules(24).slice(20)}
      skills={skills.map((s) => s.name)}
      maxRunsPerTicket={agentSettings.maxRunsPerTicket}
      pagination={pagination(2, 24)}
    />
  ),
};

/** No routing rules: the empty state, no control. */
export const DeskRulesEmpty: Story = {
  name: 'Routing rules, empty',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => (
    <DeskRulesScreen
      frame={deskFrame}
      rules={[]}
      skills={skills.map((s) => s.name)}
      maxRunsPerTicket={agentSettings.maxRunsPerTicket}
      pagination={pagination(1, 0)}
    />
  ),
};

/** Page 2 of 2 of 22 skills: the editor keeps the skill it had open, which is on page 1. */
export const DeskSkillsPaged: Story = {
  name: 'Skills, page 2 of 2',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => (
    <DeskSkillsScreen
      {...skillsProps}
      skills={pagedSkills(22).slice(20)}
      active={skills.find((s) => s.name === skillsProps.activeName)}
      pagination={pagination(2, 22)}
    />
  ),
};

/** No skills: the empty state, no control. */
export const DeskSkillsEmpty: Story = {
  name: 'Skills, empty',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => <DeskSkillsScreen frame={deskFrame} skills={[]} pagination={pagination(1, 0)} />,
};

/** Page 2 of 2 of 23 setup script versions; the header counts all 23. */
export const DeskSetupPaged: Story = {
  name: 'Workspace setup, version history page 2 of 2',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => (
    <DeskSetupScreen
      {...setupProps}
      versions={pagedVersions(23).slice(20)}
      versionsTotal={23}
      versionsPagination={pagination(2, 23)}
    />
  ),
};

export const DeskSetupVersionsLoading: Story = {
  name: 'Workspace setup, version history loading',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => <DeskSetupScreen {...setupProps} versions={[]} versionsLoading />,
};

/** A saved script whose history is empty: "0 versions", no control. */
export const DeskSetupVersionsEmpty: Story = {
  name: 'Workspace setup, version history empty',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => (
    <DeskSetupScreen {...setupProps} versions={[]} versionsTotal={0} versionsPagination={pagination(1, 0)} />
  ),
};
