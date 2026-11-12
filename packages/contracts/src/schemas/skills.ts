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

export const PutSkillResponse = z.object({ commitSha: z.string() });
export type PutSkillResponse = z.infer<typeof PutSkillResponse>;

export const DeleteSkillQuery = z.object({ message: z.string().optional() });
export type DeleteSkillQuery = z.infer<typeof DeleteSkillQuery>;
