import { ApiError } from '@agentdesk/contracts/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { envSaveError, useCreateEnvEntry, useRemoveEnvEntry, useUpdateEnvEntry } from './mutations';
import { setupQueries } from './queries';

const org = 'alice';
const projectId = ids.project.docsSite;
const SECRET = 'test-token-not-real-123456';
const REPLACED = 'test-token-not-real-replaced';
const EXISTS = (name: string) => `${name} already exists. A name can be used once, as a variable or a secret.`;
const page = { page: 1, pageSize: 20 };

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

/** The method, path and JSON body of every write the hooks send. */
function writes() {
  const sent: { method: string; path: string; body: unknown }[] = [];
  const listener = ({ request }: { request: Request }) => {
    if (request.method === 'GET') return;
    const path = new URL(request.url).pathname;
    void request
      .clone()
      .text()
      .then((text) => sent.push({ method: request.method, path, body: text === '' ? undefined : JSON.parse(text) }));
  };
  server.events.on('request:start', listener);
  stop = () => server.events.removeListener('request:start', listener);
  return sent;
}

function withClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return { qc, wrapper };
}

function recordInvalidations(qc: QueryClient) {
  const keys: unknown[] = [];
  const original = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = (filters, options) => {
    keys.push(filters?.queryKey);
    return original(filters, options);
  };
  return keys;
}

const problem = (
  status: number,
  title: string,
  extra: { detail?: string; requestId?: string; errors?: { pointer: string; detail: string }[] } = {},
) => new ApiError({ status, type: 'x', title, ...extra });

describe('setupQueries.env', () => {
  it('keys by org, project, kind and page', () => {
    expect(setupQueries.env(org, projectId, { kind: 'secret', ...page }).queryKey).toEqual([
      'org',
      org,
      'projects',
      projectId,
      'setup',
      'env',
      'secret',
      { page: 1, pageSize: 20 },
    ]);
  });

  it('lists one kind', async () => {
    const { wrapper } = withClient();
    const { result } = renderHook(
      () => useQuery(setupQueries.env(org, ids.project.invoicerApi, { kind: 'secret', ...page })),
      {
        wrapper,
      },
    );
    await vi.waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.items.every((e) => e.kind === 'secret' && e.value === null)).toBe(true);
  });
});

describe('env writes', () => {
  it('create is POST {name, value} on the route of its kind', async () => {
    const sent = writes();
    const { wrapper } = withClient();
    const variable = renderHook(() => useCreateEnvEntry(org, projectId, 'plain'), { wrapper });
    const secret = renderHook(() => useCreateEnvEntry(org, projectId, 'secret'), { wrapper });
    await act(async () => {
      expect(await variable.result.current.save({ name: 'DB_HOST', value: 'localhost' })).toBeNull();
      expect(await secret.result.current.save({ name: 'NPM_TOKEN', value: SECRET })).toBeNull();
    });
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent).toEqual([
      { method: 'POST', path: `/api/projects/${projectId}/env-vars`, body: { name: 'DB_HOST', value: 'localhost' } },
      { method: 'POST', path: `/api/projects/${projectId}/env-secrets`, body: { name: 'NPM_TOKEN', value: SECRET } },
    ]);
  });

  it('edit is PUT :name {value}, remove is DELETE :name', async () => {
    const sent = writes();
    const { wrapper } = withClient();
    const create = renderHook(() => useCreateEnvEntry(org, projectId, 'plain'), { wrapper });
    const update = renderHook(() => useUpdateEnvEntry(org, projectId, 'plain'), { wrapper });
    const remove = renderHook(() => useRemoveEnvEntry(org, projectId, 'plain'), { wrapper });
    await act(async () => {
      await create.result.current.save({ name: 'DB_HOST', value: 'old' });
      expect(await update.result.current.save({ name: 'DB_HOST', value: 'new' })).toBeNull();
      expect(await remove.result.current.save('DB_HOST')).toBeNull();
    });
    await vi.waitFor(() => expect(sent).toHaveLength(3));
    expect(sent.slice(1)).toEqual([
      { method: 'PUT', path: `/api/projects/${projectId}/env-vars/DB_HOST`, body: { value: 'new' } },
      { method: 'DELETE', path: `/api/projects/${projectId}/env-vars/DB_HOST`, body: undefined },
    ]);
  });

  it('secrets use the env-secrets routes for edit and remove', async () => {
    const sent = writes();
    const { wrapper } = withClient();
    const create = renderHook(() => useCreateEnvEntry(org, projectId, 'secret'), { wrapper });
    const update = renderHook(() => useUpdateEnvEntry(org, projectId, 'secret'), { wrapper });
    const remove = renderHook(() => useRemoveEnvEntry(org, projectId, 'secret'), { wrapper });
    await act(async () => {
      await create.result.current.save({ name: 'NPM_TOKEN', value: SECRET });
      await update.result.current.save({ name: 'NPM_TOKEN', value: REPLACED });
      await remove.result.current.save('NPM_TOKEN');
    });
    await vi.waitFor(() => expect(sent).toHaveLength(3));
    expect(sent.slice(1).map((s) => `${s.method} ${s.path}`)).toEqual([
      `PUT /api/projects/${projectId}/env-secrets/NPM_TOKEN`,
      `DELETE /api/projects/${projectId}/env-secrets/NPM_TOKEN`,
    ]);
  });

  it('a success invalidates only the lists of the same kind', async () => {
    const { qc, wrapper } = withClient();
    const keys = recordInvalidations(qc);
    const { result } = renderHook(() => useCreateEnvEntry(org, projectId, 'secret'), { wrapper });
    await act(async () => {
      await result.current.save({ name: 'NPM_TOKEN', value: SECRET });
    });
    expect(keys).toEqual([['org', org, 'projects', projectId, 'setup', 'env', 'secret']]);
  });

  it('refetches the list of its kind after a success', async () => {
    const { wrapper } = withClient();
    const { result } = renderHook(
      () => ({
        list: useQuery(setupQueries.env(org, projectId, { kind: 'plain', ...page })),
        other: useQuery(setupQueries.env(org, projectId, { kind: 'secret', ...page })),
        create: useCreateEnvEntry(org, projectId, 'plain'),
      }),
      { wrapper },
    );
    await vi.waitFor(() => expect(result.current.list.data?.total).toBe(0));
    const before = mockDb.requests('GET', `/api/projects/${projectId}/env`);
    await act(async () => {
      await result.current.create.save({ name: 'DB_HOST', value: 'v' });
    });
    await vi.waitFor(() => expect(result.current.list.data?.items.map((e) => e.name)).toEqual(['DB_HOST']));
    expect(mockDb.requests('GET', `/api/projects/${projectId}/env`)).toBe(before + 1);
    expect(result.current.other.data?.total).toBe(0);
  });

  it('a name that exists maps to the Name field error with the typed name, nothing else', async () => {
    const { wrapper } = withClient();
    const variable = renderHook(() => useCreateEnvEntry(org, projectId, 'plain'), { wrapper });
    const secret = renderHook(() => useCreateEnvEntry(org, projectId, 'secret'), { wrapper });
    await act(async () => {
      await variable.result.current.save({ name: 'DB_HOST', value: 'first' });
    });
    let again: unknown;
    let other: unknown;
    await act(async () => {
      again = await variable.result.current.save({ name: 'DB_HOST', value: 'other' });
      other = await secret.result.current.save({ name: 'DB_HOST', value: SECRET });
    });
    expect(again).toEqual({ field: { name: EXISTS('DB_HOST') } });
    expect(other).toEqual({ field: { name: EXISTS('DB_HOST') } });
  });

  it('a 404 on edit or remove is gone, and the list refetches', async () => {
    const { qc, wrapper } = withClient();
    const keys = recordInvalidations(qc);
    const update = renderHook(() => useUpdateEnvEntry(org, projectId, 'plain'), { wrapper });
    const remove = renderHook(() => useRemoveEnvEntry(org, projectId, 'plain'), { wrapper });
    let edited: unknown;
    let removed: unknown;
    await act(async () => {
      edited = await update.result.current.save({ name: 'MISSING', value: 'x' });
      removed = await remove.result.current.save('MISSING');
    });
    expect(edited).toEqual({ gone: true });
    expect(removed).toEqual({ gone: true });
    expect(keys).toContainEqual(['org', org, 'projects', projectId, 'setup', 'env', 'plain']);
  });

  it('a failed save invalidates nothing else and keeps the other kind alone', async () => {
    const { qc, wrapper } = withClient();
    const keys = recordInvalidations(qc);
    scenarios.serverError('projectEnv.createVar');
    const { result } = renderHook(() => useCreateEnvEntry(org, projectId, 'plain'), { wrapper });
    await act(async () => {
      await result.current.save({ name: 'DB_HOST', value: 'v' });
    });
    expect(keys).not.toContainEqual(['org', org, 'projects', projectId, 'setup', 'env', 'secret']);
  });

  it('a 5xx is a banner with the problem title and the request id', async () => {
    scenarios.serverError('projectEnv.createSecret');
    const { wrapper } = withClient();
    const { result } = renderHook(() => useCreateEnvEntry(org, projectId, 'secret'), { wrapper });
    let err: unknown;
    await act(async () => {
      err = await result.current.save({ name: 'NPM_TOKEN', value: SECRET });
    });
    expect(err).toEqual({ banner: { title: 'Internal server error', requestId: expect.stringMatching(/^req-mock-/) } });
    expect(JSON.stringify(err)).not.toContain(SECRET);
  });
});

describe('envSaveError', () => {
  it('maps /name and /value pointers to field errors', () => {
    const e = problem(400, 'Validation failed', {
      errors: [
        { pointer: '/name', detail: 'Use 128 characters or fewer.' },
        { pointer: '/value', detail: 'Too short to hide in logs.' },
      ],
    });
    expect(envSaveError(e)).toEqual({
      field: { name: 'Use 128 characters or fewer.', value: 'Too short to hide in logs.' },
    });
  });

  it('409 on a count cap is the Too many entries banner with the server detail', () => {
    // The real API's shape: title "Conflict" (the ProblemFilter title of every 409), no errors[], the service's detail.
    const detail = 'This project already has the maximum of 500 environment entries.';
    expect(envSaveError(problem(409, 'Conflict', { detail }))).toEqual({
      banner: { title: 'Too many entries', detail },
    });
  });

  it('409 on the size cap is the Too large banner with the fixed text', () => {
    const detail = 'Names and values together cannot exceed 262144 bytes (256 KiB) per project.';
    expect(envSaveError(problem(409, 'Conflict', { detail }))).toEqual({
      banner: {
        title: 'Too large',
        detail: 'Names and values of this project would pass 256 KiB together. Shorten or remove entries to make room.',
      },
    });
  });

  it('a 5xx without a request id has no requestId key', () => {
    expect(envSaveError(problem(503, 'Service unavailable'))).toEqual({ banner: { title: 'Service unavailable' } });
  });

  it('anything else is the generic banner', () => {
    expect(envSaveError(new Error('boom'))).toEqual({ banner: { title: 'Something went wrong. Try again.' } });
    expect(envSaveError(problem(400, 'Bad', { detail: 'unmapped detail' }))).toEqual({
      banner: { title: 'Something went wrong. Try again.' },
    });
  });
});

describe('a secret value is not kept', () => {
  it('no query cache entry and no mutation state holds the value after a create and a replace', async () => {
    const { qc, wrapper } = withClient();
    const { result } = renderHook(
      () => ({
        list: useQuery(setupQueries.env(org, projectId, { kind: 'secret', ...page })),
        create: useCreateEnvEntry(org, projectId, 'secret'),
        update: useUpdateEnvEntry(org, projectId, 'secret'),
      }),
      { wrapper },
    );
    await vi.waitFor(() => expect(result.current.list.data).toBeDefined());
    await act(async () => {
      await result.current.create.save({ name: 'NPM_TOKEN', value: SECRET });
      await result.current.update.save({ name: 'NPM_TOKEN', value: REPLACED });
    });
    await vi.waitFor(() => expect(result.current.list.data?.total).toBe(1));
    await vi.waitFor(() => expect(qc.getMutationCache().getAll()).toHaveLength(0));
    const everything = JSON.stringify([
      qc
        .getQueryCache()
        .getAll()
        .map((q) => [q.queryKey, q.state.data]),
      result.current.create,
      result.current.update,
    ]);
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain(REPLACED);
  });

  it('a failed secret save keeps no value either', async () => {
    scenarios.serverError('projectEnv.updateSecret');
    const { qc, wrapper } = withClient();
    const { result } = renderHook(() => useUpdateEnvEntry(org, projectId, 'secret'), { wrapper });
    await act(async () => {
      await result.current.save({ name: 'NPM_TOKEN', value: SECRET });
    });
    await vi.waitFor(() => expect(qc.getMutationCache().getAll()).toHaveLength(0));
    expect(JSON.stringify(result.current)).not.toContain(SECRET);
  });
});
