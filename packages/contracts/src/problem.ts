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

/** Problem `type` of the 409 answered when the user's token at the provider is rejected or cannot be refreshed: the user must connect that account again. */
export const PROVIDER_REAUTH_REQUIRED_PROBLEM_TYPE = 'provider-reauthorization-required';
/** Problem `type` of the 503 (or 429 when rate limited) answered when the provider could not be reached or is limiting requests: retry later. */
export const PROVIDER_UNAVAILABLE_PROBLEM_TYPE = 'provider-unavailable';
