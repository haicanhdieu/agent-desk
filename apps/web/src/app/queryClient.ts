import { ApiError } from '@agentdesk/contracts/client';
import { QueryClient, type DefaultOptions } from '@tanstack/react-query';

const MAX_RETRIES = 2;

/** Network failures (status 0) and 5xx are worth retrying; 4xx answers will not change. */
export function isRetryable(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status >= 500);
}

/**
 * Query defaults: data is fresh for 30 s; retry twice only for status 0 and 5xx; no refetch on window focus
 * (runs and connection queries turn it on in their own options). `overrides` is for tests (e.g. `retryDelay: 0`).
 */
export function createAppQueryClient(overrides: DefaultOptions['queries'] = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => failureCount < MAX_RETRIES && isRetryable(error),
        refetchOnWindowFocus: false,
        ...overrides,
      },
      mutations: { retry: false },
    },
  });
}
