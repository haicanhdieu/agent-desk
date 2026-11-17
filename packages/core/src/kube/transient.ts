import { ApiException } from '@kubernetes/client-node';

/** Temporal failure type for a cluster error that retrying cannot fix (HTTP 4xx other than 429). */
export const CLUSTER_PERMANENT_ERROR = 'ClusterPermanentError';

export type KubeErrorClass =
  { kind: 'transient'; cause: string } | { kind: 'permanent'; status: number } | { kind: 'other' };

const TRANSIENT_NAMES = new Set([
  'BodyTimeoutError',
  'HeadersTimeoutError',
  'ConnectTimeoutError',
  'SocketError',
  'AbortError',
  'TimeoutError',
]);
const TRANSIENT_CODES =
  /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|UND_ERR_\w+)$/;

function causeCode(err: object): string | undefined {
  if (!('cause' in err) || typeof err.cause !== 'object' || err.cause === null) return undefined;
  return 'code' in err.cause && typeof err.cause.code === 'string' ? err.cause.code : undefined;
}

/**
 * Sorts an error from a Kubernetes call. Transient: network/undici errors, aborts, HTTP 5xx and 429.
 * Permanent: any other HTTP 4xx. `cause` is a short code, never the raw error message.
 * An `AbortError` counts as transient: the follower only gets here for aborts it did not cause.
 */
export function classifyKubeError(err: unknown): KubeErrorClass {
  if (typeof err !== 'object' || err === null) return { kind: 'other' };
  if (err instanceof ApiException) {
    const status = err.code;
    if (status >= 500 || status === 429) return { kind: 'transient', cause: `http_${status}` };
    if (status >= 400) return { kind: 'permanent', status };
    return { kind: 'other' };
  }
  const code = causeCode(err);
  const name = 'name' in err && typeof err.name === 'string' ? err.name : '';
  const isFetchFailure = err instanceof TypeError && err.message === 'fetch failed';
  if (code !== undefined && (isFetchFailure || TRANSIENT_CODES.test(code))) return { kind: 'transient', cause: code };
  if (TRANSIENT_NAMES.has(name)) return { kind: 'transient', cause: name };
  if (isFetchFailure) return { kind: 'transient', cause: 'fetch_failed' };
  return { kind: 'other' };
}
