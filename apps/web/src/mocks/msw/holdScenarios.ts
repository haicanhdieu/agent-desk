import { ORG_HEADER, type RouteDef } from '@agentdesk/contracts';
import { http, type HttpHandler } from 'msw';
import { z } from 'zod';
import { flatRoutes, problemResponse } from './http';

// Mock mode: the mocked e2e specs hold, fail or hide single reads of the app shell (e2e/mock/mock.ts `holdReads`,
// `release`, `setRead`). The handlers sit in front of the mock API: a read that is not held (or whose hold was released
// with "ok") falls through to it, so the answer is the normal one. Only problem+json bodies are made here, and each is
// parsed with the contracts schema by `problemResponse`.

/** The reads of the shell a spec can hold. */
export const HELD_READS = [
  'orgList',
  'projectList',
  'projectDetail',
  'orgAccess',
  'sessionAccess',
  'platformAdmin',
  'platformOrg',
  'members',
  'projectRuns',
  'rules',
  'invitation',
  'myInvitations',
] as const;
export type HeldRead = (typeof HELD_READS)[number];

/**
 * What a read does: `hold` waits for `release`; `fail` is 500; `failOnce` is 500 for the first request only; `pending`
 * never answers; `notFound` is 404; `crash` is 422 problem+json with a request id (`RouteError` shows its "Something
 * went wrong" page).
 */
export const READ_MODES = ['hold', 'fail', 'failOnce', 'pending', 'notFound', 'crash'] as const;
export type ReadMode = (typeof READ_MODES)[number];
export type HoldConfig = Partial<Record<HeldRead, ReadMode>>;

export const HOLD_KEY = 'agentdesk.mock.hold';

const StoredHold = z.partialRecord(z.enum(HELD_READS), z.enum(READ_MODES));

/** The stored config, or undefined for a missing, unparsable or wrongly shaped value. */
export function parseHoldConfig(raw: string | null): HoldConfig | undefined {
  if (raw === null) return undefined;
  try {
    const parsed = StoredHold.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

interface ReadTarget {
  /** A route key of the contracts table, or the better-auth path of the org list. */
  route?: string;
  path?: string;
  /** The org-pinned and the session access reads share a route; the org header tells them apart. */
  pinned?: boolean;
}

const TARGETS: Record<HeldRead, ReadTarget> = {
  orgList: { path: '/auth/organization/list' },
  projectList: { route: 'projects.list' },
  projectDetail: { route: 'projects.get' },
  orgAccess: { route: 'me.access', pinned: true },
  sessionAccess: { route: 'me.access', pinned: false },
  platformAdmin: { route: 'me.platform' },
  platformOrg: { route: 'platform.getOrg' },
  members: { route: 'members.list' },
  projectRuns: { route: 'runs.list' },
  rules: { route: 'rules.list' },
  invitation: { route: 'me.getInvitation' },
  myInvitations: { route: 'me.listInvitations' },
};

function defOf(route: string): RouteDef {
  const def = flatRoutes[route];
  if (def === undefined) throw new Error(`Unknown route ${route}`);
  return def;
}

interface Gate {
  promise: Promise<void>;
  open(): void;
  outcome: 'ok' | 'fail';
}

function newGate(): Gate {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open, outcome: 'ok' };
}

const never = () => new Promise<never>(() => undefined);
const failed = () => problemResponse({ status: 500, title: 'Internal server error', type: 'internal' });

export interface Hold {
  handlers: HttpHandler[];
  /** Lets the held read go on; with "fail" it (and every later request of that read) answers 500 instead. */
  release(read: HeldRead, outcome?: 'ok' | 'fail'): void;
  /** Changes how a read answers from now on (undefined: the mock API answers); a new `hold` waits again. */
  setRead(read: HeldRead, mode: ReadMode | undefined): void;
}

/** Handlers for the configured reads (put them first); `setRead` can change or add a read later. */
export function holdHandlers(config: HoldConfig): Hold {
  const modes: HoldConfig = { ...config };
  const gates: Partial<Record<HeldRead, Gate>> = {};
  const failedOnce = new Set<HeldRead>();

  const gateOf = (read: HeldRead): Gate => (gates[read] ??= newGate());

  async function answer(read: HeldRead): Promise<Response | undefined> {
    switch (modes[read]) {
      case undefined:
        return undefined;
      case 'hold': {
        const gate = gateOf(read);
        await gate.promise;
        return gate.outcome === 'fail' ? failed() : undefined;
      }
      case 'fail':
        return failed();
      case 'failOnce':
        if (failedOnce.has(read)) return undefined;
        failedOnce.add(read);
        return failed();
      case 'pending':
        return never();
      case 'notFound':
        return problemResponse({ status: 404, title: 'Not found', type: 'not-found' });
      case 'crash':
        return problemResponse({ status: 422, title: 'Unprocessable', type: 'validation' });
    }
  }

  const handlers = HELD_READS.map((read): HttpHandler => {
    const target = TARGETS[read];
    const path = target.path ?? defOf(target.route ?? '').path;
    return http.get(path, async ({ request }) => {
      if (target.pinned !== undefined && request.headers.has(ORG_HEADER) !== target.pinned) return undefined;
      return answer(read);
    });
  });

  return {
    handlers,
    release(read, outcome = 'ok') {
      const gate = gateOf(read);
      gate.outcome = outcome;
      gate.open();
    },
    setRead(read, mode) {
      if (mode === undefined) delete modes[read];
      else modes[read] = mode;
      gates[read]?.open();
      delete gates[read];
      failedOnce.delete(read);
    },
  };
}
