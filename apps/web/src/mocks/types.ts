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
