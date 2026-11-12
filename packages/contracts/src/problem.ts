import { z } from 'zod';

export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string().optional(),
  errors: z.array(z.object({ pointer: z.string(), detail: z.string() })).optional(),
});
export type ProblemSchema = z.infer<typeof ProblemSchema>;
