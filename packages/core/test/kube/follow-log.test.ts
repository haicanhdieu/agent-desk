import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { FollowLog, type FollowLogConfig } from '../../src/kube/follow-log';

const config: FollowLogConfig = {
  getCurrentCluster: () => ({ name: 'c', server: 'https://kube.test', skipTLSVerify: false }),
  applySecurityAuthentication: vi.fn(async () => undefined),
};

/** A log-follow response whose body yields `chunks`, then fails like undici's body timeout on an idle pod. */
function failingBody(chunks: string[], error: Error): Response {
  const enc = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks[i++];
      if (next !== undefined) controller.enqueue(enc.encode(next));
      else controller.error(error);
    },
  });
  return new Response(body, { status: 200 });
}

const collect = (s: PassThrough) =>
  new Promise<string>((resolve) => {
    const parts: Buffer[] = [];
    s.on('data', (d: Buffer) => parts.push(d));
    s.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
  });

describe('FollowLog', () => {
  it('ends the sink cleanly when the follow stream fails, instead of leaving an unhandled stream error', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => void unhandled.push(e);
    process.on('uncaughtException', onUnhandled);
    try {
      const fetchFn = vi.fn(async () => failingBody(['one\n', 'two\n'], new TypeError('terminated')));
      const log = new FollowLog(config, fetchFn);
      const sink = new PassThrough();
      const done = collect(sink);
      await log.log('ns', 'pod', 'run', sink, { follow: true });
      // The sink ends (resolves); a stream error discards chunks still queued, so only the first is certain.
      expect(await done).toMatch(/^one\n/);
      // The error event is emitted on a later tick; give it the chance to surface.
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('uncaughtException', onUnhandled);
    }
  });

  it('requests the pod log with follow and the container, and aborts on the returned controller', async () => {
    let url = '';
    let signal: AbortSignal | undefined;
    const fetchFn = vi.fn(async (u: string, init: { signal?: AbortSignal }) => {
      url = u;
      signal = init.signal;
      return new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 });
    });
    const log = new FollowLog(config, fetchFn as never);
    const controller = await log.log('ns', 'pod-1', 'run', new PassThrough(), { follow: true });
    expect(url).toContain('/api/v1/namespaces/ns/pods/pod-1/log');
    expect(url).toContain('container=run');
    expect(url).toContain('follow=true');
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });

  it('rejects when the API answers with an error status', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 404 }));
    const log = new FollowLog(config, fetchFn as never);
    await expect(log.log('ns', 'pod', 'run', new PassThrough(), { follow: true })).rejects.toMatchObject({ code: 404 });
  });
});
