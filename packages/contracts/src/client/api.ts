import { z } from 'zod';
import { flattenRoutes, routes, type RouteDef, type Routes } from '../routes';
import { ApiError, apiErrorFromResponse } from './error';

type Obj<T> = { [K in keyof T]: T[K] };
type Out<S> = S extends z.ZodType ? z.output<S> : never;

// Query schemas often carry defaults/coercion, so callers may omit every key.
type CallInput<R extends RouteDef> = Obj<
  (R extends { params: infer S extends z.ZodType } ? { params: z.output<S> } : { params?: undefined }) &
    (R extends { query: infer S extends z.ZodType } ? { query?: Partial<z.output<S>> } : { query?: undefined }) &
    (R extends { body: infer S extends z.ZodType } ? { body: z.output<S> } : { body?: undefined })
>;

export type Api = {
  [G in keyof Routes]: {
    [N in keyof Routes[G]]: Routes[G][N] extends infer R extends RouteDef
      ? (input: CallInput<R>) => Promise<Out<R['response']>>
      : never;
  };
};

export interface ApiOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  parse?: boolean;
  onUnauthorized?: () => void;
}

type RouteKey = {
  [G in keyof Routes]: `${G & string}.${keyof Routes[G] & string}`;
}[keyof Routes];

const flat = flattenRoutes(routes);

function substitute(path: string, params: object | undefined): string {
  const values = new Map(Object.entries(params ?? {}));
  return path.replace(/:([A-Za-z]+)/g, (_m, key: string) => {
    const v = values.get(key);
    if (v === undefined) throw new Error(`Missing path param :${key}`);
    return encodeURIComponent(String(v));
  });
}

function serializeQuery(query: object | undefined): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null) sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Path for a route key (e.g. 'runs.get') with `:params` substituted and encoded. */
export function apiPath(routeKey: RouteKey, params?: Record<string, string | number>): string {
  const def = flat[routeKey];
  if (!def) throw new Error(`Unknown route ${routeKey}`);
  return substitute(def.path, params);
}

export const sseRunPath = (runId: string, after?: string | number): string =>
  `/api/runs/${encodeURIComponent(runId)}/events${after === undefined ? '' : serializeQuery({ after })}`;
export const sseProjectPath = (projectId: string): string => `/api/projects/${encodeURIComponent(projectId)}/events`;
export const terminalPath = (runId: string): string => `/api/runs/${encodeURIComponent(runId)}/terminal`;

const InputShape = z
  .object({ params: z.record(z.string(), z.unknown()), query: z.unknown(), body: z.unknown() })
  .partial();

async function call(def: RouteDef, rawInput: unknown, opts: ApiOptions, doParse: boolean): Promise<unknown> {
  const input = InputShape.parse(rawInput ?? {});
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const url = `${opts.baseUrl ?? ''}${substitute(def.path, input.params)}${serializeQuery(
    input.query !== null && typeof input.query === 'object' ? input.query : undefined,
  )}`;
  const headers = new Headers({ Accept: 'application/json' });
  const init: RequestInit = { method: def.method, credentials: 'same-origin', headers };
  if (input.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(input.body);
  }

  let res: Response;
  try {
    res = await doFetch(url, init);
  } catch (cause) {
    throw new ApiError({
      status: 0,
      type: 'network',
      title: 'Network error',
      detail: cause instanceof Error ? cause.message : 'Request failed',
    });
  }

  if (!res.ok) {
    const err = await apiErrorFromResponse(res);
    if (res.status === 401) opts.onUnauthorized?.();
    throw err;
  }
  if (res.status === 204) return null;
  const data: unknown = await res.json();
  return doParse ? def.response.parse(data) : data;
}

/** Vite injects `import.meta.env`; plain Node/Vitest may not. Guarded read, no vite types needed. */
function defaultParse(): boolean {
  // Cast is deliberate: ImportMeta has no `env` without vite/client types.
  const env = (import.meta as { env?: { MODE?: string } }).env;
  return env?.MODE !== 'production';
}

export function createApi(opts: ApiOptions = {}): Api {
  const doParse = opts.parse ?? defaultParse();
  const out: Record<string, Record<string, (input: unknown) => Promise<unknown>>> = {};
  for (const [group, entries] of Object.entries(routes)) {
    const g: Record<string, (input: unknown) => Promise<unknown>> = {};
    for (const [name, def] of Object.entries<RouteDef>(entries)) {
      g[name] = (input) => call(def, input, opts, doParse);
    }
    out[group] = g;
  }
  // The mapped `Api` type is derived from the same `routes` tree populated above.
  return out as unknown as Api;
}

export const api: Api = createApi();
