import { ApiError } from '@agentdesk/contracts/client';
import { MutationCache, QueryCache, QueryClient, type DefaultOptions } from '@tanstack/react-query';
import { handleOrgSuspended, noteOrgAnswered } from '@/features/auth/orgSuspended';

export const MAX_RETRIES = 2;

/** Network failures (status 0) and 5xx are worth retrying; 4xx answers will not change. */
export function isRetryable(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status >= 500);
}

/**
 * Query defaults: data is fresh for 30 s; retry twice only for status 0 and 5xx; no refetch on window focus
 * (runs, connection and project detail queries turn it on in their own options; the detail carries the run counts). `overrides` is for tests (e.g. `retryDelay: 0`).
 */
export function createAppQueryClient(overrides: DefaultOptions['queries'] = {}): QueryClient {
  // One global handler: any query or mutation answered `org-suspended` drops the org's data and reloads the route.
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => handleOrgSuspended(client, error, query.queryKey),
      onSuccess: (_data, query) => noteOrgAnswered(query.queryKey),
    }),
    mutationCache: new MutationCache({ onError: (error) => handleOrgSuspended(client, error) }),
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
  return client;
}
