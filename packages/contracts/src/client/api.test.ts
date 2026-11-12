import { describe, expect, it, vi } from 'vitest';
import { ApiError, apiPath, createApi, sseProjectPath, sseRunPath, terminalPath } from './index';

const P = '11111111-1111-4111-8111-111111111111';
const R = '22222222-2222-4222-8222-222222222222';

function mockFetch(res: Response | Error) {
  return vi.fn<typeof fetch>(async () => {
    if (res instanceof Error) throw res;
    return res;
  });
}
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, ...init });

describe('createApi', () => {
  it('calls GET with substituted path and standard options', async () => {
    const f = mockFetch(json({ nope: true }));
    const api = createApi({ fetch: f, parse: false });
    await api.runs.byNumber({ params: { projectId: P, number: 7 } });
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe(`/api/projects/${P}/runs/7`);
    expect(init?.method).toBe('GET');
    expect(init?.credentials).toBe('same-origin');
    expect(new Headers(init?.headers).get('accept')).toBe('application/json');
  });

  it('serializes query params and prefixes baseUrl', async () => {
    const f = mockFetch(json({ items: [], nextCursor: null }));
    const api = createApi({ fetch: f, baseUrl: 'http://x' });
    await api.runs.list({ params: { projectId: P }, query: { filter: 'needs_you', limit: 50 } });
    expect(f.mock.calls[0]?.[0]).toBe(`http://x/api/projects/${P}/runs?filter=needs_you&limit=50`);
  });

  it('sends JSON body with content-type', async () => {
    const f = mockFetch(json({}));
    const api = createApi({ fetch: f, parse: false });
    await api.projects.update({ params: { projectId: P }, body: { pollIntervalSeconds: 600 } });
    const init = f.mock.calls[0]?.[1];
    expect(init?.method).toBe('PATCH');
    expect(init?.body).toBe(JSON.stringify({ pollIntervalSeconds: 600 }));
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
  });

  it('returns null for 204 without reading json', async () => {
    const res = new Response(null, { status: 204 });
    const spy = vi.spyOn(res, 'json');
    const api = createApi({ fetch: mockFetch(res) });
    expect(await api.projects.remove({ params: { projectId: P } })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('maps problem+json to ApiError with requestId header', async () => {
    const res = json(
      { type: 'conflict', title: 'Conflict', status: 409, errors: [{ pointer: '/command', detail: 'taken' }] },
      { status: 409, headers: { 'content-type': 'application/problem+json', 'x-request-id': 'req-1' } },
    );
    const api = createApi({ fetch: mockFetch(res) });
    const err = await api.rules.remove({ params: { ruleId: R } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    if (!(err instanceof ApiError)) throw new Error('unreachable');
    expect(err.status).toBe(409);
    expect(err.errors?.[0]?.pointer).toBe('/command');
    expect(err.requestId).toBe('req-1');
  });

  it('network failure becomes ApiError status 0', async () => {
    const api = createApi({ fetch: mockFetch(new TypeError('offline')) });
    const err = await api.connections.list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0 });
  });

  it('401 calls onUnauthorized and throws', async () => {
    const onUnauthorized = vi.fn();
    const res = json({ type: 'unauthorized', title: 'Unauthorized', status: 401 }, { status: 401 });
    const api = createApi({ fetch: mockFetch(res), onUnauthorized });
    await expect(api.connections.list()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('non-problem error body still yields ApiError', async () => {
    const api = createApi({ fetch: mockFetch(new Response('boom', { status: 502 })) });
    await expect(api.connections.list()).rejects.toMatchObject({ status: 502 });
  });

  it('parse true rejects mismatching responses; false passes through', async () => {
    const bad = () => mockFetch(json({ wrong: 1 }));
    await expect(createApi({ fetch: bad(), parse: true }).projects.get({ params: { projectId: P } })).rejects.toThrow();
    await expect(createApi({ fetch: bad(), parse: false }).projects.get({ params: { projectId: P } })).resolves.toEqual(
      { wrong: 1 },
    );
  });

  it('encodes path params', async () => {
    const f = mockFetch(json({}));
    await createApi({ fetch: f, parse: false }).skills.get({ params: { projectId: P, name: 'a/b' } });
    expect(f.mock.calls[0]?.[0]).toBe(`/api/projects/${P}/skills/a%2Fb`);
  });
});

describe('fix round 1', () => {
  it('202 with empty body returns null on runs.cancel', async () => {
    const api = createApi({ fetch: mockFetch(new Response(null, { status: 202 })) });
    expect(await api.runs.cancel({ params: { runId: R } })).toBeNull();
  });
  it('2xx with invalid JSON throws ApiError', async () => {
    const api = createApi({ fetch: mockFetch(new Response('{oops', { status: 200 })), parse: false });
    await expect(api.projects.list()).rejects.toMatchObject({ name: 'ApiError', status: 200 });
  });
  it('x-request-id header wins over body requestId', async () => {
    const res = json(
      { type: 't', title: 'T', status: 500, requestId: 'body-id' },
      { status: 500, headers: { 'content-type': 'application/problem+json', 'x-request-id': 'hdr-id' } },
    );
    await expect(createApi({ fetch: mockFetch(res) }).projects.list()).rejects.toMatchObject({ requestId: 'hdr-id' });
  });
  it('401 without onUnauthorized still throws ApiError', async () => {
    const api = createApi({ fetch: mockFetch(json({}, { status: 401 })) });
    await expect(api.projects.list()).rejects.toBeInstanceOf(ApiError);
  });
  it('parse true passes a valid payload', async () => {
    const api = createApi({ fetch: mockFetch(json([])), parse: true });
    expect(await api.projects.list()).toEqual([]);
  });
});

describe('paths', () => {
  it('apiPath substitutes params', () => {
    expect(apiPath('runs.get', { runId: R })).toBe(`/api/runs/${R}`);
  });
  it('sse and terminal paths', () => {
    expect(sseRunPath(R)).toBe(`/api/runs/${R}/events`);
    expect(sseRunPath(R, 12)).toBe(`/api/runs/${R}/events?after=12`);
    expect(sseProjectPath(P)).toBe(`/api/projects/${P}/events`);
    expect(terminalPath(R)).toBe(`/api/runs/${R}/terminal`);
  });
});
