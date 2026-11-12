import { z } from 'zod';
import { RuleTarget } from '../enums';
import { Id, SlugName, Timestamp } from './common';

export const RuleDto = z.object({
  id: Id,
  projectId: Id,
  command: z.string(),
  labelFilter: z.array(z.string()),
  target: RuleTarget,
  agentId: Id,
  skillName: z.string(),
  enabled: z.boolean(),
  stats: z.object({ runs30d: z.number().int(), lastRunAt: Timestamp.nullable() }),
});
export type RuleDto = z.infer<typeof RuleDto>;

export const CreateRuleRequest = z.object({
  command: SlugName,
  labelFilter: z.array(z.string()),
  target: RuleTarget,
  skillName: SlugName,
  enabled: z.boolean(),
});
export type CreateRuleRequest = z.infer<typeof CreateRuleRequest>;

export const UpdateRuleRequest = CreateRuleRequest.partial();
export type UpdateRuleRequest = z.infer<typeof UpdateRuleRequest>;
