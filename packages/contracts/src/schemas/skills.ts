import { z } from 'zod';
import { SlugName, Timestamp } from './common';

export const SkillName = SlugName;
export type SkillName = z.infer<typeof SkillName>;

export const SkillSummaryDto = z.object({
  name: z.string(),
  description: z.string(),
  path: z.string(),
  lastCommit: z.object({ sha: z.string(), message: z.string(), at: Timestamp }).nullable(),
});
export type SkillSummaryDto = z.infer<typeof SkillSummaryDto>;

export const SkillDto = SkillSummaryDto.extend({ body: z.string(), sha: z.string() });
export type SkillDto = z.infer<typeof SkillDto>;

export const PutSkillRequest = z.object({
  body: z.string(),
  message: z.string().min(1),
  sha: z.string().optional(),
});
export type PutSkillRequest = z.infer<typeof PutSkillRequest>;

/**
 * Outcome of a skill create, edit or delete. Provider-neutral: a direct commit to the target branch, or a pending
 * change request for review (the skill on the target branch is unchanged until it is merged).
 */
export const SkillChangeResponse = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('commit'), commitSha: z.string(), targetBranch: z.string() }),
  z.object({
    kind: z.literal('change_request'),
    sourceBranch: z.string(),
    targetBranch: z.string(),
    url: z.string().url(),
    id: z.string(),
  }),
]);
export type SkillChangeResponse = z.infer<typeof SkillChangeResponse>;

export const PutSkillResponse = SkillChangeResponse;
export type PutSkillResponse = SkillChangeResponse;

export const DeleteSkillResponse = SkillChangeResponse;
export type DeleteSkillResponse = SkillChangeResponse;

export const DeleteSkillQuery = z.object({ message: z.string().optional() });
export type DeleteSkillQuery = z.infer<typeof DeleteSkillQuery>;
