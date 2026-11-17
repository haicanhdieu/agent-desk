import { z } from 'zod';
import { PauseReason, RunStatus } from '../enums';
import { AgentNote, WaitingOn } from './agent-state';
import { Id, Timestamp } from './common';
import { RunEventDto } from './runs';

/** SSE `event: status` on GET /api/runs/:id/events */
export const RunStatusEvent = z.object({
  runId: Id,
  number: z.number().int(),
  status: RunStatus,
  seq: z.number().int(),
  exitCode: z.number().int().nullable(),
  failureReason: z.string().nullable(),
  waitingOn: WaitingOn.nullable(),
  agentNote: AgentNote.nullable(),
  pausedAt: Timestamp.nullable(),
  sessionExpiresAt: Timestamp.nullable(),
  sessionEndingAt: Timestamp.nullable(),
  pauseReason: PauseReason.nullable(),
});
export type RunStatusEvent = z.infer<typeof RunStatusEvent>;

/** SSE `event: event` on GET /api/runs/:id/events */
export const RunEventMessage = RunEventDto;
export type RunEventMessage = z.infer<typeof RunEventMessage>;

/** SSE `event: run` on GET /api/projects/:id/events */
export const ProjectRunEvent = z.object({
  runId: Id,
  number: z.number().int(),
  status: RunStatus,
  seq: z.number().int(),
});
export type ProjectRunEvent = z.infer<typeof ProjectRunEvent>;
