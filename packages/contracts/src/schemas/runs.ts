import { z } from 'zod';
import { PauseReason, RuleKind, RunListFilter, RunStatus, TicketKind, TriggerSource } from '../enums';
import { AgentNote, WaitingOn } from './agent-state';
import { Id, Timestamp } from './common';

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

/** A run in a list: the detail shape without the prompt texts (up to ~4 KB each), which only run detail needs. */
export const RunListItem = RunDto.omit({ prompt: true, finalPrompt: true });
export type RunListItem = z.infer<typeof RunListItem>;

export const RunListQuery = z.object({
  filter: RunListFilter.optional(),
  ticket: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type RunListQuery = z.infer<typeof RunListQuery>;

export const RunListResponse = z.object({
  items: z.array(RunListItem),
  nextCursor: z.string().nullable(),
});
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
