import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { usePromptPreview } from './promptPreview';

const projectId = ids.project.invoicerApi;

function render(enabled = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => usePromptPreview('alice', projectId, enabled), { wrapper });
}

describe('usePromptPreview', () => {
  it('maps loading, error with retry, and ready', async () => {
    scenarios.serverError('rules.promptPreview');
    const failing = render();
    expect(failing.result.current).toEqual({ state: 'loading' });
    await waitFor(() => expect(failing.result.current.state).toBe('error'));

    server.resetHandlers();
    const current = failing.result.current;
    if (current.state !== 'error' || !current.onRetry) throw new Error('expected an error with a retry');
    act(() => current.onRetry?.());
    await waitFor(() => expect(failing.result.current.state).toBe('ready'));
    const ready = failing.result.current;
    if (ready.state !== 'ready') throw new Error('expected ready');
    expect(ready.systemLines).toHaveLength(5);
    expect(ready.systemLines[0]).toContain('harbor-labs/invoicer-api');
  });

  it('stays loading and sends no request while disabled', () => {
    expect(render(false).result.current).toEqual({ state: 'loading' });
  });
});
