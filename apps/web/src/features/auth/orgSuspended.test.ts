import { ORG_SUSPENDED_PROBLEM_TYPE } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import type { AnyRouter } from '@tanstack/react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleOrgSuspended, isOrgSuspendedError, noteOrgAnswered, registerOrgSuspendedRouter } from './orgSuspended';

const problem = (status: number, type: string) => new ApiError({ status, type, title: 'x' });
const suspended = () => problem(403, ORG_SUSPENDED_PROBLEM_TYPE);

/** A router stand-in: only `latestLocation` and `invalidate` are read by the handler. */
function fakeRouter(pathname: string) {
  const invalidate = vi.fn(() => Promise.resolve());
  const router = { latestLocation: { pathname }, invalidate } as unknown as AnyRouter;
  return { router, invalidate };
}

/** The app's wiring (see queryClient.ts) with a real cache, so the handler receives what production gives it. */
function client() {
  const c: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => handleOrgSuspended(c, error, query.queryKey),
      onSuccess: (_d, query) => noteOrgAnswered(query.queryKey),
    }),
    mutationCache: new MutationCache({ onError: (error) => handleOrgSuspended(c, error) }),
    defaultOptions: { queries: { retry: false } },
  });
  return c;
}

const fail = (c: QueryClient, key: unknown[]) =>
  c.fetchQuery({ queryKey: key, queryFn: () => Promise.reject(suspended()) }).catch(() => undefined);
const succeed = (c: QueryClient, key: unknown[]) => c.fetchQuery({ queryKey: key, queryFn: () => 'ok' });

describe('isOrgSuspendedError', () => {
  it.each([
    ['the bare type', problem(403, ORG_SUSPENDED_PROBLEM_TYPE), true],
    ['the URN type', problem(403, `urn:agentdesk:problem:${ORG_SUSPENDED_PROBLEM_TYPE}`), true],
    ['another 403 type', problem(403, 'forbidden'), false],
    ['org-suspended with another status', problem(409, ORG_SUSPENDED_PROBLEM_TYPE), false],
    ['a plain error', new Error('org-suspended'), false],
  ])('%s', (_n, error, expected) => {
    expect(isOrgSuspendedError(error)).toBe(expected);
  });
});

describe('handleOrgSuspended', () => {
  let c: QueryClient;
  beforeEach(() => {
    c = client();
  });

  it('reloads the router once for a burst of refusals and ignores a repeat for the same org', async () => {
    const { router, invalidate } = fakeRouter('/o/alice/projects');
    registerOrgSuspendedRouter(router);
    await Promise.all([fail(c, ['org', 'alice', 'a']), fail(c, ['org', 'alice', 'b']), fail(c, ['org', 'alice', 'c'])]);
    await fail(c, ['org', 'alice', 'd']);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('drops the org cache and keeps other orgs', async () => {
    const { router } = fakeRouter('/o/alice/projects');
    registerOrgSuspendedRouter(router);
    await succeed(c, ['org', 'alice', 'x']);
    await succeed(c, ['org', 'acme', 'x']);
    await fail(c, ['org', 'alice', 'y']);
    expect(c.getQueryData(['org', 'alice', 'x'])).toBeUndefined();
    expect(c.getQueryData(['org', 'acme', 'x'])).toBe('ok');
  });

  it('re-arms after a query of that org answers', async () => {
    const { router, invalidate } = fakeRouter('/o/alice/projects');
    registerOrgSuspendedRouter(router);
    await fail(c, ['org', 'alice', 'a']);
    await succeed(c, ['org', 'alice', 'b']);
    await fail(c, ['org', 'alice', 'c']);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('is not re-armed by an answer from another org', async () => {
    const { router, invalidate } = fakeRouter('/o/alice/projects');
    registerOrgSuspendedRouter(router);
    await fail(c, ['org', 'alice', 'a']);
    await succeed(c, ['org', 'acme', 'b']);
    await fail(c, ['org', 'alice', 'c']);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('handles a refused mutation from the org on screen', async () => {
    const { router, invalidate } = fakeRouter('/o/alice/projects');
    registerOrgSuspendedRouter(router);
    await succeed(c, ['org', 'alice', 'x']);
    await c
      .getMutationCache()
      .build(c, { mutationFn: () => Promise.reject(suspended()) })
      .execute(undefined)
      .catch(() => undefined);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(c.getQueryData(['org', 'alice', 'x'])).toBeUndefined();
  });

  it('ignores other errors', async () => {
    const { router, invalidate } = fakeRouter('/o/alice/projects');
    registerOrgSuspendedRouter(router);
    await c
      .fetchQuery({ queryKey: ['org', 'alice', 'a'], queryFn: () => Promise.reject(problem(403, 'forbidden')) })
      .catch(() => undefined);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('a refusal for an org that is not on screen neither reloads nor touches the org on screen', async () => {
    const { router, invalidate } = fakeRouter('/o/acme/projects');
    registerOrgSuspendedRouter(router);
    await succeed(c, ['org', 'acme', 'x']);
    await succeed(c, ['org', 'alice', 'x']);
    await fail(c, ['org', 'alice', 'late']);
    expect(invalidate).not.toHaveBeenCalled();
    expect(c.getQueryData(['org', 'acme', 'x'])).toBe('ok');
    expect(c.getQueryData(['org', 'alice', 'x'])).toBeUndefined();
    // A real later suspension of the org on screen is still news.
    await fail(c, ['org', 'acme', 'y']);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('off any org page, a refusal is remembered under no org and re-armed by any org answer', async () => {
    registerOrgSuspendedRouter(fakeRouter('/o/alice/projects').router);
    const { router, invalidate } = fakeRouter('/settings');
    registerOrgSuspendedRouter(router);
    await fail(c, ['org']);
    await fail(c, ['org']);
    expect(invalidate).toHaveBeenCalledTimes(1);
    await succeed(c, ['org', 'alice', 'x']);
    await fail(c, ['org']);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
});
