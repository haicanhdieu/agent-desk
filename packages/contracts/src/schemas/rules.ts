import { z } from 'zod';
import { RuleKind, RuleTarget } from '../enums';
import { Id, SlugName, Timestamp } from './common';

export const RULE_PROMPT_MAX = 4000;
export const RulePrompt = z.string().trim().min(1).max(RULE_PROMPT_MAX);

export const RuleDto = z.object({
  id: Id,
  projectId: Id,
  command: z.string(),
  labelFilter: z.array(z.string()),
  target: RuleTarget,
  agentId: Id,
  kind: RuleKind,
  skillName: z.string().nullable(),
  prompt: z.string().nullable(),
  enabled: z.boolean(),
  stats: z.object({ runs30d: z.number().int(), lastRunAt: Timestamp.nullable() }),
});
export type RuleDto = z.infer<typeof RuleDto>;

const ruleCommon = {
  command: SlugName,
  labelFilter: z.array(z.string()),
  target: RuleTarget,
  enabled: z.boolean(),
};

export const CreateSkillRuleRequest = z.object({
  ...ruleCommon,
  kind: z.literal('skill'),
  skillName: SlugName,
});
export type CreateSkillRuleRequest = z.infer<typeof CreateSkillRuleRequest>;

export const CreatePromptRuleRequest = z.object({
  ...ruleCommon,
  kind: z.literal('prompt'),
  prompt: RulePrompt,
});
export type CreatePromptRuleRequest = z.infer<typeof CreatePromptRuleRequest>;

export const CreateRuleRequest = z.discriminatedUnion('kind', [CreateSkillRuleRequest, CreatePromptRuleRequest]);
export type CreateRuleRequest = z.infer<typeof CreateRuleRequest>;

export const UpdateRuleRequest = z
  .object({
    command: ruleCommon.command.optional(),
    labelFilter: ruleCommon.labelFilter.optional(),
    target: ruleCommon.target.optional(),
    enabled: ruleCommon.enabled.optional(),
    kind: RuleKind.optional(),
    skillName: SlugName.optional(),
    prompt: RulePrompt.optional(),
  })
  .superRefine((v, ctx) => {
    const hasSkill = v.skillName !== undefined;
    const hasPrompt = v.prompt !== undefined;
    if (v.kind === 'skill') {
      if (!hasSkill)
        ctx.addIssue({ code: 'custom', path: ['skillName'], message: 'skillName is required for kind skill' });
      if (hasPrompt)
        ctx.addIssue({ code: 'custom', path: ['prompt'], message: 'prompt is not allowed for kind skill' });
    } else if (v.kind === 'prompt') {
      if (!hasPrompt) ctx.addIssue({ code: 'custom', path: ['prompt'], message: 'prompt is required for kind prompt' });
      if (hasSkill)
        ctx.addIssue({ code: 'custom', path: ['skillName'], message: 'skillName is not allowed for kind prompt' });
    } else if (hasSkill && hasPrompt) {
      ctx.addIssue({ code: 'custom', path: ['prompt'], message: 'send skillName or prompt, not both' });
    }
  });
export type UpdateRuleRequest = z.infer<typeof UpdateRuleRequest>;

export const PromptPreviewDto = z.object({ systemLines: z.array(z.string()) });
export type PromptPreviewDto = z.infer<typeof PromptPreviewDto>;
