import { useDeferredValue, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  useSuspenseQuery,
  type FetchQueryOptions,
  type QueryClient,
  type QueryKey,
  type UseSuspenseQueryOptions,
} from '@tanstack/react-query';
import { z } from 'zod';
import { PAGE_MAX, PAGE_SIZE_MAX, type Page, type PageQuery } from '@agentdesk/contracts';
import { PAGE_SIZE_OPTIONS, type PageSizeOption, type PaginationProps } from '@/components';

export const PAGE_SIZE_STORAGE_KEY = 'agentdesk.pageSize';

/** Page 1 at the contract maximum: the readers that need the whole set. */
export const WHOLE_SET: PageQuery = { page: 1, pageSize: PAGE_SIZE_MAX };

/** Route search piece: `page` as text; anything but an integer 1..PAGE_MAX becomes undefined (page 1). */
export const PageSearch = z.object({
  page: z
    .string()
    .refine((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= PAGE_MAX)
    .optional()
    .catch(undefined),
});

export function pageOfSearch(search: { page?: string | undefined }): number {
  return search.page === undefined ? 1 : Number(search.page);
}

export function pageToSearch(page: number): string | undefined {
  return page <= 1 ? undefined : String(page);
}

/** The size picked this visit when storage could not keep it. */
let visitSize: PageSizeOption | undefined;

/** Saved size, else the size chosen earlier this visit (storage blocked), else 20. */
export function readPageSize(): PageSizeOption {
  try {
    const saved = PAGE_SIZE_OPTIONS.find((o) => String(o) === localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
    if (saved) return saved;
  } catch {
    // Storage blocked: fall back to this visit's choice.
  }
  return visitSize ?? PAGE_SIZE_OPTIONS[0];
}

const sizeListeners = new Set<() => void>();
const subscribeToSize = (listener: () => void) => {
  sizeListeners.add(listener);
  return () => void sizeListeners.delete(listener);
};

function savePageSize(size: PageSizeOption): void {
  try {
    localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(size));
    visitSize = undefined;
  } catch {
    visitSize = size;
  }
  sizeListeners.forEach((listener) => listener());
}

/** The page size every list uses; every user of the hook sees a change at once. */
export function usePageSize(): [PageSizeOption, (size: PageSizeOption) => void] {
  return [useSyncExternalStore(subscribeToSize, readPageSize), savePageSize];
}

/** Loader helper: awaits the page on entry (route skeleton / route error); between pages only prefetches. */
export async function loadPage<T, K extends QueryKey>(
  queryClient: QueryClient,
  options: FetchQueryOptions<T, Error, T, K>,
  cause: 'enter' | 'stay' | 'preload',
): Promise<void> {
  if (cause === 'stay') {
    void queryClient.prefetchQuery(options);
    return;
  }
  await queryClient.ensureQueryData(options);
}

/** Shows the page for `params`; while the next params load, keeps the shown page and returns busy: true. Suspends only when nothing is cached. */
export function usePagedQuery<P extends Record<string, unknown>, T, K extends QueryKey>(
  params: P,
  build: (p: P) => UseSuspenseQueryOptions<Page<T>, Error, Page<T>, K>,
): { data: Page<T>; busy: boolean } {
  // useDeferredValue compares by identity: keep one object per set of values.
  const signature = JSON.stringify(params);
  const [held, setHeld] = useState({ signature, params });
  if (held.signature !== signature) setHeld({ signature, params });
  const stable = held.signature === signature ? held.params : params;
  const deferred = useDeferredValue(stable);
  const { data } = useSuspenseQuery(build(deferred));
  return { data, busy: deferred !== stable };
}

/** When page > ceil(total / pageSize) and total > 0, calls go(lastPage) once (the route replaces the URL). */
export function useClampToLastPage(page: number, pageSize: number, total: number, go: (page: number) => void): void {
  const lastPage = Math.ceil(total / pageSize);
  const sent = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (total > 0 && page > lastPage) {
      if (sent.current === lastPage) return;
      sent.current = lastPage;
      go(lastPage);
    } else {
      sent.current = undefined;
    }
  }, [page, lastPage, total, go]);
}

/** PaginationProps for a route: page changes and size changes (size → page 1) go through `go`. */
export function usePaginationProps(args: {
  page: number;
  total: number;
  busy: boolean;
  go(page: number): void;
}): PaginationProps {
  const [pageSize, setPageSize] = usePageSize();
  const { page, total, busy, go } = args;
  return {
    page,
    pageSize,
    total,
    busy,
    onPageChange: go,
    onPageSizeChange: (size) => {
      setPageSize(size);
      go(1);
    },
  };
}
