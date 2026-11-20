import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider, queryOptions } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGE_SIZE_MAX, type Page } from '@agentdesk/contracts';
import {
  PAGE_SIZE_STORAGE_KEY,
  PageSearch,
  WHOLE_SET,
  loadPage,
  pageOfSearch,
  pageToSearch,
  readPageSize,
  useClampToLastPage,
  usePageSize,
  usePagedQuery,
  usePaginationProps,
} from './pagination';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('page search param', () => {
  it('keeps a valid page as text', () => {
    expect(PageSearch.parse({ page: '3' })).toEqual({ page: '3' });
  });

  it.each(['0', '-2', '1.5', 'abc', '99999999999'])('maps page=%s to page 1 (undefined)', (page) => {
    expect(PageSearch.parse({ page })).toEqual({ page: undefined });
  });

  it('reads and writes the page, leaving page 1 out', () => {
    expect(pageOfSearch({})).toBe(1);
    expect(pageOfSearch({ page: '7' })).toBe(7);
    expect(pageToSearch(1)).toBeUndefined();
    expect(pageToSearch(4)).toBe('4');
  });

  it('WHOLE_SET is page 1 at the contract maximum', () => {
    expect(WHOLE_SET).toEqual({ page: 1, pageSize: PAGE_SIZE_MAX });
  });
});

describe('readPageSize', () => {
  it('is 20 when nothing is saved', () => {
    expect(readPageSize()).toBe(20);
  });

  it.each(['33', 'abc', '0'])('is 20 when the saved value is %s', (saved) => {
    localStorage.setItem(PAGE_SIZE_STORAGE_KEY, saved);
    expect(readPageSize()).toBe(20);
  });

  it('is the saved size', () => {
    localStorage.setItem(PAGE_SIZE_STORAGE_KEY, '100');
    expect(readPageSize()).toBe(100);
  });
});

describe('usePageSize', () => {
  it('saves the chosen size under agentdesk.pageSize', () => {
    const { result } = renderHook(() => usePageSize());
    expect(result.current[0]).toBe(20);
    act(() => result.current[1](50));
    expect(localStorage.getItem('agentdesk.pageSize')).toBe('50');
    expect(result.current[0]).toBe(50);
  });

  it('keeps the size for this visit when storage is blocked, and forgets it on a new visit', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.resetModules();
    const visit = await import('./pagination');
    const { result } = renderHook(() => visit.usePageSize());
    act(() => result.current[1](50));
    expect(visit.readPageSize()).toBe(50);
    expect(result.current[0]).toBe(50);

    vi.resetModules();
    const next = await import('./pagination');
    expect(next.readPageSize()).toBe(20);
  });
});

describe('useClampToLastPage', () => {
  it('moves to the last page once when the page is past it', () => {
    const go = vi.fn();
    const { rerender } = renderHook(() => useClampToLastPage(5, 20, 63, go));
    rerender();
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(4);
  });

  it.each([
    [4, 20, 63],
    [3, 20, 0],
    [1, 20, 0],
  ])('does nothing for page %i, size %i, total %i', (page, size, total) => {
    const go = vi.fn();
    renderHook(() => useClampToLastPage(page, size, total, go));
    expect(go).not.toHaveBeenCalled();
  });
});

describe('usePaginationProps', () => {
  it('saves a new size and returns to page 1', () => {
    const go = vi.fn();
    const { result } = renderHook(() => usePaginationProps({ page: 3, total: 90, busy: false, go }));
    expect(result.current).toMatchObject({ page: 3, pageSize: 20, total: 90, busy: false });
    act(() => result.current.onPageSizeChange(50));
    expect(localStorage.getItem(PAGE_SIZE_STORAGE_KEY)).toBe('50');
    expect(go).toHaveBeenCalledWith(1);
  });

  it('reports the size of the page on screen, not the saved one, when given', () => {
    localStorage.setItem(PAGE_SIZE_STORAGE_KEY, '50');
    const { result } = renderHook(() =>
      usePaginationProps({ page: 1, pageSize: 20, total: 90, busy: true, go: vi.fn() }),
    );
    expect(result.current.pageSize).toBe(20);
  });

  it('goes to the chosen page', () => {
    const go = vi.fn();
    const { result } = renderHook(() => usePaginationProps({ page: 1, total: 90, busy: false, go }));
    act(() => result.current.onPageChange(3));
    expect(go).toHaveBeenCalledWith(3);
  });
});

function pageData(page: number): Page<string> {
  return { items: [`row-${page}`], page, pageSize: 20, total: 40 };
}

describe('usePagedQuery', () => {
  it('keeps the shown page, busy, while the next page loads', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    await queryClient.prefetchQuery({ queryKey: ['t', 1], queryFn: () => pageData(1) });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const build = (p: { page: number }) =>
      queryOptions({
        queryKey: ['t', p.page],
        queryFn: async () => {
          if (p.page === 2) await held;
          return pageData(p.page);
        },
      });
    const { result, rerender } = renderHook(({ page }) => usePagedQuery({ page }, build), {
      wrapper,
      initialProps: { page: 1 },
    });
    expect(result.current.data.items).toEqual(['row-1']);
    expect(result.current.busy).toBe(false);

    rerender({ page: 2 });
    await waitFor(() => expect(result.current.busy).toBe(true));
    expect(result.current.data.items).toEqual(['row-1']);

    await act(async () => {
      release();
      await held;
    });
    await waitFor(() => expect(result.current.data.items).toEqual(['row-2']));
    expect(result.current.busy).toBe(false);
  });
});

describe('loadPage', () => {
  const options = (fn: () => Page<string>) => ({ queryKey: ['lp'], queryFn: fn });

  it('awaits the page when entering the route', async () => {
    const queryClient = new QueryClient();
    await loadPage(
      queryClient,
      options(() => pageData(1)),
      'enter',
    );
    expect(queryClient.getQueryData(['lp'])).toEqual(pageData(1));
  });

  it('only prefetches between pages: does not wait for the fetch', async () => {
    const queryClient = new QueryClient();
    const never = { queryKey: ['lp'], queryFn: () => new Promise<Page<string>>(() => undefined) };
    await expect(loadPage(queryClient, never, 'stay')).resolves.toBeUndefined();
    expect(queryClient.isFetching({ queryKey: ['lp'] })).toBe(1);
  });
});
