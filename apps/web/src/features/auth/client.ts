import { ApiError } from '@agentdesk/contracts/client';
import { organizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import { z } from 'zod';

/**
 * better-auth client for the API's `/auth` routes (same origin) with the organization plugin. Only its plain
 * actions are used (getSession, organization.list / setActive, signIn.social, signOut); its nanostores hooks stay
 * unmounted, so it never fetches on its own (e.g. `get-full-organization`).
 */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: '/auth',
  plugins: [organizationClient()],
  // better-auth captures `fetch` when the client is created; resolve it per call instead so a fetch patched later
  // (MSW in tests) is the one used.
  fetchOptions: { customFetchImpl: (input, init) => globalThis.fetch(input, init) },
});

// better-fetch error object: `{ status, statusText, message?, code? }` (the better-auth APIError JSON spread in).
const AuthFetchError = z.object({
  status: z.number(),
  statusText: z.string().optional(),
  message: z.string().optional(),
  code: z.string().optional(),
});

/**
 * Runs a better-auth action and returns its `data` (still `unknown`: callers parse it). Failures become `ApiError`
 * (status 0 for network errors) so the Query retry policy and route boundaries treat them like API errors.
 */
export async function authCall(action: () => Promise<{ data: unknown; error: unknown }>): Promise<unknown> {
  let result: { data: unknown; error: unknown };
  try {
    result = await action();
  } catch (cause) {
    throw new ApiError({
      status: 0,
      type: 'network',
      title: 'Network error',
      detail: cause instanceof Error ? cause.message : 'Request failed',
    });
  }
  if (result.error === null || result.error === undefined) return result.data;
  const parsed = AuthFetchError.safeParse(result.error);
  if (!parsed.success) throw new ApiError({ status: 0, type: 'network', title: 'Network error' });
  const { status, statusText, message, code } = parsed.data;
  throw new ApiError({ status, type: code ?? 'about:blank', title: message || statusText || `HTTP ${status}` });
}
