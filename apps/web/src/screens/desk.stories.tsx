import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactElement } from 'react';
import { fn, userEvent, within } from 'storybook/test';
import {
  AddProjectMemberDialog,
  AppShell,
  ChangeRoleDialog,
  InviteDialog,
  NO_PAGE_CRUMBS,
  TopBar,
  type AddProjectMemberDialogProps,
  type ChangeRoleDialogProps,
  type InviteDialogStep,
  type InviteDialogValues,
  type EnvSaveError,
  type PaginationProps,
} from '@/components';
import type { Actor, ProjectMemberRowView } from '@/mocks/types';
import type { DeskFrameData } from './DeskFrame';
import {
  agentSettings,
  connectionCopy,
  connections,
  deskFrame as plainDeskFrame,
  inviteProjectOptions,
  inviteRoleOptions,
  invitationLink,
  envBoardSecretRows,
  envPagedSecretRows,
  envPagedVariableRows,
  envVariableRows,
  orgSwitchFixtures,
  pagedRules,
  pagedSkills,
  pagedVersions,
  pagedAuditLastPage,
  projectAuditRows,
  projectAuditRowsExpired,
  projectAuditRowsNoEmail,
  manyPickerOptions,
  memberPickerOptions,
  pagedProjectMemberRows,
  projectMemberRows,
  projectRoleCards,
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
import { DeskAudit as DeskAuditScreen } from './DeskAudit';
import { DeskMembers as DeskMembersScreen, type DeskMembersProps } from './DeskMembers';
import screenStyles from './Screens.module.css';
import { DeskAgent as DeskAgentBase, type DeskAgentProps } from './DeskAgent';
import type { DeskSetupEnvironmentProps, EnvListGroup } from './DeskSetupEnvironment';
import { DeskRules as DeskRulesScreen, RulePane } from './DeskRules';
import { DeskSkills as DeskSkillsScreen, type DeskSkillsProps } from './DeskSkills';
import { toModelList } from '@/components';
import { agentModelsFixtures } from '@/mocks/dto/agentModels';
import { StatusIcon, Toast, ToastRegion } from '@/ds';
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

/** The Desk boards under the app bar: the org crumb, the account menu, and the Runs and Settings tabs with Settings active. */
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
    members: '#members',
    audit: '#audit',
  },
};

// The Danger zone shows only when the caller can delete the project, so the owner boards pass a handler.
const DeskAgentScreen = (props: DeskAgentProps) => <DeskAgentBase onDeleteProject={() => undefined} {...props} />;

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

export const DeskSkillsSubmitting: Story = {
  name: 'Skills, submitting',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => <DeskSkillsScreen {...skillsProps} committing />,
};

const changeRequest = {
  sourceBranch: 'agent-desk/skill-update-code-build-m3k9x2',
  targetBranch: 'main',
  url: 'https://example.com/harbor-labs/invoicer-api/pull/42',
} as const;

export const DeskSkillsSubmittedForReview: Story = {
  name: 'Skills, changes submitted for review',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => (
    <DeskSkillsScreen
      {...skillsProps}
      submission={{ action: 'save', ...changeRequest }}
      onDismissSubmission={() => {}}
    />
  ),
};

export const DeskSkillDeleteSubmitting: Story = {
  name: 'Skills, delete submitting',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => <DeskSkillsScreen {...skillsProps} deleting="code-e2e" deletePending />,
};

export const DeskSkillDeleteSubmittedForReview: Story = {
  name: 'Skills, deletion submitted for review',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => (
    <DeskSkillsScreen
      {...skillsProps}
      dirty={false}
      submission={{ action: 'delete', ...changeRequest, sourceBranch: 'agent-desk/skill-delete-code-e2e-m3k9x2' }}
      onDismissSubmission={() => {}}
    />
  ),
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
            agentId: 'agent-claude',
            agentLabel: 'Claude',
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
            agentId: 'agent-claude',
            agentLabel: 'Claude',
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
            agentId: 'agent-claude',
            agentLabel: 'Claude',
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

/** Lee Park, an admin of this project only: no onDeleteProject, so no Danger zone. */
export const DeskAgentProjectAdmin: Story = {
  name: 'Agent & settings, project admin (no Delete project)',
  decorators: artboard(1320),
  globals: viewport(1440, 1320),
  render: () => (
    <DeskAgentBase
      frame={{ ...deskFrame, user: { login: 'lee-park', initials: 'LP' } }}
      settings={agentSettings}
      modelList={liveModels}
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

// The project Audit log (Settings > Access > Audit log), 1440x900 boards.
const audit = (state: Parameters<typeof DeskAuditScreen>[0]['state']): Story => ({
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => <DeskAuditScreen frame={deskFrame} state={state} />,
});
const retry = () => undefined;

export const DeskAudit: Story = {
  name: 'Audit log, newest first: members, invitations with projects, many projects, generic, deleted user',
  ...audit({ kind: 'ready', rows: projectAuditRows }),
};
export const DeskAuditLoading: Story = { name: 'Audit log, loading', ...audit({ kind: 'loading' }) };
export const DeskAuditEmpty: Story = { name: 'Audit log, empty', ...audit({ kind: 'ready', rows: [] }) };
export const DeskAuditError: Story = {
  name: 'Audit log, failed to load',
  ...audit({ kind: 'error', requestId: 'req_01JD7Q3M8V2K', onRetry: retry }),
};
export const DeskAuditPaged: Story = {
  name: 'Audit log, page 2 of 2',
  ...audit({ kind: 'ready', rows: pagedAuditLastPage, pagination: pagination(2, 25) }),
};
export const DeskAuditInvitationNoEmail: Story = {
  name: 'Audit log, invitation entries without the email (viewer does not administer every listed project)',
  ...audit({ kind: 'ready', rows: projectAuditRowsNoEmail }),
};
export const DeskAuditInvitationExpired: Story = {
  name: 'Audit log, expired invitation entries, with and without the email',
  ...audit({ kind: 'ready', rows: projectAuditRowsExpired }),
};

// The project Members page (Settings > Access > Members), 1440x900 boards. Lee Park (project admin) is signed in
// unless a board says otherwise.
const LEE: Actor = { login: 'lee-park', initials: 'LP' };
const MIRA: Actor = { login: 'mira-chen', initials: 'MC' };
const leeFrame: DeskFrameData = { ...deskFrame, user: LEE };
const members = (
  state: DeskMembersProps['state'],
  props: Partial<Omit<DeskMembersProps, 'state'>> = {},
  frame: DeskFrameData = leeFrame,
): Story => ({
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => (
    <DeskMembersScreen
      frame={frame}
      orgName="Harbor Labs"
      projectName="invoicer-api"
      state={state}
      onAdd={noop}
      onInvite={noop}
      onChangeRole={noop}
      onRemove={noop}
      {...props}
    />
  ),
});
const membersReady = (
  rows: ProjectMemberRowView[],
  more: Partial<Extract<DeskMembersProps['state'], { kind: 'ready' }>> = {},
): DeskMembersProps['state'] => ({ kind: 'ready', rows, busyUserId: null, ...more });

export const DeskMembers: Story = {
  name: 'Members: you, several roles, a long name and a person without a handle',
  ...members(membersReady(projectMemberRows)),
};
export const DeskMembersLoading: Story = { name: 'Members, loading', ...members({ kind: 'loading' }) };
export const DeskMembersEmpty: Story = {
  name: 'Members, empty (org owner)',
  ...members(membersReady([]), {}, deskFrame),
};
export const DeskMembersError: Story = {
  name: 'Members, failed to load',
  ...members({ kind: 'error', requestId: 'req_01JD7Q3M8V2K', onRetry: noop }),
};
export const DeskMembersPaged: Story = {
  name: 'Members, page 2 of 2',
  ...members(membersReady(pagedProjectMemberRows.slice(0, 5), { pagination: pagination(2, 25) })),
};
export const DeskMembersForbidden: Story = {
  name: 'Members URL opened by a member or viewer: no access under the project bar, no Settings tab, no side menu',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => (
    <>
      <TopBar
        variant="project"
        crumbs={NO_PAGE_CRUMBS}
        state="forbidden"
        active="runs"
        user={MIRA}
        org={deskFrame.org}
        needsYou={deskFrame.project.needsYou}
        project={{ name: deskFrame.project.name, repoUrl: `https://github.com/${deskFrame.project.repo}` }}
        links={{ projects: '#projects', runs: '#runs' }}
      />
      <main className={screenStyles.emptyNotice}>
        <div className={screenStyles.emptyNoticeCol}>
          <h1>You don&apos;t have access</h1>
          <p className="muted">Ask an owner of this organization to give you access.</p>
        </div>
      </main>
    </>
  ),
};
export const DeskMembersRowMenu: Story = {
  name: 'Members, row menu on another person',
  ...members(membersReady(projectMemberRows), { openMenuUserId: 'user-tenant-4' }),
};
export const DeskMembersBusy: Story = {
  name: 'Members, a row action in flight: that menu is disabled',
  ...members(membersReady(projectMemberRows, { busyUserId: 'user-tenant-4' })),
};

// The Add member dialog over the Members page (Lee Park, project admin). Dialogs are always open boards, controlled.
const noPickerOption = memberPickerOptions[0] ?? null;
const memberRole = projectRoleCards[1]?.roleId ?? null;
const addDialog = (
  over: Partial<AddProjectMemberDialogProps> = {},
  picker: Partial<AddProjectMemberDialogProps['picker']> = {},
) => (
  <AddProjectMemberDialog
    projectName="invoicer-api"
    orgName="Harbor Labs"
    picker={{
      query: '',
      onQueryChange: noop,
      options: memberPickerOptions,
      total: memberPickerOptions.length,
      hasMore: false,
      state: { kind: 'idle' },
      picked: null,
      onPick: noop,
      onLoadMore: noop,
      ...picker,
    }}
    roles={projectRoleCards}
    roleId={null}
    onRoleChange={noop}
    errors={{}}
    saving={false}
    onSubmit={noop}
    onCancel={noop}
    {...over}
  />
);
const membersAdd = (dialog: ReturnType<typeof addDialog>): Story =>
  members(membersReady(projectMemberRows), { children: dialog });

export const DeskMembersAdd: Story = {
  name: 'Members, add dialog: Person and Role empty, no role preselected',
  ...membersAdd(addDialog()),
};
export const DeskMembersAddSearch: Story = {
  name: 'Members, add dialog: server search open, 20 of 23 loaded, more load on scroll',
  ...membersAdd(addDialog({}, { query: 'a', options: manyPickerOptions.slice(0, 20), total: 23, hasMore: true })),
};
export const DeskMembersAddNoMatch: Story = {
  name: 'Members, add dialog: no member matches the search',
  ...membersAdd(addDialog({}, { query: 'zz', options: [], total: 0 })),
};
export const DeskMembersAddAllAdded: Story = {
  name: 'Members, add dialog: everyone in the organization already has a role here',
  ...membersAdd(addDialog({}, { options: [], total: 0 })),
};
export const DeskMembersAddFieldErrors: Story = {
  name: 'Members, add dialog: submitted with no person and no role',
  ...membersAdd(addDialog({ errors: { userId: 'Choose a person.', roleId: 'Choose a role.' } })),
};
export const DeskMembersAddSaving: Story = {
  name: 'Members, add dialog: saving',
  ...membersAdd(addDialog({ roleId: memberRole, saving: true }, { picked: noPickerOption })),
};
export const DeskMembersAddFormError: Story = {
  name: 'Members, add dialog: server error, input kept',
  ...membersAdd(
    addDialog(
      {
        roleId: memberRole,
        formError: { title: 'Internal server error', requestId: 'req_01JD7Q3M8V2K' },
      },
      { picked: noPickerOption },
    ),
  ),
};
export const DeskMembersAddAlreadyOnProject: Story = {
  name: 'Members, add dialog: 409, the person got a role meanwhile; Person cleared, role kept',
  ...membersAdd(
    addDialog({
      roleId: memberRole,
      formError: {
        title: 'This person already has a role on this project.',
        detail: 'Use Change role to change it.',
      },
    }),
  ),
};
export const DeskMembersAdded: Story = {
  name: 'Members, added: list refetched, toast',
  ...members(
    membersReady([
      ...projectMemberRows,
      {
        userId: 'user-candidate-1',
        name: 'Mira Chen',
        handle: 'mira',
        you: false,
        roles: 'Member',
        orgRoles: '',
        inherited: false,
      },
    ]),
    { notice: { tone: 'ok', title: 'Mira Chen added as Member', onDismiss: noop } },
  ),
};

// Invite, change role and remove over the Members page (Lee Park, project admin). Dialogs are always open boards.
const invitePersonValues: InviteDialogValues = {
  email: '',
  roleId: '',
  scope: 'projects',
  projectIds: inviteProjectOptions.slice(0, 1).map((p) => p.id),
};
const inviteDialog = (step: InviteDialogStep) => (
  <InviteDialog
    open
    step={step}
    roles={inviteRoleOptions.projectAdmin}
    projects={inviteProjectOptions.slice(0, 1).map((p) => ({ ...p, label: 'invoicer-api' }))}
    projectsOnly
    onChange={noop}
    onSubmit={noop}
    onCancel={noop}
    onCopy={noop}
    onDone={noop}
  />
);
const changeRoleDialog = (over: Partial<ChangeRoleDialogProps> = {}) => (
  <ChangeRoleDialog
    memberName="Cleo Martin"
    orgName="Harbor Labs"
    options={projectRoleCards}
    current={memberRole}
    self={false}
    currentIsOwner={false}
    saving={false}
    onSave={noop}
    onCancel={noop}
    {...over}
  />
);
const removeConfirm = (busy = false): NonNullable<DeskMembersProps['removeConfirm']> => ({
  memberName: 'Cleo Martin',
  projectName: 'invoicer-api',
  orgName: 'Harbor Labs',
  busy,
  onConfirm: noop,
  onCancel: noop,
});
const membersWithout = (userId: string) => projectMemberRows.filter((r) => r.userId !== userId);

export const DeskMembersInvite: Story = {
  name: 'Members, invite dialog: this project fixed, project roles only',
  ...members(membersReady(projectMemberRows), {
    children: inviteDialog({
      kind: 'form',
      values: invitePersonValues,
      errors: {},
      saving: false,
    }),
  }),
};
export const DeskMembersInviteCreated: Story = {
  name: 'Members, invite dialog: invitation created',
  ...members(membersReady(projectMemberRows), {
    children: inviteDialog({
      kind: 'created',
      email: 'new.person@example.com',
      expiresOn: '23 Nov, 14:05',
      link: invitationLink,
    }),
  }),
};
export const DeskMembersChangeRole: Story = {
  name: 'Members, change role dialog: Admin, Member, Viewer, current preselected',
  ...members(membersReady(projectMemberRows), { children: changeRoleDialog() }),
};
export const DeskMembersChangeRoleSaving: Story = {
  name: 'Members, change role dialog: saving',
  ...members(membersReady(projectMemberRows), {
    children: changeRoleDialog({ current: projectRoleCards[2]?.roleId ?? null, saving: true }),
  }),
};
export const DeskMembersChangeRoleError: Story = {
  name: 'Members, change role dialog: refused (403), Banner in the dialog',
  ...members(membersReady(projectMemberRows), {
    children: changeRoleDialog({ error: { kind: 'forbidden', requestId: 'req_01JD7Q3M8V2K' } }),
  }),
};
export const DeskMembersRoleChanged: Story = {
  name: 'Members, role changed: list refetched, toast',
  ...members(membersReady(projectMemberRows), {
    notice: { tone: 'ok', title: 'Role changed', onDismiss: noop },
  }),
};
export const DeskMembersRemoveConfirm: Story = {
  name: 'Members, remove from project confirmation',
  ...members(membersReady(projectMemberRows), { removeConfirm: removeConfirm() }),
};
export const DeskMembersRemoving: Story = {
  name: 'Members, removing',
  ...members(membersReady(projectMemberRows), { removeConfirm: removeConfirm(true) }),
};
export const DeskMembersRemoved: Story = {
  name: 'Members, removed: list refetched, toast, focus on the heading',
  ...members(membersReady(membersWithout('user-tenant-4')), {
    notice: { tone: 'ok', title: 'Cleo Martin removed from invoicer-api', onDismiss: noop },
  }),
};
export const DeskMembersGone: Story = {
  name: 'Members, member removed meanwhile: dialog closed, list refetched, error toast',
  ...members(membersReady(membersWithout('user-tenant-4')), {
    notice: { tone: 'error', title: 'Member is no longer on this project', onDismiss: noop },
  }),
};

// The Environment tab boards (DeskSetupEnvironment*): the tab body inside the setup page, Environment selected.
const done = () => Promise.resolve(null);
const writable = (entries: EnvListGroup['entries'], more: Partial<EnvListGroup> = {}): EnvListGroup => ({
  entries,
  canWrite: true,
  onCreate: fn(done),
  onUpdate: fn(done),
  onRemove: fn(done),
  onRetry: fn(),
  ...more,
});
const envSecrets = () => writable(envBoardSecretRows);
const envVariables = () => writable(envVariableRows);

const environmentScreen = (
  environment: DeskSetupEnvironmentProps,
  more: Partial<DeskSetupProps> = {},
): ReactElement => (
  <DeskSetupScreen {...setupProps} tab="environment" onTabChange={noop} environment={environment} {...more} />
);

const envStory = (name: string, environment: () => DeskSetupEnvironmentProps, play?: Story['play']): Story => ({
  name: `Workspace setup, environment${name}`,
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => environmentScreen(environment()),
  ...(play ? { play } : {}),
});

const envPageSize = 20;
const envPagination = (page: number, total: number, label: string): PaginationProps => ({
  ...pagination(page, total),
  pageSize: envPageSize,
  label,
});
const pagedVariables = (total: number) =>
  writable(envPagedVariableRows(total).slice(envPageSize), {
    total,
    pagination: envPagination(2, total, 'Variables pagination'),
  });

const groupOf = (canvasElement: HTMLElement, name: string) =>
  within(within(canvasElement).getByRole('group', { name }));

export const DeskSetupEnvironment: Story = envStory('', () => ({ variables: envVariables(), secrets: envSecrets() }));

export const DeskSetupEnvironmentEmpty: Story = envStory(', no entries yet', () => ({
  variables: writable([]),
  secrets: writable([]),
}));

export const DeskSetupEnvironmentLoading: Story = envStory(', loading', () => ({
  variables: writable([], { loading: true }),
  secrets: writable([], { loading: true }),
}));

export const DeskSetupEnvironmentError: Story = envStory(', variables failed to load', () => ({
  variables: writable([], {
    loadError: { message: 'Could not load the environment. Reload to try again.', requestId: 'req_01JDE7Q3M9KT' },
  }),
  secrets: envSecrets(),
}));

export const DeskSetupEnvironmentAdding: Story = envStory(', adding a variable', () => ({
  variables: writable(envVariableRows, { initial: { adding: true } }),
  secrets: envSecrets(),
}));

export const DeskSetupEnvironmentAddSecret: Story = envStory(', adding a secret', () => ({
  variables: envVariables(),
  secrets: writable(envBoardSecretRows, { initial: { adding: true } }),
}));

export const DeskSetupEnvironmentEditing: Story = envStory(', editing a variable', () => ({
  variables: writable(envVariableRows, { initial: { editing: 'DB_HOST' } }),
  secrets: envSecrets(),
}));

export const DeskSetupEnvironmentSaving: Story = envStory(', saving a variable', () => ({
  variables: writable(envVariableRows, { initial: { editing: 'DB_HOST', saving: true } }),
  secrets: envSecrets(),
}));

export const DeskSetupEnvironmentSecretReplace: Story = envStory(', replacing a secret', () => ({
  variables: envVariables(),
  secrets: writable(envBoardSecretRows, { initial: { editing: 'NPM_TOKEN' } }),
}));

export const DeskSetupEnvironmentRemove: Story = envStory(', remove a variable', () => ({
  variables: writable(envVariableRows, { initial: { removing: 'DB_HOST' } }),
  secrets: envSecrets(),
}));

/** A reserved name and a value under 6 characters: both field errors come from the contracts schema. */
export const DeskSetupEnvironmentFieldErrors: Story = envStory(
  ', reserved name and short secret',
  () => ({ variables: envVariables(), secrets: writable(envBoardSecretRows, { initial: { adding: true } }) }),
  async ({ canvasElement }) => {
    const form = groupOf(canvasElement, 'Add secret');
    await userEvent.type(form.getByLabelText('Name'), 'GITHUB_TOKEN');
    await userEvent.type(form.getByLabelText('Value'), 'abc');
    await userEvent.click(form.getByRole('button', { name: 'Add secret' }));
  },
);

export const DeskSetupEnvironmentNameTaken: Story = envStory(
  ', name already exists',
  () => ({
    variables: writable(envVariableRows, {
      initial: { adding: true },
      onCreate: fn(() =>
        Promise.resolve<EnvSaveError>({
          field: { name: 'DB_HOST already exists. A name can be used once, as a variable or a secret.' },
        }),
      ),
    }),
    secrets: envSecrets(),
  }),
  async ({ canvasElement }) => {
    const form = groupOf(canvasElement, 'Add variable');
    await userEvent.type(form.getByLabelText('Name'), 'DB_HOST');
    await userEvent.type(form.getByLabelText('Value'), 'db.other');
    await userEvent.click(form.getByRole('button', { name: 'Add variable' }));
  },
);

export const DeskSetupEnvironmentLimit: Story = envStory(
  ', limit reached',
  () => ({
    variables: writable(envVariableRows, {
      initial: { adding: true },
      onCreate: fn(() =>
        Promise.resolve<EnvSaveError>({
          banner: {
            title: 'Too many entries',
            detail: 'This project has 500 entries, the most this deployment allows. Remove one to add another.',
          },
        }),
      ),
    }),
    secrets: envSecrets(),
  }),
  async ({ canvasElement }) => {
    const form = groupOf(canvasElement, 'Add variable');
    await userEvent.type(form.getByLabelText('Name'), 'AWS_REGION');
    await userEvent.type(form.getByLabelText('Value'), 'eu-central-1');
    await userEvent.click(form.getByRole('button', { name: 'Add variable' }));
  },
);

export const DeskSetupEnvironmentSaveError: Story = envStory(
  ', save failed',
  () => ({
    variables: envVariables(),
    secrets: writable(envBoardSecretRows, {
      initial: { adding: true },
      onCreate: fn(() =>
        Promise.resolve<EnvSaveError>({
          banner: { title: 'Internal server error', requestId: 'req_01JDE8A4T2WX' },
        }),
      ),
    }),
  }),
  async ({ canvasElement }) => {
    const form = groupOf(canvasElement, 'Add secret');
    await userEvent.type(form.getByLabelText('Name'), 'SMTP_PASSWORD');
    await userEvent.type(form.getByLabelText('Value'), 'hunter2hunter2');
    await userEvent.click(form.getByRole('button', { name: 'Add secret' }));
  },
);

/** The entry was removed by someone else while this row was open. */
export const DeskSetupEnvironmentGone: Story = envStory(
  ', entry no longer exists',
  () => ({
    variables: writable(envVariableRows, {
      initial: { editing: 'DB_HOST' },
      onUpdate: fn(() => Promise.resolve<EnvSaveError>({ gone: true })),
    }),
    secrets: envSecrets(),
  }),
  async ({ canvasElement }) => {
    await userEvent.click(groupOf(canvasElement, 'Edit DB_HOST').getByRole('button', { name: 'Save' }));
  },
);

export const DeskSetupEnvironmentPaged: Story = envStory(', both lists on page 2', () => ({
  variables: pagedVariables(23),
  secrets: writable(envPagedSecretRows(22).slice(envPageSize), {
    total: 22,
    pagination: envPagination(2, 22, 'Secrets pagination'),
  }),
}));

/** After an add the variables list stays on its page (24 variables, page 2) and the Toast shows. */
export const DeskSetupEnvironmentAdded: Story = {
  name: 'Workspace setup, environment, added to another page',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => (
    <>
      {environmentScreen({
        variables: pagedVariables(24),
        secrets: writable(envPagedSecretRows(22).slice(envPageSize), {
          total: 22,
          pagination: envPagination(2, 22, 'Secrets pagination'),
        }),
      })}
      <ToastRegion>
        <Toast tone="ok" role="status" title="Added AWS_REGION" onDismiss={noop} />
      </ToastRegion>
    </>
  ),
};

export const DeskSetupEnvironmentReadOnly: Story = envStory(', read-only', () => ({
  variables: writable(envVariableRows, { canWrite: false }),
  secrets: writable(envBoardSecretRows, { canWrite: false }),
}));

export const DeskSetupEnvironmentSecretsReadOnly: Story = envStory(', secrets read-only', () => ({
  variables: envVariables(),
  secrets: writable(envBoardSecretRows, { canWrite: false }),
}));

/** A setup test is running: the tab strip stays and the running test keeps the values it started with. */
export const DeskSetupEnvironmentTesting: Story = {
  name: 'Workspace setup, environment, while a test runs',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () =>
    environmentScreen(
      { variables: envVariables(), secrets: envSecrets(), testRunning: true },
      {
        test: {
          status: 'running',
          phases: setupPhases.running,
          plugins: setupPlugins.planned,
          lines: setupTestTerminal.slice(0, 5),
          scriptLabel: 'Version 4',
          checkout: 'main a91c3e2',
          started: '14:31:05 by kim-hale',
        },
      },
    ),
};
