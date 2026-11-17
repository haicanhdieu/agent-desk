import { ApiException } from '@kubernetes/client-node';
import { CancelledFailure } from '@temporalio/client';
import { describe, expect, it } from 'vitest';
import { classifyKubeError, CLUSTER_PERMANENT_ERROR } from '../src/kube/transient';

describe('classifyKubeError', () => {
  it('exposes the permanent failure type name', () => {
    expect(CLUSTER_PERMANENT_ERROR).toBe('ClusterPermanentError');
  });
  it.each([
    [
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }),
      'UND_ERR_CONNECT_TIMEOUT',
    ],
    [Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }), 'ECONNRESET'],
    [new TypeError('fetch failed'), 'fetch_failed'],
    [new ApiException(502, 'bad gateway', undefined, {}), 'http_502'],
    [new ApiException(429, 'slow down', undefined, {}), 'http_429'],
    [Object.assign(new Error('body timeout'), { name: 'BodyTimeoutError' }), 'BodyTimeoutError'],
    [new DOMException('aborted', 'AbortError'), 'AbortError'],
  ])('transient: %s', (err, cause) => expect(classifyKubeError(err)).toEqual({ kind: 'transient', cause }));
  it.each([401, 403, 404, 422])('permanent: HTTP %i', (s) =>
    expect(classifyKubeError(new ApiException(s, 'x', undefined, {}))).toEqual({ kind: 'permanent', status: s }),
  );
  it('anything else is other', () => {
    expect(classifyKubeError(new Error('boom')).kind).toBe('other');
    expect(classifyKubeError(new CancelledFailure('c')).kind).toBe('other');
    expect(classifyKubeError('str').kind).toBe('other');
  });
});
