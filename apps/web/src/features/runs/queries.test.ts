import { PR_STATES_MAX_REFS } from '@agentdesk/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppQueryClient } from '@/app/queryClient';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { prStateChunks, usePrStates } from './queries';

const org = 'alice';
const projectId = ids.project.invoicerApi;

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: createAppQueryClient({ retry: false }) }, children);

/** The `ref` values of every pr-states request sent while the test runs. */
function recordRequests(): { sent: string[][]; stop(): void } {
  const sent: string[][] = [];
  const listener = ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/tickets/pr-states')) sent.push(url.searchParams.getAll('ref'));
  };
  server.events.on('request:start', listener);
  return { sent, stop: () => server.events.removeListener('request:start', listener) };
}

let stop = () => {};
afterEach(() => {
  stop();
  stop = () => {};
});

const numbers = (n: number, from = 1) => Array.from({ length: n }, (_, i) => String(from + i));

describe('prStateChunks', () => {
  it('sorts by number, drops duplicates and splits at 100', () => {
    expect(PR_STATES_MAX_REFS).toBe(100);
    expect(prStateChunks(['10', '9', '148', '9'])).toEqual([['9', '10', '148']]);
    expect(prStateChunks(numbers(101)).map((c) => c.length)).toEqual([100, 1]);
    expect(prStateChunks(numbers(250)).map((c) => c.length)).toEqual([100, 100, 50]);
    expect(prStateChunks([])).toEqual([]);
  });
});

describe('usePrStates', () => {
  it('101 refs send two requests, of 100 and 1, and the result holds both', async () => {
    const rec = recordRequests();
    stop = rec.stop;
    // 148 sorts last of 101 refs (1..100 and 148); 1 is not a known ref, so both groups answer from the fixtures.
    const refs = [...numbers(99, 1), '133', '148'];
    const { result } = renderHook(() => usePrStates(org, projectId, refs), { wrapper });
    await waitFor(() => expect(result.current.get('148')).toBe('merged'));
    expect(result.current.get('133')).toBe('open');
    expect(rec.sent.map((s) => s.length).sort((a, b) => b - a)).toEqual([100, 1]);
  });

  it('no refs send no request', async () => {
    const rec = recordRequests();
    stop = rec.stop;
    const { result } = renderHook(() => usePrStates(org, projectId, []), { wrapper });
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.size).toBe(0);
    expect(rec.sent).toEqual([]);
    expect(mockDb.requests('GET', `/api/projects/${projectId}/tickets/pr-states`)).toBe(0);
  });

  it('the error scenario gives an empty map and does not throw', async () => {
    scenarios.prStates('error');
    const { result } = renderHook(() => usePrStates(org, projectId, ['148']), { wrapper });
    await waitFor(() => expect(mockDb.requests('GET', `/api/projects/${projectId}/tickets/pr-states`)).toBe(1));
    expect(result.current.size).toBe(0);
  });
});
