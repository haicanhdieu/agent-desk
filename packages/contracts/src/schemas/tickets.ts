import { z } from 'zod';
import { PrState } from '../enums';

export const PR_STATES_MAX_REFS = 100;

/** A provider-local ticket number as a ref (shape of normalizeLinkedRefs). */
export const TicketNumberRef = z.string().regex(/^[1-9]\d{0,9}$/);

/** One `ref` key gives a string, several an array; 1..100 refs as sent, then deduplicated (first-seen order). */
export const PrStatesQuery = z.object({
  ref: z.preprocess(
    (v) => (typeof v === 'string' ? [v] : v),
    z
      .array(TicketNumberRef)
      .min(1)
      .max(PR_STATES_MAX_REFS)
      .transform((refs) => [...new Set(refs)]),
  ),
});
export type PrStatesQuery = z.infer<typeof PrStatesQuery>;

export const PrStatesResponse = z.object({
  items: z.array(z.object({ ref: z.string(), prState: PrState })),
});
export type PrStatesResponse = z.infer<typeof PrStatesResponse>;
