import { z } from 'zod';
import { PollInterval, SetupStep, TicketKind, TriggerMode } from '../enums';
import {
  AGENT_AUTO_RESUME_MAX_MAX,
  AGENT_AUTO_RESUME_MAX_MIN,
  AGENT_DONE_KEEP_SECONDS_MAX,
  AGENT_DONE_KEEP_SECONDS_MIN,
  AGENT_IDLE_END_SECONDS_MAX,
  AGENT_IDLE_END_SECONDS_MIN,
  AGENT_PAUSED_KEEP_SECONDS_MAX,
  AGENT_PAUSED_KEEP_SECONDS_MIN,
  AGENT_TIMEOUT_SECONDS_MAX,
  AGENT_TIMEOUT_SECONDS_MIN,
} from './agents';
import { Id, Timestamp } from './common';

export const ProjectDto = z.object({
  id: Id,
  name: z.string(),
  repoPath: z.string(),
  /** The repo's default branch as recorded when the project was created; null for projects that predate it. */
  defaultBranch: z.string().nullable(),
  codeConnectionId: Id,
  boardConnectionId: Id,
  triggerMode: TriggerMode,
  pollIntervalSeconds: PollInterval,
  maxConcurrentRuns: z.number().int(),
  maxRunsPerTicket: z.number().int(),
  timeoutSeconds: z.number().int(),
  pausedKeepSeconds: z.number().int(),
  doneKeepSeconds: z.number().int(),
  idleEndSeconds: z.number().int(),
  autoResumeMax: z.number().int(),
  setupStep: SetupStep,
  createdAt: Timestamp,
  counts: z.object({ needsYou: z.number().int(), running: z.number().int(), queued: z.number().int() }),
  lastRunAt: Timestamp.nullable(),
});
export type ProjectDto = z.infer<typeof ProjectDto>;

export const CreateProjectRequest = z.object({
  name: z.string().min(1).optional(),
  connectionId: Id,
  repoPath: z.string().min(1),
  triggerMode: TriggerMode,
  pollIntervalSeconds: PollInterval.optional(),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequest>;

export const UpdateProjectRequest = z.object({
  name: z.string().min(1).optional(),
  triggerMode: TriggerMode.optional(),
  pollIntervalSeconds: PollInterval.optional(),
  maxConcurrentRuns: z.number().int().min(1).max(10).optional(),
  maxRunsPerTicket: z.number().int().min(1).max(50).optional(),
  timeoutSeconds: z
    .number()
    .int()
    .min(AGENT_TIMEOUT_SECONDS_MIN, { message: 'The run time limit must be at least 1 minute' })
    .max(AGENT_TIMEOUT_SECONDS_MAX, { message: 'The run time limit can be at most 7 days' })
    .optional(),
  pausedKeepSeconds: z
    .number()
    .int()
    .min(AGENT_PAUSED_KEEP_SECONDS_MIN, { message: 'A paused run must be kept between 1 hour and 30 days' })
    .max(AGENT_PAUSED_KEEP_SECONDS_MAX, { message: 'A paused run must be kept between 1 hour and 30 days' })
    .optional(),
  doneKeepSeconds: z
    .number()
    .int()
    .min(AGENT_DONE_KEEP_SECONDS_MIN, { message: "A finished run's session can be kept for at most 7 days" })
    .max(AGENT_DONE_KEEP_SECONDS_MAX, { message: "A finished run's session can be kept for at most 7 days" })
    .optional(),
  idleEndSeconds: z
    .number()
    .int()
    .min(AGENT_IDLE_END_SECONDS_MIN, { message: 'Idle runs must end after between 5 minutes and 7 days' })
    .max(AGENT_IDLE_END_SECONDS_MAX, { message: 'Idle runs must end after between 5 minutes and 7 days' })
    .optional(),
  autoResumeMax: z
    .number()
    .int()
    .min(AGENT_AUTO_RESUME_MAX_MIN, { message: 'Automatic resumes must be between 0 and 10' })
    .max(AGENT_AUTO_RESUME_MAX_MAX, { message: 'Automatic resumes must be between 0 and 10' })
    .optional(),
  setupStep: SetupStep.optional(),
});
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequest>;

export const ProjectConnectionDto = z.object({
  mode: TriggerMode,
  webhook: z.object({ lastEventAt: Timestamp.nullable(), lastEventAction: z.string().nullable() }).nullable(),
  polling: z
    .object({
      intervalSeconds: PollInterval,
      lastCheckedAt: Timestamp.nullable(),
      lastError: z.string().nullable(),
      pausedReason: z.string().nullable(),
      nextPollAt: Timestamp.nullable(),
    })
    .nullable(),
});
export type ProjectConnectionDto = z.infer<typeof ProjectConnectionDto>;

export const IgnoredEventDto = z.object({
  id: Id,
  receivedAt: Timestamp,
  ticketRef: z.string().nullable(),
  ticketKind: TicketKind.nullable(),
  command: z.string().nullable(),
  author: z.string().nullable(),
  outcome: z.string(),
  detail: z.string().nullable(),
});
export type IgnoredEventDto = z.infer<typeof IgnoredEventDto>;
