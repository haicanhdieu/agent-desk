import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ComponentProps, ReactElement } from 'react';
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
  type AgentListProps,
  type AgentPaneProps,
  type DeleteAgentDialogProps,
  type PaginationProps,
  type ProviderPickerOption,
  type RuleDraft,
} from '@/components';
import { ruleAgentWarning, type RuleAgentOption } from '@/components/RuleSentence';
import type { Actor, AgentPaneAgent, ProjectMemberRowView, Rule } from '@/mocks/types';
import type { DeskFrameData } from './DeskFrame';
import {
  agentKindViews,
  agentPaneAgents,
  agentRowView,
  agentRowViews,
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
  providerPickerOptions,
  pagedAuditLastPage,
  projectAuditRows,
  projectAuditRowsExpired,
  projectAuditRowsNoEmail,
  manyAgents,
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
import { DeskAgent as DeskAgentBase, type AgentLimits, type DeskAgentProps } from './DeskAgent';
import type { DeskSetupEnvironmentProps, EnvListGroup } from './DeskSetupEnvironment';
import { DeskRules as DeskRulesScreen, RulePane } from './DeskRules';
import { DeskSkills as DeskSkillsScreen, type DeskSkillsProps } from './DeskSkills';
import { toModelList } from '@/components';
import { agentModelsFixtures } from '@/mocks/dto/agentModels';
import { StatusIcon, Toast, ToastRegion } from '@/ds';
import { ProjectShellFrame } from './projectShellFrame';
import { viewport } from './viewports';

// Artboards come from canvas.json: DeskSkills, DeskSkillDelete, the DeskRulesAgent* boards, DeskSetup, DeskSetupTest 1440x900; every Agent & settings board 1440x900 (the panel scrolls inside);
// DeskRulesAgentPrompt, DeskRulesAgentPromptNew, DeskRulesAgentPromptError 1440x1080.
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
  historyHref: 'https://github.com/harbor-labs/invoicer-api/blob/main/.claude/skills/code-build/SKILL.md',
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

export const DeskSkillsHistoryUnavailable: Story = {
  name: 'Skills, no repository history',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => <DeskSkillsScreen {...skillsProps} historyHref={undefined} />,
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
  historyHref: 'https://github.com/harbor-labs/invoicer-api/blob/main/.claude/skills/qa-e2e/SKILL.md',
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

/** The agents the rule form offers (names as the boards draw them). */
const ruleAgents: RuleAgentOption[] = [
  {
    id: 'agent-legacy',
    label: 'Claude - Legacy key',
    provider: 'claude',
    needsCredential: true,
    model: 'claude-opus-4-5-20251101',
    connection: 'ok',
  },
  {
    id: 'agent-personal',
    label: 'Claude - Personal',
    provider: 'claude',
    needsCredential: true,
    model: 'claude-opus-4-5-20251101',
    connection: 'ok',
  },
  {
    id: 'agent-staging',
    label: 'Claude - Staging',
    provider: 'claude',
    needsCredential: true,
    model: 'claude-opus-4-5-20251101',
    connection: 'ok',
  },
  {
    id: 'agent-work',
    label: 'Claude - Work',
    provider: 'claude',
    needsCredential: true,
    model: 'claude-sonnet-4-5-20250929',
    connection: 'ok',
  },
  {
    id: 'agent-reviews',
    label: 'Codex - Reviews',
    provider: 'codex',
    needsCredential: true,
    model: 'gpt-5-codex',
    connection: 'no_credential',
  },
  {
    id: 'agent-opencode',
    label: 'OpenCode',
    provider: 'opencode',
    needsCredential: false,
    connection: 'no_credential',
  },
];

/** The list the boards share: the first rule's agent has no working credential, so its row warns. */
const agentRules: Rule[] = rules.map((r) =>
  r.id === 'r3'
    ? { ...r, agentId: 'agent-reviews', agentLabel: 'Codex - Reviews', warning: ruleAgentWarning(ruleAgents[4]!) }
    : r,
);

const agentRuleDraft = (patch: Partial<RuleDraft>): RuleDraft => ({
  command: 'triage',
  target: 'issue',
  labels: [],
  skill: '',
  kind: 'prompt',
  prompt: TRIAGE_PROMPT,
  agentId: 'agent-personal',
  agentLabel: 'Claude - Personal',
  model: null,
  enabled: true,
  ...patch,
});

const rulesAgentBoard = (pane: Partial<ComponentProps<typeof RulePane>> & { value: RuleDraft }): Story => ({
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => (
    <DeskRulesScreen
      frame={deskFrame}
      rules={agentRules}
      skills={skills.map((s) => s.name)}
      editingId="r6"
      maxRunsPerTicket={agentSettings.maxRunsPerTicket}
      form={
        <RulePane
          title="Edit rule"
          skills={skills.map((s) => s.name)}
          modelField={modelField}
          promptPreview={promptReady}
          onChange={() => undefined}
          onClose={() => undefined}
          onSave={() => undefined}
          onDelete={() => undefined}
          {...pane}
        />
      }
    />
  ),
});

/** An agent picked in the rule form: the model resets to Default model and its help names that agent. */
export const DeskRulesAgent: Story = {
  name: 'Routing rules, agent picked',
  ...rulesAgentBoard({
    value: agentRuleDraft({ agentId: 'agent-work', agentLabel: 'Claude - Work' }),
    agents: ruleAgents,
    defaultAgentName: 'Claude - Personal',
  }),
};

/** The rule's agent was deleted: the select keeps its name marked unavailable and the help says to pick another. */
export const DeskRulesAgentGone: Story = {
  name: 'Routing rules, agent deleted',
  ...rulesAgentBoard({
    value: agentRuleDraft({ agentId: 'agent-deleted', agentLabel: 'Claude - Legacy key' }),
    agents: ruleAgents,
    defaultAgentName: 'Claude - Personal',
  }),
};

/** The agent list is still loading: the select is disabled and shows "Loading agents…". */
export const DeskRulesAgentLoading: Story = {
  name: 'Routing rules, agent list loading',
  ...rulesAgentBoard({ value: agentRuleDraft({}), agentsState: 'loading' }),
};

/** The reader may not list agents: the select is locked on the rule's own agent. */
export const DeskRulesAgentLocked: Story = {
  name: 'Routing rules, no permission to list agents',
  ...rulesAgentBoard({ value: agentRuleDraft({}) }),
};

/** A rule on the project default, and a row whose agent has no working credential. */
export const DeskRulesAgentWarning: Story = {
  name: 'Routing rules, agent without credential',
  ...rulesAgentBoard({
    value: agentRuleDraft({ agentId: null, agentLabel: undefined }),
    agents: ruleAgents,
    defaultAgentName: 'Claude - Personal',
  }),
};

/** Fits the window: a short canvas with a long list, so the list's own scroll box and the pinned header and pager show. */
export const DeskRulesAgentFitsViewport: Story = {
  name: 'Routing rules, fits the window',
  decorators: [
    (S) => (
      <div style={{ width: 1440, height: 560 }}>
        <S />
      </div>
    ),
  ],
  globals: viewport(1440, 900),
  render: () => (
    <DeskRulesScreen
      frame={deskFrame}
      height="viewport"
      rules={pagedRules(20)}
      skills={skills.map((s) => s.name)}
      maxRunsPerTicket={agentSettings.maxRunsPerTicket}
      pagination={pagination(1, 24)}
    />
  ),
};

const promptReady = { state: 'ready', systemLines: promptSystemLines } as const;

/** Editing a custom prompt rule: the prompt, its counter and the read-only lines Agent Desk adds. */
export const DeskRulesAgentPrompt: Story = {
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
export const DeskRulesAgentPromptNew: Story = {
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
export const DeskRulesAgentPromptError: Story = {
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
export const DeskRulesAgentNewRuleError: Story = {
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

const agentLimits: AgentLimits = {
  timeoutMinutes: 30,
  pausedKeepMinutes: 1440,
  doneKeepMinutes: 120,
  idleEndMinutes: 10,
  maxConcurrent: 2,
  maxRunsPerTicket: 10,
  autoResumeMax: 5,
};
const agentGithub = github({
  term: connectionCopy.lastEventTerm,
  text: 'issue_comment, 2 min ago, accepted (webhook)',
});
const pollingGithub = github({ term: connectionCopy.lastCheckedTerm, text: '20s ago, no new comments (polling)' });
const liveModels = toModelList({ status: 'success', data: agentModelsFixtures.live }, null);
const builtinModels = (reason: 'no_credential' | 'unreachable', baseUrl: string | null = null) =>
  toModelList(
    { status: 'success', data: { source: 'builtin', reason, models: agentModelsFixtures.unreachable.models } },
    baseUrl,
  );

const noop = () => undefined;
const paging = (total: number, page = 1): PaginationProps => ({
  page,
  pageSize: 20,
  total,
  onPageChange: noop,
  onPageSizeChange: noop,
});
const agentList = (over: Partial<AgentListProps> = {}): AgentListProps => ({
  rows: agentRowViews,
  state: 'ready',
  pagination: paging(agentRowViews.length),
  onRetry: noop,
  onAdd: noop,
  onEdit: noop,
  onTest: noop,
  onSetDefault: noop,
  onDelete: noop,
  ...over,
});
const providerOptions: ProviderPickerOption[] = [
  ...providerPickerOptions.runnable.map((o) => ({ kind: o.kind, label: o.label, logo: o.logo, available: true })),
  ...providerPickerOptions.comingSoon.map((o) => ({ kind: o.id, label: o.label, logo: o.logo, available: false })),
];
const agentPane = (over: Partial<AgentPaneProps> = {}): AgentPaneProps => ({
  mode: 'add',
  kinds: agentKindViews,
  providers: providerOptions,
  modelList: builtinModels('no_credential'),
  onClose: noop,
  onSubmit: noop,
  onReplaceCredential: noop,
  onTest: noop,
  ...over,
});
const paneAgent = (name: string): AgentPaneAgent => {
  const found = agentPaneAgents.find((a) => a.name === name);
  if (!found) throw new Error(`no agent fixture named ${name}`);
  return found;
};
const editPane = (name: string, over: Partial<AgentPaneProps> = {}): AgentPaneProps =>
  agentPane({ mode: 'edit', agent: paneAgent(name), modelList: liveModels, ...over });
const workName = 'Claude - Work';

type Canvas = ReturnType<typeof within>;
const pickRadio = (c: Canvas, name: string) => userEvent.click(c.getByRole('radio', { name }));

/** An Agent & settings board: the Agents tab unless the board says otherwise. One 1440x900 artboard; the panel scrolls. */
const agentBoard = (name: string, props: Partial<DeskAgentProps>, play?: Story['play']): Story => ({
  name,
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => (
    <DeskAgentScreen frame={deskFrame} limits={agentLimits} github={agentGithub} agents={agentList()} {...props} />
  ),
  play,
});
const agentsBoard = (name: string, props: Partial<DeskAgentProps>, play?: Story['play']): Story =>
  agentBoard(name, { tab: 'agents', ...props }, play);

// Agents tab: the list
export const DeskAgentList: Story = agentsBoard('Agents tab', {});
export const DeskAgentListEmpty: Story = agentsBoard('Agents tab, no agents yet', {
  agents: agentList({ rows: [], state: 'empty', pagination: paging(0) }),
});
export const DeskAgentListError: Story = agentsBoard('Agents tab, list could not load', {
  agents: agentList({ rows: [], state: 'error', error: { requestId: 'req_8f3a21' } }),
});
export const DeskAgentListLoading: Story = agentsBoard('Agents tab, list loading', {
  agents: agentList({ rows: [], state: 'loading' }),
});
export const DeskAgentListPaged: Story = agentsBoard('Agents tab, second page', {
  agents: agentList({ rows: manyAgents(24).slice(20).map(agentRowView), pagination: paging(24, 2) }),
});
/** Lee Park, an admin of this project only: three tabs, no Danger zone. */
export const DeskAgentListProjectAdmin: Story = {
  ...agentsBoard('Agents tab, project admin (no Danger zone)', {}),
  render: () => (
    <DeskAgentBase
      frame={{ ...deskFrame, user: { login: 'lee-park', initials: 'LP' } }}
      limits={agentLimits}
      github={agentGithub}
      agents={agentList()}
      tab="agents"
    />
  ),
};
export const DeskAgentListReadOnly: Story = agentsBoard('Agents tab, read-only', {
  agents: agentList({ readOnly: true }),
  pane: agentPane({ mode: 'view', agent: paneAgent(workName), modelList: liveModels }),
  limitsReadOnly: true,
});
export const DeskAgentListTesting: Story = agentsBoard('Agents tab, testing one row', {
  agents: agentList({ testingId: agentRowViews[1].id }),
});
export const DeskAgentRowMenu: Story = agentsBoard('Agents tab, row menu open', {}, async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole('button', { name: `Actions for ${agentRowViews[1].name}` }));
});
export const DeskAgentTestFailed: Story = agentsBoard('Agents tab, test connection failed', {
  pane: editPane(workName),
});
export const DeskAgentDefaultChanged: Story = agentsBoard('Agents tab, default changed', {
  agents: agentList({ rows: agentRowViews.map((r, i) => ({ ...r, isDefault: i === 1 })) }),
});

// Agents tab: the Add pane
export const DeskAgentAdd: Story = agentsBoard('Add agent, no provider picked yet', { pane: agentPane() });
export const DeskAgentAddForm: Story = agentsBoard(
  'Add agent, Claude Code',
  { pane: agentPane() },
  async ({ canvasElement }) => pickRadio(within(canvasElement), 'Claude Code'),
);
export const DeskAgentAddCodex: Story = agentsBoard(
  'Add agent, OpenAI Codex',
  { pane: agentPane() },
  async ({ canvasElement }) => pickRadio(within(canvasElement), 'OpenAI Codex'),
);
/** OpenCode needs no login: nothing is picked and the no-login line shows. */
export const DeskAgentAddOpenCode: Story = agentsBoard(
  'Add agent, OpenCode',
  { pane: agentPane() },
  async ({ canvasElement }) => pickRadio(within(canvasElement), 'OpenCode'),
);
export const DeskAgentAddFieldErrors: Story = agentsBoard(
  'Add agent, field errors',
  {
    pane: agentPane({
      fieldErrors: {
        name: 'An agent with this name already exists.',
        accountLabel: 'Use 256 characters or fewer.',
        model: 'Enter a model name.',
      },
    }),
  },
  async ({ canvasElement }) => pickRadio(within(canvasElement), 'OpenAI Codex'),
);
/** The agent was created but its credential was not saved. */
export const DeskAgentAddPartial: Story = agentsBoard('Add agent, agent saved, credential not saved', {
  pane: editPane('Claude - New', { partial: { reason: 'The credential file is too large.', requestId: 'req_01HZX' } }),
});
export const DeskAgentAddSaving: Story = agentsBoard(
  'Add agent, saving the credential',
  { pane: agentPane({ saving: true, progress: 'Saving credential…' }) },
  async ({ canvasElement }) => pickRadio(within(canvasElement), 'Claude Code'),
);

// Agents tab: the Edit pane
export const DeskAgentEdit: Story = agentsBoard('Edit the default agent', { pane: editPane('Claude - Personal') });
export const DeskAgentEditWork: Story = agentsBoard('Edit a second Claude agent', { pane: editPane(workName) });
export const DeskAgentEditCodex: Story = agentsBoard('Edit a Codex agent', { pane: editPane('Codex') });
/** A credentials file is saved; Replace opens the panel and the choice changes to API endpoint and key. */
export const DeskAgentEditOpenCode: Story = agentsBoard(
  'Edit an OpenCode agent, credentials file replaced by an API endpoint and key',
  { pane: editPane('OpenCode - Credentials file') },
  async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Replace' }));
    await pickRadio(c, 'API endpoint and key');
  },
);
export const DeskAgentEditAddressChanged: Story = agentsBoard(
  'Edit, API address changed, credential needed again',
  { pane: editPane('Claude - Personal') },
  async ({ canvasElement }) =>
    userEvent.type(within(canvasElement).getByLabelText('API address'), 'https://proxy.example.com'),
);
export const DeskAgentEditReplace: Story = agentsBoard(
  'Edit, replace the credential',
  { pane: editPane(workName) },
  async ({ canvasElement }) => userEvent.click(within(canvasElement).getByRole('button', { name: 'Replace' })),
);
export const DeskAgentEditNoCredential: Story = agentsBoard('Edit an agent with no credential yet', {
  pane: editPane('Claude - New'),
});
export const DeskAgentEditSaving: Story = agentsBoard('Edit, saving', {
  pane: editPane('Claude - Personal', { saving: true, progress: 'Saving agent…' }),
});
export const DeskAgentEditGone: Story = agentsBoard('Edit, the agent was deleted meanwhile', {
  pane: editPane(workName, { gone: true }),
});
export const DeskAgentEditModelFallback: Story = agentsBoard('Edit, model list could not load, typed model', {
  pane: editPane('OpenCode - Own endpoint', {
    modelList: builtinModels('unreachable', 'https://llm.harbor-labs.example/v1'),
  }),
});
export const DeskAgentEditModelLoading: Story = agentsBoard('Edit, model list loading', {
  pane: editPane('Claude - Personal', { modelList: toModelList({ status: 'pending' }, null) }),
});

// Agents tab: Delete
const toDelete = (state: DeleteAgentDialogProps) => ({ deleteDialog: state });
const deleteBase = { name: workName, onKeep: noop, onDelete: noop };
export const DeskAgentDelete: Story = agentsBoard('Delete confirm', toDelete({ ...deleteBase, state: 'confirm' }));
export const DeskAgentDeleteBlocked: Story = agentsBoard(
  'Delete refused, a rule uses it',
  toDelete({ ...deleteBase, state: 'blockedRules', rule: { count: 1, command: 'fix' } }),
);
export const DeskAgentDeleteBlockedRuns: Story = agentsBoard(
  'Delete refused, a run is still open',
  toDelete({
    ...deleteBase,
    state: 'blocked',
    reason: {
      title: 'This agent has open runs',
      text: 'Run 12 is paused and can be resumed. Finish it first, then delete.',
    },
  }),
);
export const DeskAgentDeleteError: Story = agentsBoard(
  'Delete failed',
  toDelete({ ...deleteBase, state: 'error', error: { title: 'Something went wrong', requestId: 'req_8f3a21' } }),
);
export const DeskAgentDeleting: Story = agentsBoard('Deleting', toDelete({ ...deleteBase, state: 'deleting' }));

// GitHub connection tab
const githubBoard = (name: string, props: Partial<DeskAgentProps>): Story =>
  agentBoard(name, { tab: 'github', ...props });
export const DeskAgentGitHub: Story = githubBoard('GitHub connection tab', {});
export const DeskAgentGitHubPolling: Story = githubBoard('GitHub connection tab, polling', {
  connection: connections.pollingOk,
  github: pollingGithub,
});
export const DeskAgentGitHubCheckingNow: Story = githubBoard('GitHub connection tab, checking now', {
  connection: connections.pollingOk,
  checkingNow: true,
  github: pollingGithub,
});
export const DeskAgentGitHubCheckRefused: Story = githubBoard('GitHub connection tab, check refused', {
  connection: connections.pollingRevoked,
  checkNowError: "Polling is paused: the connection's token was revoked. Reconnect it, then check again.",
  github: github({ term: connectionCopy.lastCheckedTerm, text: '2 hours ago (polling)' }),
});
export const DeskAgentGitHubTriggerError: Story = githubBoard('GitHub connection tab, saving the trigger mode failed', {
  triggerError: 'Internal server error',
});
export const DeskAgentGitHubLoading: Story = githubBoard('GitHub connection tab, loading', { githubState: 'loading' });
export const DeskAgentGitHubError: Story = githubBoard('GitHub connection tab, could not load', {
  githubState: 'error',
  githubError: { requestId: 'req_01JDE7Q3M9KT' },
});

// Limits tab
const limitsBoard = (name: string, props: Partial<DeskAgentProps>): Story =>
  agentBoard(name, { tab: 'limits', ...props });
export const DeskAgentLimits: Story = limitsBoard('Limits tab, project-wide', {});
export const DeskAgentLimitsSaving: Story = limitsBoard('Limits tab, saving', { savingLimits: true });
export const DeskAgentLimitsFieldErrors: Story = limitsBoard('Limits tab, field errors', {
  limits: { ...agentLimits, autoResumeMax: 12 },
  limitsErrors: {
    timeoutMinutes: 'Too big: expected number to be <=10080',
    autoResumeMax: 'Automatic resumes must be between 0 and 10',
  },
});
export const DeskAgentLimitsError: Story = limitsBoard('Limits tab, the save failed', {
  limitsError: 'Internal server error',
});
export const DeskAgentLimitsReadOnly: Story = limitsBoard('Limits tab, read-only', { limitsReadOnly: true });

/** Fits the window: a short canvas with a long list, so the list's own scroll box and the pinned Pagination show. */
export const DeskAgentListFitsViewport: Story = {
  name: 'Agents tab, fits the window',
  decorators: [
    (S) => (
      <div style={{ width: 1440, height: 560 }}>
        <S />
      </div>
    ),
  ],
  globals: viewport(1440, 900),
  render: () => (
    <DeskAgentScreen
      frame={deskFrame}
      height="viewport"
      limits={agentLimits}
      github={agentGithub}
      tab="agents"
      agents={agentList({ rows: manyAgents(20).map(agentRowView), pagination: paging(45) })}
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

const pagination = (page: number, total: number): PaginationProps => ({
  page,
  pageSize: 20,
  total,
  onPageChange: noop,
  onPageSizeChange: noop,
});

/** Page 2 of 2 of 24 routing rules: the control sits between the list and the guards card. */
export const DeskRulesAgentPaged: Story = {
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
export const DeskRulesAgentEmpty: Story = {
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

// The project Desk pages in the one shell: the "Project menu" beside a page that draws only its header and body.
const deskShellStory = (story: Story): Story => ({ ...story, parameters: { ...story.parameters, shell: true } });

export const DeskSkillsSideMenu: Story = deskShellStory({
  name: 'Skills, side menu',
  render: () => (
    <ProjectShellFrame page="skills" fill crumbs={[{ label: 'Skills' }]}>
      <DeskSkillsScreen {...skillsProps} />
    </ProjectShellFrame>
  ),
});

export const DeskSetupSideMenu: Story = deskShellStory({
  name: 'Workspace setup, side menu',
  render: () => (
    <ProjectShellFrame page="setup" fill crumbs={[{ label: 'Workspace setup' }]}>
      <DeskSetupScreen {...setupProps} />
    </ProjectShellFrame>
  ),
});

export const DeskRulesForbiddenSideMenu: Story = deskShellStory({
  name: 'Routing rules URL opened without access: project menu, no active item',
  render: () => (
    <ProjectShellFrame page={null} state="forbidden">
      <main className={screenStyles.emptyNotice}>
        <div className={screenStyles.emptyNoticeCol}>
          <h1>You don&apos;t have access</h1>
          <p className="muted">Ask an owner of this organization to give you access.</p>
        </div>
      </main>
    </ProjectShellFrame>
  ),
});
