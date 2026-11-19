import { isIP } from 'node:net';
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { isBlockedIp } from '@agentdesk/contracts';
import { Agent, request, type Dispatcher } from 'undici';

export const GUARDED_TIMEOUT_MS = 5000;
export const GUARDED_MAX_BYTES = 1_000_000;

export type GuardedHttpErrorKind = 'blocked_address' | 'redirect' | 'timeout' | 'too_large' | 'network' | 'bad_json';

/** Message is `guarded http: <kind>`; never a URL query, header, body or cause text. */
export class GuardedHttpError extends Error {
  readonly kind: GuardedHttpErrorKind;
  constructor(kind: GuardedHttpErrorKind) {
    super(`guarded http: ${kind}`);
    this.name = 'GuardedHttpError';
    this.kind = kind;
  }
}

/** Raised inside the connect-time lookup; recognised by class when undici wraps it. */
class BlockedLookupError extends Error {
  constructor() {
    super('blocked address');
    this.name = 'BlockedLookupError';
  }
}

/** True when `address` (as resolved) must not be connected to. Not an IP at all counts as blocked (fail closed). */
function resolvedIsBlocked(address: string): boolean {
  const bare = address.split('%')[0] ?? '';
  return isIP(bare) === 0 || isBlockedIp(bare);
}

type LookupFn = typeof dnsLookup;
type LookupCallback = (err: Error | null, address?: string | LookupAddress[], family?: number) => void;
type LookupShim = (host: string, options: LookupOptions, cb: LookupCallback) => void;

/** undici Agent whose connect.lookup rejects any resolved address for which isBlockedIp is true. `lookup` is a test seam. */
export function createGuardedAgent(opts?: { lookup?: LookupFn }): Agent {
  // Cast: dns.lookup's overloads do not unify into one callable type; this is the single shape Node calls it with.
  const inner = (opts?.lookup ?? dnsLookup) as unknown as LookupShim;
  const guarded: LookupShim = (host, options, cb) => {
    inner(host, options, (err, address, family) => {
      if (err) return cb(err);
      // Node asks for `all` when it tries several families, and then expects an array back.
      const list = Array.isArray(address) ? address.map((a) => a.address) : [String(address)];
      if (list.length === 0 || list.some(resolvedIsBlocked)) return cb(new BlockedLookupError());
      return cb(null, address, family);
    });
  };
  // Cast: undici's connector option types do not declare `lookup`, but it is passed through to net.connect.
  return new Agent({ connect: { lookup: guarded as unknown as LookupFn } });
}

let shared: Agent | undefined;
function sharedAgent(): Agent {
  shared ??= createGuardedAgent();
  return shared;
}

export interface GuardedGetOptions {
  headers: Record<string, string>;
  dispatcher?: Dispatcher;
  timeoutMs?: number;
  maxBytes?: number;
}

/** Hostname as the connection will see it: lowercase, no IPv6 brackets, no trailing dots. */
function normalizedHost(url: URL): string {
  let h = url.hostname.toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  return h.replace(/\.+$/, '');
}

function assertAllowed(url: URL): void {
  if (url.protocol !== 'https:') throw new GuardedHttpError('blocked_address');
  const host = normalizedHost(url);
  if (host === '' || host === 'localhost' || host.endsWith('.localhost') || isBlockedIp(host)) {
    throw new GuardedHttpError('blocked_address');
  }
}

function causeChainHasBlocked(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 5 && e instanceof Error; i++) {
    if (e instanceof BlockedLookupError) return true;
    e = e.cause;
  }
  return false;
}

/** GET returning the status and parsed JSON. Refuses non-https, localhost and blocked IP-literal hosts before connecting; a 3xx is `redirect`. */
export async function guardedGetJson(url: URL, opts: GuardedGetOptions): Promise<{ status: number; json: unknown }> {
  assertAllowed(url);
  const maxBytes = opts.maxBytes ?? GUARDED_MAX_BYTES;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? GUARDED_TIMEOUT_MS);
  const fail = (err: unknown): never => {
    if (err instanceof GuardedHttpError) throw err;
    if (causeChainHasBlocked(err)) throw new GuardedHttpError('blocked_address');
    if (signal.aborted) throw new GuardedHttpError('timeout');
    throw new GuardedHttpError('network');
  };

  let status: number;
  let text: string;
  try {
    const res = await request(url, {
      method: 'GET',
      headers: opts.headers,
      dispatcher: opts.dispatcher ?? sharedAgent(),
      signal,
    });
    status = res.statusCode;
    if (status >= 300 && status < 400) {
      res.body.destroy();
      throw new GuardedHttpError('redirect');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body) {
      const buf: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > maxBytes) {
        res.body.destroy();
        throw new GuardedHttpError('too_large');
      }
      chunks.push(buf);
    }
    text = Buffer.concat(chunks).toString('utf8');
  } catch (err) {
    return fail(err);
  }
  try {
    return { status, json: JSON.parse(text) as unknown };
  } catch {
    throw new GuardedHttpError('bad_json');
  }
}
