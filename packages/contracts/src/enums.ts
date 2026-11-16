import { z } from 'zod';

export const RunStatus = z.enum([
  'queued',
  'starting',
  'running',
  'idle',
  'done',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'paused',
  'expired',
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const FINAL_RUN_STATUSES = [
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'expired',
] as const satisfies readonly RunStatus[];
export const ACTIVE_RUN_STATUSES = ['starting', 'running', 'idle', 'done'] as const satisfies readonly RunStatus[];
/** Statuses a person may Finish (needs you, the agent declared done, or paused). */
export const FINISHABLE_RUN_STATUSES = ['idle', 'done', 'paused'] as const satisfies readonly RunStatus[];

/** Why a run is paused: the idle timer stopped the pod, or the pod was lost. */
export const PauseReason = z.enum(['idle_timeout', 'pod_lost', 'agent_crashed']);
export type PauseReason = z.infer<typeof PauseReason>;

export const TriggerMode = z.enum(['webhook', 'polling']);
export type TriggerMode = z.infer<typeof TriggerMode>;

export const POLL_INTERVALS = [300, 600, 900, 1800] as const;
export const PollInterval = z.union([z.literal(300), z.literal(600), z.literal(900), z.literal(1800)]);
export type PollInterval = z.infer<typeof PollInterval>;

export const Provider = z.enum(['github', 'fake']);
export type Provider = z.infer<typeof Provider>;

export const TicketKind = z.enum(['issue', 'pr']);
export type TicketKind = z.infer<typeof TicketKind>;

export const RuleKind = z.enum(['skill', 'prompt']);
export type RuleKind = z.infer<typeof RuleKind>;

export const RuleTarget = z.enum(['issue', 'pr', 'any']);
export type RuleTarget = z.infer<typeof RuleTarget>;

export const TriggerSource = z.enum(['webhook', 'polling', 'manual']);
export type TriggerSource = z.infer<typeof TriggerSource>;

export const SetupStep = z.enum(['agent', 'setup', 'skills', 'rules', 'ready']);
export type SetupStep = z.infer<typeof SetupStep>;

export const RunListFilter = z.enum(['needs_you', 'active', 'queued', 'ended', 'all']);
export type RunListFilter = z.infer<typeof RunListFilter>;

export const CredentialType = z.enum(['oauth_token', 'api_key']);
export type CredentialType = z.infer<typeof CredentialType>;
