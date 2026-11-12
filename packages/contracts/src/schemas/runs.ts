import { z } from 'zod';
import { RunListFilter, RunStatus, TicketKind, TriggerSource } from '../enums';
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

export const RunDto = z.object({
  id: Id,
  number: z.number().int(),
  projectId: Id,
  ruleId: Id.nullable(),
  command: z.string(),
  skillName: z.string(),
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
  costUsd: z.number().nullable(),
  timeoutSeconds: z.number().int(),
  idleSince: Timestamp.nullable(),
});
export type RunDto = z.infer<typeof RunDto>;

export const RunListQuery = z.object({
  filter: RunListFilter.optional(),
  ticket: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type RunListQuery = z.infer<typeof RunListQuery>;

export const RunListResponse = z.object({
  items: z.array(RunDto),
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
