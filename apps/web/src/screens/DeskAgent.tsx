import { useState, type ReactNode } from 'react';
import { TabPanel, Tabs } from '@/ds';
import {
  AgentPane,
  PageHeader,
  type AgentListProps,
  type AgentPaneProps,
  type DeleteAgentDialogProps,
} from '@/components';
import { DEFAULT_POLL_INTERVAL } from '@/mocks/connection';
import type { ConnectionStatus, PollInterval, TriggerMode } from '@/mocks/types';
import styles from './Screens.module.css';
import { SetupWarningBanner, type DeskFrameData } from './DeskFrame';
import {
  AgentsPanel,
  DangerPanel,
  GitHubPanel,
  LimitsPanel,
  useLimitsForm,
  type LimitsPanelProps,
  type AgentLimits,
  type LimitField,
} from './DeskAgentPanels';

export type { AgentLimits, LimitField };

export type DeskAgentTab = 'agents' | 'github' | 'limits' | 'danger';

const TAB_PREFIX = 'agent-settings';
const TABS: { value: DeskAgentTab; label: string }[] = [
  { value: 'agents', label: 'Agents' },
  { value: 'github', label: 'GitHub connection' },
  { value: 'limits', label: 'Limits' },
  { value: 'danger', label: 'Danger zone' },
];

export interface DeskAgentProps {
  /** The project, its connection and the setup warning. */
  frame: DeskFrameData;
  /** The open tab; without it the screen keeps its own, starting on `agents`. */
  tab?: DeskAgentTab;
  onTabChange?(tab: DeskAgentTab): void;
  /** Agents tab: the list, its state and its row actions. */
  agents?: AgentListProps;
  /** Agents tab: the add, edit or view pane, a right column beside the list. */
  pane?: AgentPaneProps;
  /** Agents tab: the delete confirmation or why the delete is refused. */
  deleteDialog?: DeleteAgentDialogProps;
  /** GitHub connection rows. A Trigger mode row is added after Repository. */
  github: { term: string; value: ReactNode }[];
  /** The GitHub tab could not load, or is loading. */
  githubState?: 'ready' | 'loading' | 'error';
  githubError?: { requestId?: string };
  onRetryGithub?(): void;
  /** Project connection; its mode is the initial trigger mode. Shown in the side nav. */
  connection?: ConnectionStatus;
  pollInterval?: PollInterval;
  /** The trigger mode shown, when the caller owns it (e.g. back to the saved mode after a failed change). */
  trigger?: { mode: TriggerMode; interval: PollInterval };
  onTriggerChange?(trigger: { mode: TriggerMode; interval: PollInterval }): void;
  /** Why the last trigger mode change failed. */
  triggerError?: string;
  /** Check now (polling mode): poll the connection right away. */
  onCheckNow?(): void;
  /** A check is running: Check now is disabled and says so. */
  checkingNow?: boolean;
  /** Why the last check failed or was refused (e.g. polling is paused), with what to do about it. */
  checkNowError?: string;
  /** The project-wide limits as saved. */
  limits: AgentLimits;
  onSaveLimits?(limits: AgentLimits): void;
  /** Per-field messages from a refused limits save; the typed values stay. */
  limitsErrors?: Partial<Record<LimitField, string>>;
  /** A limits save failure that belongs to no field. */
  limitsError?: string;
  /** A limits save is in flight: Save limits stays disabled. */
  savingLimits?: boolean;
  /** The reader may see the limits but not change them. */
  limitsReadOnly?: boolean;
  /** Called after the delete is confirmed in a dialog. Without it there is no Danger zone tab (project admins). */
  onDeleteProject?(): void;
}

const NO_LIST: AgentListProps = {
  rows: [],
  state: 'loading',
  onRetry: () => undefined,
  pagination: { page: 1, pageSize: 20, total: 0, onPageChange: () => undefined, onPageSizeChange: () => undefined },
  onAdd: () => undefined,
  onEdit: () => undefined,
  onTest: () => undefined,
  onSetDefault: () => undefined,
  onDelete: () => undefined,
};

/** The Limits tab with its own form state: leaving the tab drops unsaved edits (BR-58), saved values stay. */
function LimitsTab({ limits, ...panel }: { limits: AgentLimits } & Omit<LimitsPanelProps, 'form'>) {
  const form = useLimitsForm(limits);
  return <LimitsPanel form={form} {...panel} />;
}

export function DeskAgent({
  frame,
  tab,
  onTabChange,
  agents = NO_LIST,
  pane,
  deleteDialog,
  github,
  githubState,
  githubError,
  onRetryGithub,
  connection,
  pollInterval = DEFAULT_POLL_INTERVAL,
  trigger,
  onTriggerChange,
  triggerError,
  onCheckNow,
  checkingNow = false,
  checkNowError,
  limits,
  onSaveLimits,
  limitsErrors,
  limitsError,
  savingLimits = false,
  limitsReadOnly = false,
  onDeleteProject,
}: DeskAgentProps) {
  const [ownTab, setOwnTab] = useState<DeskAgentTab>('agents');
  const tabs = onDeleteProject ? TABS : TABS.filter((t) => t.value !== 'danger');
  const requested = tab ?? ownTab;
  const active = tabs.some((t) => t.value === requested) ? requested : 'agents';
  const changeTab = (next: DeskAgentTab) => {
    setOwnTab(next);
    onTabChange?.(next);
  };

  const [ownMode, setMode] = useState<TriggerMode>(connection?.mode ?? 'webhook');
  const [ownInterval, setPollEvery] = useState(pollInterval);
  const mode = trigger?.mode ?? ownMode;
  const interval = trigger?.interval ?? ownInterval;
  const pick = (next: { mode: TriggerMode; interval: PollInterval }) => {
    setMode(next.mode);
    setPollEvery(next.interval);
    onTriggerChange?.(next);
  };

  const lead = frame.warning ? <SetupWarningBanner warning={frame.warning} /> : undefined;
  const strip = (
    <div className={styles.agentTabs}>
      <Tabs tabs={tabs} value={active} onChange={changeTab} label="Agent and project settings" idPrefix={TAB_PREFIX} />
    </div>
  );
  const panels = (
    <>
      <TabPanel value="agents" active={active} idPrefix={TAB_PREFIX}>
        <AgentsPanel list={agents} deleteDialog={deleteDialog} lead={lead} />
      </TabPanel>
      <TabPanel value="github" active={active} idPrefix={TAB_PREFIX}>
        <GitHubPanel
          state={githubState}
          error={githubError}
          onRetry={onRetryGithub}
          items={github}
          mode={mode}
          interval={interval}
          onTriggerChange={pick}
          triggerError={triggerError}
          onCheckNow={onCheckNow}
          checkingNow={checkingNow}
          checkNowError={checkNowError}
          lead={lead}
        />
      </TabPanel>
      <TabPanel value="limits" active={active} idPrefix={TAB_PREFIX}>
        <LimitsTab
          limits={limits}
          onSave={onSaveLimits}
          errors={limitsErrors}
          error={limitsError}
          saving={savingLimits}
          readOnly={limitsReadOnly}
          lead={lead}
        />
      </TabPanel>
      {onDeleteProject && (
        <TabPanel value="danger" active={active} idPrefix={TAB_PREFIX}>
          <DangerPanel onDeleteProject={onDeleteProject} lead={lead} />
        </TabPanel>
      )}
    </>
  );
  // The shell draws the bar and the menu: one main holding the column (header, tabs, panel) and the side pane.
  return (
    <main className={styles.shellSplitMain}>
      <div className={`${styles.agentSettingsMain} ${styles.shellSplitCol}`}>
        <PageHeader title="Agent & settings" />
        {strip}
        {panels}
      </div>
      {active === 'agents' && pane && <AgentPane key={`${pane.mode}-${pane.agent?.id ?? 'new'}`} {...pane} />}
    </main>
  );
}
