import { z } from 'zod';

export const PAGE_MAX = 2147483647;
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;

/** Coerced from the query string. Route queries extend it (`PageQuery.extend({ filter, ticket })`). */
export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).max(PAGE_MAX).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});
export type PageQuery = z.infer<typeof PageQuery>;

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Envelope schema: items array of `item`, page int ≥ 1, pageSize int ≥ 1, total int ≥ 0. */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
  });
}

export function pageWindow(q: PageQuery): { limit: number; offset: number } {
  return { limit: q.pageSize, offset: (q.page - 1) * q.pageSize };
}

export function toPage<T>(items: T[], total: number, q: PageQuery): Page<T> {
  return { items, page: q.page, pageSize: q.pageSize, total };
}

/** Pages an in-memory list (already in its fixed order). */
export function slicePage<T>(all: readonly T[], q: PageQuery): Page<T> {
  const { limit, offset } = pageWindow(q);
  return toPage(all.slice(offset, offset + limit), all.length, q);
}

/** First/last row numbers (1-based) and page count; first = last = 0 when total is 0 or page > pageCount. */
export function pageRange(
  page: number,
  pageSize: number,
  total: number,
): { first: number; last: number; pageCount: number } {
  const pageCount = Math.ceil(total / pageSize);
  if (total === 0 || page > pageCount) return { first: 0, last: 0, pageCount };
  const first = (page - 1) * pageSize + 1;
  return { first, last: Math.min(page * pageSize, total), pageCount };
}
