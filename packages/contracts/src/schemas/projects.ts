import { z } from 'zod';
import { PollInterval, SetupStep, TicketKind, TriggerMode } from '../enums';
import { Id, Timestamp } from './common';

export const ProjectDto = z.object({
  id: Id,
  name: z.string(),
  repoPath: z.string(),
  codeConnectionId: Id,
  boardConnectionId: Id,
  triggerMode: TriggerMode,
  pollIntervalSeconds: PollInterval,
  maxConcurrentRuns: z.number().int(),
  maxRunsPerTicket: z.number().int(),
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
