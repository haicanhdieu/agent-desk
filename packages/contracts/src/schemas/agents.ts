import { z } from 'zod';
import { CredentialType } from '../enums';
import { Id, Timestamp } from './common';

export const AgentDto = z.object({
  id: Id,
  projectId: Id,
  name: z.string(),
  provider: z.literal('claude'),
  model: z.string(),
  maxTurns: z.number().int().nullable(),
  timeoutSeconds: z.number().int(),
  credential: z.object({
    set: z.boolean(),
    type: CredentialType.nullable(),
    updatedAt: Timestamp.nullable(),
    setBy: z.string().nullable(),
  }),
});
export type AgentDto = z.infer<typeof AgentDto>;

/** Run time limit bounds, seconds (ADR 0021): at least a minute, at most 7 days; new agents get 24 h. */
export const AGENT_TIMEOUT_SECONDS_MIN = 60;
export const AGENT_TIMEOUT_SECONDS_MAX = 604800;
export const AGENT_TIMEOUT_SECONDS_DEFAULT = 86400;

export const PutAgentRequest = z.object({
  model: z.string().min(1),
  maxTurns: z.number().int().min(1).optional(),
  timeoutSeconds: z
    .number()
    .int()
    .min(AGENT_TIMEOUT_SECONDS_MIN, { message: 'The run time limit must be at least 1 minute' })
    .max(AGENT_TIMEOUT_SECONDS_MAX, { message: 'The run time limit can be at most 7 days' }),
});
export type PutAgentRequest = z.infer<typeof PutAgentRequest>;

export const PutCredentialRequest = z.object({ type: CredentialType, value: z.string().min(1) });
export type PutCredentialRequest = z.infer<typeof PutCredentialRequest>;

export const PutCredentialResponse = z.object({ updatedAt: Timestamp });
export type PutCredentialResponse = z.infer<typeof PutCredentialResponse>;
