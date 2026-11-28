import type { AgentKind } from '@agentdesk/contracts';
import type { ReactNode } from 'react';
import type { RunStatus } from '@/ds/tokens';
import type { TicketKind } from '@/ds/TicketRef';
import type { PrState } from '@/ds/tokens';
import type { IconName } from '@/ds/icons';
import type { ChainStep } from '@/components/ChainTimeline';
import type { ConnectionState } from '@/components/ConnectionIndicator';
import type { CredentialType } from '@/components/SecretField';
import type { RuleDraft } from '@/components/RuleSentence';

export type Label = { name: string; color: string };
export type Ticket = {
  kind: TicketKind;
  number: number;
  title: string;
  labels: Label[];
  state?: string;
  href: string;
  prState?: PrState;
};
export type Actor = { login: string; initials?: string; bot?: boolean };
/** Display-ready Runs list Usage cell: visible text, hover title and the screen reader suffix. */
export type UsageCellView = { text: string; title: string; srSuffix: string };
export type RunUsageModelView = { name: string; tokens: string; cost: string; unpriced: boolean };
export type RunUsageView =
  | { state: 'none' }
  | {
      state: 'data';
      total: string;
      input: string;
      cacheRead: string;
      cacheWrite: string;
      output: string;
      reasoning?: string;
      cost: string;
      atLeast: boolean;
      /** `21 Nov 2026` or `18 Nov 2026 to 21 Nov 2026`; absent when no date sentence applies. */
      priceDate?: string;
      partial: boolean;
      models: RunUsageModelView[];
    };
export type RunSummary = {
  id: number;
  status: RunStatus;
  statusNote?: string;
  command: string;
  skill: string;
  agent: string;
  model: string;
  ticket: Ticket;
  triggeredBy: Actor;
  startedAt: string;
  duration?: string;
  /** Absent renders as no usage data. */
  usage?: UsageCellView;
};
export type TicketGroup = {
  /** The lead ticket: the issue of a merged group, else the group's own ticket. */
  ticket: Ticket;
  /** Display-ready, built by features/runs/map.ts; on a merged group it carries every ticket's count. */
  chainNote?: string;
  /** The lead ticket's runs, all statuses. */
  runsUsed: number;
  runsMax: number;
  runs: RunSummary[];
  /** The group's other tickets (PRs by number) with their own counts; non-empty only on a merged group. */
  linked?: { ticket: { kind: TicketKind; number: number }; runsUsed: number }[];
};

/** How a project hears about new comments. Webhook is the default; polling works with no public URL. */
export type TriggerMode = 'webhook' | 'polling';
/** Polling interval choices. Minimum and default 5 min. */
export type PollInterval = '5 min' | '10 min' | '15 min' | '30 min';

/** Project connection status. ok: Connected / Polling every N; warn: silent webhook; err: polling error. */
export type ConnectionStatus = { mode: TriggerMode; tone: 'ok' | 'warn' | 'err'; text: string };

/** A connection problem shown as a banner above the runs list. */
export type ConnectionWarning = {
  tone: 'err' | 'warn';
  icon: IconName;
  title: string;
  body: string;
  actions: { label: string; href?: string; icon?: IconName; variant?: 'default' | 'primary' | 'ghost' }[];
};

export type Project = {
  id: string;
  org: string;
  name: string;
  repo: string;
  connection: ConnectionStatus;
  needsYou: number;
  running: number;
  queued: number;
  lastRun: string;
};

export type IgnoredCommand = {
  at: string;
  ticket: { kind: TicketKind; number: number; prState?: PrState };
  command: string;
  author: string;
  reason: string;
  detail: string;
  href: string;
};

export type Skill = {
  name: string;
  description: string;
  body: string;
  ruleSummary: string;
  path: string;
  lastCommit: string;
};

export type SkillTemplate = { name: string; description: string; note?: string };

export type Rule = RuleDraft & { id: string; stats: string; warning?: string };

export type AgentSettings = {
  agent: 'Claude';
  model: string;
  /** The agent's API address; '' = the provider default. */
  baseUrl: string;
  credential: {
    type: CredentialType;
    setAt: string;
    setBy: string;
    status?: { tone: 'ok' | 'err'; text: string };
  };
  timeoutMinutes: number;
  /** How long a paused run is kept before it expires. */
  pausedKeepMinutes: number;
  /** How long a finished run's session can be re-opened; 0 keeps none. */
  doneKeepMinutes: number;
  idleEndMinutes: number;
  maxConcurrent: number;
  maxRunsPerTicket: number;
  /** How many times in a row a run resumes by itself after its pod ends unexpectedly; 0 turns it off. */
  autoResumeMax: number;
};

export type RunDetailData = {
  run: RunSummary;
  usage?: RunUsageView;
  /** The Usage section starts collapsed. */
  usageCollapsed?: true;
  /** The Usage section's Models table starts collapsed. */
  usageModelsCollapsed?: true;
  elapsed: string;
  rule: string;
  triggerNote: string;
  startedAt: string;
  endedAt?: string;
  chain: ChainStep[];
  pullRequest?: { ticket: Ticket; diffstat?: string };
  lifecycle?: { at: string; text: string }[];
  startup?: { label: string; detail?: string; at?: string; state: 'done' | 'active' | 'pending' }[];
  idle?: { since: string; endsAt: string; slotNote: string };
  /** What the agent said when it asked a question or declared the task done; untrusted, shown as plain text. */
  agentNote?: string;
  /**
   * The prompt the run started with, secrets redacted; `null` = started before prompts were recorded ("Not recorded");
   * absent = no Prompt section (boards not yet updated). Prototype only, see apps/web/CONTRACT-GAPS.md.
   */
  finalPrompt?: string | null;
  /** The Prompt section starts expanded. */
  promptOpen?: boolean;
  time?: { elapsed: string; limit: string; percent: number };
  connection: { state: ConnectionState; label: string };
  termSize?: string;
  endNote?: { title: string; body: ReactNode; actions: { label: string; href?: string; icon?: IconName }[] };
  /** A failed run that stopped in setup, before the agent started. */
  failureStage?: 'setup' | 'agent';
  /** The agent's paused keep time as words ("7 days"): the Stop session confirm and the Stopped headline use it. */
  pausedKeep?: string;
  /** The setup script version the run used, and how it ended. */
  setup?: { version: number; note?: string };
  /**
   * A kept or expired session (ADR 0022). `headline` shows above the agent note, `detail` below it;
   * `resumeFailure` is the error banner above the buttons after a resume that fell back.
   */
  session?: {
    state: 'paused' | 'kept' | 'expired' | 'none';
    headline?: string;
    detail?: string;
    resumeFailure?: string;
    /** "Tried to resume automatically N times.": a third line under `detail` once the tries ran out. */
    autoResumeGaveUp?: string;
    /** A person's Stop parked the run (pauseReason 'stopped'): the paused notice's icon reads "Stopped". */
    stopped?: true;
  };
  /**
   * The idle timer or Finish is ending the live session (`sessionEndingAt` set): the terminal is closed, the page says
   * "Session ending…" until the run is parked or finished. `session.state: 'none'` carries only a `resumeFailure` (a queued resume
   * that had nothing kept to resume from).
   */
  pausing?: true;
  /** The session of a succeeded run is reopened (`reopenedAt` set): the result stays succeeded, the only action is Close session. */
  reopened?: true;
  /** A queued or starting run that already ran once: the Resume is in progress. */
  resuming?: true;
  /** The banner of a resumed run that has not started a new turn yet; the agent's note is untrusted text inside it. */
  resumed?: string;
};

export type RunDetailKey =
  | 'RunStarting'
  | 'RunRunning'
  | 'RunIdle'
  | 'RunDone'
  | 'RunReconnect'
  | 'RunSucceeded'
  | 'RunFailed'
  | 'RunSetupFailed'
  | 'RunTimedOut'
  | 'RunCancelled'
  | 'RunPaused'
  | 'RunExpired'
  | 'RunStopped'
  | 'RunSucceededFinished'
  | 'RunRunningStop'
  | 'RunIdleEnding'
  | 'RunStoppedPodLost'
  | 'RunStoppedPodLostGaveUp'
  | 'RunStoppedPodLostGaveUpOnce'
  | 'RunStoppedCrashedGaveUp'
  | 'RunStoppedAutoResumeWaiting'
  | 'RunStoppedAutoResumeFailedGaveUp'
  | 'RunRunningAutoResume';

// Org onboarding view types (switcher, checklist, invitations). Plain view data: dates are already formatted.
export interface OrgOption {
  id: string;
  slug: string;
  name: string;
  /** Platform view: the switcher menu marks the org "Suspended"; it still links. */
  suspended?: boolean;
}
export interface OrgSwitchData {
  current: OrgOption | null;
  orgs: OrgOption[];
  platformAdmin: boolean;
  /** The org list while it is not ready; absent means ready, with `orgs`. */
  list?: { status: 'loading' } | { status: 'error'; onRetry(): void };
}
export type ChecklistStepKey = 'connect_code_host' | 'create_project' | 'add_agent' | 'add_rule';
export interface ChecklistStep {
  key: ChecklistStepKey;
  label: string;
  done: boolean;
  href: string;
}
export type InvitationStatusView = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';
export interface ExpiryView {
  kind: 'relative' | 'exact' | 'none';
  text: string;
  title?: string;
  dateTime?: string;
}
export interface OrgInvitationRowView {
  id: string;
  email: string;
  role: string;
  access: string;
  status: InvitationStatusView;
  expires: ExpiryView;
  invitedBy: string | null;
  actions: ('copy' | 'resend' | 'revoke')[];
}
export interface InvitationCardView {
  id: string;
  orgName: string;
  roleName: string;
  access: string;
  inviter: string | null;
  expires: { text: string; title: string; dateTime: string };
}
export interface InvitationDetailsView extends InvitationCardView {
  orgSlug: string;
  status: InvitationStatusView;
}
export interface InviteOption {
  id: string;
  label: string;
}

// Tenant admin (Settings → General, Members, Invitations, Audit log).
export type OrgSettingsTabKey = 'general' | 'members' | 'invitations' | 'audit';
export type OrgRoleKey = 'owner' | 'admin' | 'member' | 'viewer';
/** One grant of a member: `scopeName` is "Organization" or a project name. */
export interface MemberGrantView {
  id: string;
  scopeName: string;
  roleName: string;
}
export interface MemberRowView {
  userId: string;
  name: string;
  handle: string;
  you: boolean;
  /** null renders "No role". */
  role: { key: OrgRoleKey; name: string } | null;
  /** Every grant the caller can see, as scope and role: the org grant first, then projects by name. */
  grants: MemberGrantView[];
  /** From the caller's rights (BR-4, BR-9). */
  canChangeRole: boolean;
  canRemove: boolean;
}
/** A project grant the change-access dialog edits (`assignmentId` is the grant it replaces or removes). */
export interface ProjectGrantView {
  assignmentId: string;
  projectId: string;
  projectName: string;
  roleId: string;
  roleName: string;
}
/** What the change-access dialog hands back: the org role (null = No role) and the member's project grants as wanted. */
export interface AccessChange {
  roleId: string | null;
  projects: { assignmentId?: string; projectId: string; roleId: string }[];
}
export interface RoleCardOption {
  roleId: string | null;
  key: OrgRoleKey | 'none';
  name: string;
  description: string;
}
export interface AuditTextPart {
  text: string;
  strong: boolean;
  /** Shown in the mono face (URLs); never combined with `strong`. */
  mono?: boolean;
}
export interface AuditRowView {
  id: string;
  when: { label: string; exact: string; iso: string };
  who: { label: string; tag: 'deleted' | 'platform' | null };
  what:
    { kind: 'sentence'; parts: AuditTextPart[]; title: string } | { kind: 'raw'; key: string; target: string | null };
  /** Muted line under the sentence, for example "Reason: <text>". */
  note?: string;
}

// Project space (Settings → Members and Audit log of one project).
export type ProjectRoleKey = 'admin' | 'member' | 'viewer';
export interface ProjectMemberRowView {
  userId: string;
  name: string;
  /** null shows the name only. */
  handle: string | null;
  you: boolean;
  /** The project-scope roles: "Member" or "Member, Viewer"; empty when the access is inherited only. */
  roles: string;
  /** The org-scope roles that apply here, "Viewer"; empty when there are none. Managed in org Settings. */
  orgRoles: string;
  /** Access through an org-wide role only: the row has no Change role or Remove actions. */
  inherited: boolean;
}
export interface MemberPickerOption {
  userId: string;
  name: string;
  handle: string | null;
}
export type MemberPickerState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'searching' }
  | { kind: 'error'; onRetry: () => void }
  | { kind: 'loadingMore' }
  | { kind: 'loadMoreError'; onRetry: () => void };

// Agent configurations (Settings → Agent & settings → Agents).
export type AgentStatusTone = 'ok' | 'warn' | 'err' | 'off';
export interface AgentStatusView {
  tone: AgentStatusTone;
  text: string;
}
export interface AgentRowView {
  id: string;
  name: string;
  /** The provider's logo key (contracts capability table). */
  logo: string;
  /** The provider's name, the text of its logo (contracts capability table). */
  providerLabel: string;
  /** "<provider label> . <account label> . <auth type>", the parts that exist. */
  detail: string;
  model: string;
  isDefault: boolean;
  status: AgentStatusView;
}
export interface ProviderOptionView {
  kind: AgentKind;
  label: string;
  logo: string;
}
export interface ComingSoonOptionView {
  id: string;
  label: string;
  logo: string;
}
export interface ProviderPickerOptions {
  runnable: ProviderOptionView[];
  comingSoon: ComingSoonOptionView[];
}

/** One runnable provider as the Add and Edit pane needs it: the contracts capability row plus its kind. */
export interface AgentKindView {
  kind: AgentKind;
  label: string;
  logo: string;
  credentialTypes: { type: CredentialType; label: string; valueLabel: string; help: string }[];
  baseUrl: { help: string; requiredFor: CredentialType[] } | null;
  modelHelp: string;
  supportsMaxTurns: boolean;
  credentialOptional: boolean;
  modelOptional: boolean;
  builtinModels: { id: string; label: string }[];
}
/** One saved agent as the Edit and View pane shows it. The credential value never appears here. */
export interface AgentPaneAgent {
  id: string;
  name: string;
  provider: AgentKind;
  accountLabel: string;
  model: string;
  /** '' = the provider's own address. */
  baseUrl: string;
  maxTurns: number | null;
  isDefault: boolean;
  credential: { set: boolean; type: CredentialType | null; setAt: string; setBy: string };
  status: AgentStatusView;
  /** The day of the last test, for "Last test <day>."; null = never tested. */
  testedAt: string | null;
}
