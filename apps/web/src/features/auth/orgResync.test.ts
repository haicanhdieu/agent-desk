import { ORG_HEADER, ORG_MISMATCH_PROBLEM_TYPE } from '@agentdesk/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { QueryClient } from '@tanstack/react-query';
import type { AnyRouter } from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/features/api';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { renderRoute } from '@/test/renderRoute';
import {
  ORG_SWITCHED_MESSAGE,
  isOrgMismatch,
  registerOrgResyncTarget,
  resyncOrgAfterStreamError,
  urlOrgId,
} from './orgResync';

const projectId = ids.project.invoicerApi;
const rulesPage = `/o/alice/p/${projectId}/desk/rules`;

const mismatch = () =>
  HttpResponse.json(
    { type: `urn:agentdesk:problem:${ORG_MISMATCH_PROBLEM_TYPE}`, title: 'Conflict', status: 409 },
    { status: 409, headers: { 'content-type': 'application/problem+json' } },
  );

/** Counts the requests the server sees whose path ends with `suffix`. */
function countRequests(suffix: string, method: string) {
  const seen: Request[] = [];
  const listener = ({ request }: { request: Request }) => {
    if (request.method === method && new URL(request.url).pathname.endsWith(suffix)) seen.push(request.clone());
  };
  server.events.on('request:start', listener);
  cleanups.push(() => server.events.removeListener('request:start', listener));
  return seen;
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  vi.useRealTimers();
  for (const c of cleanups.splice(0)) c();
});

describe('org resync', () => {
  it('a read that gets 409 org-mismatch resyncs once and renders its data', async () => {
    let hits = 0;
    server.use(
      http.get('*/api/projects/:projectId/rules', () => {
        hits += 1;
        return hits === 1 ? mismatch() : undefined;
      }),
    );
    const setActive = countRequests('/organization/set-active', 'POST');
    await renderRoute(rulesPage);
    expect(await screen.findByRole('heading', { level: 1, name: 'Routing rules' })).toBeInTheDocument();
    expect(screen.getAllByRole('switch', { name: /^Enable rule \// }).length).toBeGreaterThan(0);
    expect(hits).toBe(2);
    expect(setActive).toHaveLength(1);
    expect(await setActive[0]?.json()).toMatchObject({ organizationId: ids.org.alice });
  });

  it('sends the URL org on every request', async () => {
    const seen: Array<string | null> = [];
    server.use(
      http.get('*/api/projects/:projectId/rules', ({ request }) => {
        seen.push(request.headers.get(ORG_HEADER));
        return undefined;
      }),
    );
    await renderRoute(rulesPage);
    await screen.findByRole('heading', { level: 1, name: 'Routing rules' });
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set([ids.org.alice]));
  });

  it('a write that gets 409 is sent once, shows the switched message and keeps the input', async () => {
    const { user } = await renderRoute(`${rulesPage}?rule=${ids.rule.r2}`);
    const edit = await screen.findByRole('complementary', { name: 'Edit rule' });
    const before = structuredClone(mockDb.state.rules.find((r) => r.id === ids.rule.r2));
    // Another tab switched the session to acme.
    mockDb.setActiveOrg(ids.org.acme);
    const writes = countRequests(`/api/rules/${ids.rule.r2}`, 'PATCH');
    const setActive = countRequests('/organization/set-active', 'POST');
    const command = within(edit).getByLabelText('Command');
    await user.clear(command);
    await user.type(command, 'review');
    await user.click(within(edit).getByRole('button', { name: 'Save rule' }));

    expect(await within(edit).findByText(ORG_SWITCHED_MESSAGE)).toBeInTheDocument();
    expect(within(edit).getByLabelText('Command')).toHaveValue('review');
    expect(writes).toHaveLength(1);
    expect(setActive).toHaveLength(1);
    expect(mockDb.state.rules.find((r) => r.id === ids.rule.r2)).toEqual(before);
    // The resync made the URL org active again: the retry goes through.
    await waitFor(() => expect(mockDb.auth.activeOrganizationId).toBe(ids.org.alice));
    await user.click(within(edit).getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Edit rule' })).toBeNull());
    expect(writes).toHaveLength(2);
    expect(mockDb.state.rules.find((r) => r.id === ids.rule.r2)?.command).toBe('review');
  });

  it('a second 409 after the resync shows the normal error and does not loop', async () => {
    let hits = 0;
    server.use(
      http.get('*/api/projects/:projectId/rules', () => {
        hits += 1;
        return mismatch();
      }),
    );
    const setActive = countRequests('/organization/set-active', 'POST');
    await renderRoute(rulesPage);
    await waitFor(() => expect(hits).toBeGreaterThanOrEqual(2));
    await new Promise((r) => setTimeout(r, 300));
    expect(hits).toBe(2);
    expect(setActive).toHaveLength(1);
    expect(screen.queryByRole('heading', { level: 1, name: 'Routing rules' })).toBeNull();
  });

  it('a route that keeps answering 409 while other requests succeed resyncs once, not in a loop', async () => {
    let hits = 0;
    server.use(
      http.get('*/api/projects/:projectId/rules', () => {
        hits += 1;
        return mismatch();
      }),
    );
    const setActive = countRequests('/organization/set-active', 'POST');
    const { router } = await renderRoute(rulesPage);
    await waitFor(() => expect(hits).toBeGreaterThanOrEqual(2));
    // Other requests succeed, then the route is loaded again and still answers 409.
    await api.projects.list();
    await router.invalidate();
    await api.projects.list();
    await router.invalidate();
    await new Promise((r) => setTimeout(r, 300));
    expect(setActive).toHaveLength(1);
  });

  it('a mismatch long after the previous resync resyncs again', async () => {
    const setActive = countRequests('/organization/set-active', 'POST');
    const { queryClient, router } = await renderRoute(rulesPage);
    await screen.findByRole('heading', { level: 1, name: 'Routing rules' });
    vi.useFakeTimers({ toFake: ['Date'] }); // only the clock the resync bound reads
    for (const n of [1, 2]) {
      vi.advanceTimersByTime(60_000); // past the bound of the previous resync
      mockDb.setActiveOrg(ids.org.acme); // another tab switched
      void queryClient.invalidateQueries({ queryKey: ['org'] });
      void router.invalidate();
      await waitFor(() => expect(setActive).toHaveLength(n));
      await waitFor(() => expect(mockDb.auth.activeOrganizationId).toBe(ids.org.alice));
      expect(await screen.findByRole('heading', { level: 1, name: 'Routing rules' })).toBeInTheDocument();
    }
  });

  it('a write 409, an unrelated read, another switch and a later read resync again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { user } = await renderRoute(`${rulesPage}?rule=${ids.rule.r2}`);
    const edit = await screen.findByRole('complementary', { name: 'Edit rule' });
    const setActive = countRequests('/organization/set-active', 'POST');
    mockDb.setActiveOrg(ids.org.acme); // tab B switched
    await user.click(within(edit).getByRole('button', { name: 'Save rule' }));
    expect(await within(edit).findByText(ORG_SWITCHED_MESSAGE)).toBeInTheDocument();
    await waitFor(() => expect(setActive).toHaveLength(1));
    await waitFor(() => expect(mockDb.auth.activeOrganizationId).toBe(ids.org.alice));
    await api.projects.list(); // the user moved on: an unrelated read succeeds
    vi.advanceTimersByTime(60_000);
    mockDb.setActiveOrg(ids.org.acme); // tab B switched again
    await expect(api.projects.list()).rejects.toSatisfy(isOrgMismatch);
    await waitFor(() => expect(setActive).toHaveLength(2));
    await waitFor(() => expect(mockDb.auth.activeOrganizationId).toBe(ids.org.alice));
  });

  it('a stream error resyncs only when the session org is not the URL org', async () => {
    const setActive = countRequests('/organization/set-active', 'POST');
    await renderRoute(rulesPage);
    await screen.findByRole('heading', { level: 1, name: 'Routing rules' });
    await resyncOrgAfterStreamError();
    expect(setActive).toHaveLength(0);
    mockDb.setActiveOrg(ids.org.acme);
    await resyncOrgAfterStreamError();
    expect(setActive).toHaveLength(1);
    expect(mockDb.auth.activeOrganizationId).toBe(ids.org.alice);
  });

  it('four reads failing with org-mismatch together send one set-active', async () => {
    let hits = 0;
    server.use(
      http.get('*/api/projects', () => {
        hits += 1;
        return hits <= 4 ? mismatch() : undefined;
      }),
    );
    await renderRoute(rulesPage);
    await screen.findByRole('heading', { level: 1, name: 'Routing rules' });
    const setActive = countRequests('/organization/set-active', 'POST');
    const results = await Promise.allSettled([
      api.projects.list(),
      api.projects.list(),
      api.projects.list(),
      api.projects.list(),
    ]);
    expect(results.every((r) => r.status === 'rejected' && isOrgMismatch(r.reason))).toBe(true);
    expect(setActive).toHaveLength(1);
  });
});

describe('urlOrgId', () => {
  it('is undefined, not a throw, for a malformed percent escape in the path', () => {
    // Only `latestLocation` and the cache are read; a full router is not needed for the path parsing.
    const router = { latestLocation: { pathname: '/o/%E0%A4%A/p' } } as unknown as AnyRouter;
    const queryClient = { getQueryData: () => [{ id: 'x', slug: 'alice', name: 'Alice' }] } as unknown as QueryClient;
    registerOrgResyncTarget({ router, queryClient });
    expect(urlOrgId()).toBeUndefined();
  });
});

describe('isOrgMismatch', () => {
  it('is false for other errors', () => {
    expect(isOrgMismatch(new Error('x'))).toBe(false);
    expect(isOrgMismatch(undefined)).toBe(false);
  });
});
