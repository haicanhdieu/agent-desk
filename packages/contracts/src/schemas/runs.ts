import { z } from 'zod';
import { PauseReason, RuleKind, RunListFilter, RunStatus, TicketKind, TriggerSource } from '../enums';
import { AgentNote, WaitingOn } from './agent-state';
import { Id, Timestamp } from './common';
import { PageQuery, pageOf } from './page';

export const TicketDto = z.object({
  ref: z.string(),
  kind: TicketKind,
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  labels: z.array(z.object({ name: z.string(), color: z.string() })),
});
export type TicketDto = z.infer<typeof TicketDto>;

export const FailureStage = z.enum(['setup', 'agent']);
export type FailureStage = z.infer<typeof FailureStage>;

export const RunDto = z.object({
  id: Id,
  number: z.number().int(),
  projectId: Id,
  ruleId: Id.nullable(),
  command: z.string(),
  ruleKind: RuleKind,
  skillName: z.string().nullable(),
  prompt: z.string().nullable(),
  finalPrompt: z.string().nullable(),
  agent: z.object({ name: z.string(), model: z.string() }),
  ticket: TicketDto,
  args: z.string().nullable(),
  status: RunStatus,
  triggerSource: TriggerSource,
  triggeredBy: z.string().nullable(),
  /** Agent Desk user who owns the run (an id only, never an email); null for runs from before ownership. */
  ownerUserId: z.string().nullable(),
  queuedAt: Timestamp,
  startedAt: Timestamp.nullable(),
  finishedAt: Timestamp.nullable(),
  exitCode: z.number().int().nullable(),
  failureReason: z.string().nullable(),
  /** Phase that failed; null when the run did not fail or the phase is unknown. */
  failureStage: FailureStage.nullable(),
  /** Setup script version the run used; null when the project had no script. */
  setupScriptVersion: z.number().int().nullable(),
  costUsd: z.number().nullable(),
  timeoutSeconds: z.number().int(),
  /** The agent's idle end: how long an idle run waits unattended before it pauses. */
  idleEndSeconds: z.number().int(),
  /** The agent's paused keep time: how long a paused or stopped run can be resumed. */
  pausedKeepSeconds: z.number().int(),
  idleSince: Timestamp.nullable(),
  /** Set while the run is Running only because background work is pending. */
  waitingOn: WaitingOn.nullable(),
  /** Latest one-line note from the agent, if any. */
  agentNote: AgentNote.nullable(),
  /** When the idle timer last stopped the pod; null otherwise. */
  pausedAt: Timestamp.nullable(),
  /** While a session is kept (paused or succeeded), when it is deleted; null otherwise. */
  sessionExpiresAt: Timestamp.nullable(),
  /** When the live session is scheduled to end; null when none is. */
  sessionEndingAt: Timestamp.nullable(),
  /** Why the run is paused; null when it is not paused (or paused before this was recorded). */
  pauseReason: PauseReason.nullable(),
});
export type RunDto = z.infer<typeof RunDto>;

/** Another ticket of a run's merged group (spec 2026-11-21): the lead issue, or a PR led by that issue. */
export const LinkedTicketDto = z.object({
  ref: z.string(),
  kind: TicketKind,
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  labels: TicketDto.shape.labels,
  /** Runs this ticket has had in the project, all statuses. */
  ticketRunCount: z.number().int().min(1),
});
export type LinkedTicketDto = z.infer<typeof LinkedTicketDto>;

/** A run in a list: the detail shape without the prompt texts (up to ~4 KB each), which only run detail needs. */
export const RunListItem = RunDto.omit({ prompt: true, finalPrompt: true }).extend({
  /** Runs this ticket has had in the project, all statuses. */
  ticketRunCount: z.number().int().min(1),
  /** The other tickets of this run's merged group: the lead issue first, then PRs by number; [] when none. */
  linkedTickets: z.array(LinkedTicketDto),
});
export type RunListItem = z.infer<typeof RunListItem>;

const count = z.number().int().min(0);

export const RunStatsQuery = z.object({ since: Timestamp });
export type RunStatsQuery = z.infer<typeof RunStatsQuery>;

/** The Run list's numbers, served by the API so they do not depend on how many runs a page holds. */
export const RunStatsDto = z.object({
  counts: z.object({ needs_you: count, active: count, queued: count, ended: count, all: count, ignored: count }),
  today: z.object({ total: count, failed: count }),
  idleRun: RunListItem.nullable(),
  nextQueuedNumber: z.number().int().nullable(),
});
export type RunStatsDto = z.infer<typeof RunStatsDto>;

// Strict: the retired `cursor` and `limit` parameters are a 400, not silently ignored.
export const RunListQuery = PageQuery.extend({
  filter: RunListFilter.optional(),
  ticket: z.string().optional(),
}).strict();
export type RunListQuery = z.infer<typeof RunListQuery>;

export const RunListResponse = pageOf(RunListItem);
export type RunListResponse = z.infer<typeof RunListResponse>;

export const RunEventDto = z.object({
  seq: z.number().int(),
  ts: Timestamp,
  type: z.enum(['lifecycle', 'status', 'scrollback', 'comment']),
  payload: z.record(z.string(), z.unknown()),
});
export type RunEventDto = z.infer<typeof RunEventDto>;

export const RunLogResponse = z.object({ items: z.array(RunEventDto) });
export type RunLogResponse = z.infer<typeof RunLogResponse>;
