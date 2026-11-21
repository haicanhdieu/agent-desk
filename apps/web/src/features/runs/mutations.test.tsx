import type { RunStatsDto } from '@agentdesk/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { api } from '../api';
import { useCancelRun, useCloseSession, useFinishRun, useResumeRun } from './mutations';
import { runsQueries } from './queries';

vi.mock('../api', () => ({
  api: {
    runs: {
      cancel: vi.fn(async () => undefined),
      finish: vi.fn(async () => undefined),
      resume: vi.fn(async () => undefined),
      closeSession: vi.fn(async () => undefined),
    },
  },
}));

const org = 'alice';
const projectId = ids.project.invoicerApi;
const SINCE = '2026-11-12T00:00:00.000Z';
const statsData: RunStatsDto = {
  counts: { needs_you: 1, active: 2, queued: 1, ended: 8, all: 12, ignored: 0 },
  today: { total: 3, failed: 0 },
  idleRun: null,
  nextQueuedNumber: 63,
};
const ref = { id: ids.run(1, 61), number: 61 };

function setup() {
  const qc = new QueryClient();
  const stats = runsQueries.stats(org, projectId, SINCE).queryKey;
  qc.setQueryData(stats, statsData);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, stats, wrapper };
}

describe('run mutations refresh the Run list numbers', () => {
  it('cancel invalidates the cached run stats', async () => {
    const { qc, stats, wrapper } = setup();
    const { result } = renderHook(() => useCancelRun(org, projectId), { wrapper });
    expect(qc.getQueryState(stats)?.isInvalidated).toBe(false);
    act(() => result.current(ref));
    await waitFor(() => expect(qc.getQueryState(stats)?.isInvalidated).toBe(true));
  });

  it('finish invalidates the cached run stats', async () => {
    const { qc, stats, wrapper } = setup();
    const { result } = renderHook(() => useFinishRun(org, projectId), { wrapper });
    act(() => result.current(ref));
    await waitFor(() => expect(qc.getQueryState(stats)?.isInvalidated).toBe(true));
  });

  it('resume invalidates the cached run stats', async () => {
    const { qc, stats, wrapper } = setup();
    const { result } = renderHook(() => useResumeRun(org, projectId), { wrapper });
    await act(() => result.current.mutateAsync(ref));
    await waitFor(() => expect(qc.getQueryState(stats)?.isInvalidated).toBe(true));
  });

  it('close session invalidates the cached run stats', async () => {
    const { qc, stats, wrapper } = setup();
    const { result } = renderHook(() => useCloseSession(org, projectId), { wrapper });
    await act(() => result.current.mutateAsync(ref));
    await waitFor(() => expect(qc.getQueryState(stats)?.isInvalidated).toBe(true));
  });

  it('close session reports a failed close to onError', async () => {
    const { wrapper } = setup();
    const boom = new Error('409');
    vi.mocked(api.runs.closeSession).mockRejectedValueOnce(boom);
    const onError = vi.fn();
    const { result } = renderHook(() => useCloseSession(org, projectId, { onError }), { wrapper });
    await act(() => result.current.mutateAsync(ref).catch(() => undefined));
    expect(onError).toHaveBeenCalledWith(boom);
  });
});
