import type { ReactNode } from 'react';
import type { RunStatus } from '@/ds/tokens';
import type { TicketKind } from '@/ds/TicketRef';
import type { IconName } from '@/ds/icons';
import type { ChainStep } from '@/components/ChainTimeline';
import type { ConnectionState } from '@/components/ConnectionIndicator';
import type { CredentialType } from '@/components/SecretField';
import type { RuleDraft } from '@/components/RuleSentence';

export type Label = { name: string; color: string };
export type Ticket = { kind: TicketKind; number: number; title: string; labels: Label[]; state?: string; href: string };
export type Actor = { login: string; initials?: string; bot?: boolean };
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
};
export type TicketGroup = {
  ticket: Ticket;
  chainNote?: string;
  runsUsed: number;
  runsMax: number;
  runs: RunSummary[];
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
  ticket: { kind: TicketKind; number: number };
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
  credential: {
    type: CredentialType;
    setAt: string;
    setBy: string;
    status?: { tone: 'ok' | 'err'; text: string };
  };
  timeoutMinutes: number;
  idleEndMinutes: number;
  maxConcurrent: number;
  maxRunsPerTicket: number;
};

export type RunDetailData = {
  run: RunSummary;
  elapsed: string;
  rule: string;
  triggerNote: string;
  startedAt: string;
  endedAt?: string;
  chain: ChainStep[];
  pullRequest?: { ticket: Ticket; diffstat: string };
  lifecycle?: { at: string; text: string }[];
  startup?: { label: string; detail?: string; at?: string; state: 'done' | 'active' | 'pending' }[];
  idle?: { since: string; endsAt: string; slotNote: string };
  /** What the agent said when it asked a question or declared the task done; untrusted, shown as plain text. */
  agentNote?: string;
  time?: { elapsed: string; limit: string; percent: number };
  connection: { state: ConnectionState; label: string };
  termSize?: string;
  endNote?: { title: string; body: ReactNode; actions: { label: string; href?: string; icon?: IconName }[] };
  /** A failed run that stopped in setup, before the agent started. */
  failureStage?: 'setup' | 'agent';
  /** The setup script version the run used, and how it ended. */
  setup?: { version: number; note?: string };
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
  | 'RunCancelled';
