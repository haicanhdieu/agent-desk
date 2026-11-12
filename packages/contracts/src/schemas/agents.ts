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

export const PutAgentRequest = z.object({
  model: z.string().min(1),
  maxTurns: z.number().int().min(1).optional(),
  timeoutSeconds: z.number().int().min(60).max(3300),
});
export type PutAgentRequest = z.infer<typeof PutAgentRequest>;

export const PutCredentialRequest = z.object({ type: CredentialType, value: z.string().min(1) });
export type PutCredentialRequest = z.infer<typeof PutCredentialRequest>;

export const PutCredentialResponse = z.object({ updatedAt: Timestamp });
export type PutCredentialResponse = z.infer<typeof PutCredentialResponse>;
