import { Readable, type Writable } from 'node:stream';
import { ApiException, type KubeConfig } from '@kubernetes/client-node';
// Not re-exported from the package index; same deep-path stance as the WebSocketHandler import (package has no exports map).
import { AddOptionsToSearchParams } from '@kubernetes/client-node/dist/log.js';
import { RequestContext, HttpMethod } from '@kubernetes/client-node/dist/gen/http/http.js';
import { fetch as undiciFetch } from 'undici';

/** The slice of KubeConfig the follower uses. */
export type FollowLogConfig = Pick<KubeConfig, 'getCurrentCluster' | 'applySecurityAuthentication'>;
type FetchFn = (
  url: string,
  init: { method: 'GET'; headers: Record<string, string>; dispatcher?: unknown; signal: AbortSignal },
) => Promise<Response>;
type LogOptions = Parameters<typeof AddOptionsToSearchParams>[0];

/**
 * Pod log reader with the same shape as `Log.log` from @kubernetes/client-node, which it replaces.
 *
 * Why: `Log.log` pipes `Readable.fromWeb(response.body)` into the caller's stream and keeps no reference to that inner
 * stream, so nobody can listen to its `error` event. undici ends a body that stays silent for 5 minutes
 * (`BodyTimeoutError`), which a follow of an idle pod (the agent waiting for the user) does by design; the unhandled
 * `error` then crashed the whole worker process, and every run on it stopped being driven. Here a failed stream ends the
 * sink, which `followPodLogs` already treats as "stream ended": it re-attaches while the pod is alive.
 */
export class FollowLog {
  constructor(
    private readonly config: FollowLogConfig,
    private readonly fetchFn: FetchFn = undiciFetch as unknown as FetchFn,
  ) {}

  async log(
    namespace: string,
    podName: string,
    containerName: string,
    stream: Writable,
    options?: LogOptions,
  ): Promise<AbortController> {
    const cluster = this.config.getCurrentCluster();
    if (!cluster) throw new Error('No currently active cluster');
    const url = new URL(`${cluster.server}/api/v1/namespaces/${namespace}/pods/${podName}/log`);
    url.searchParams.set('container', containerName);
    AddOptionsToSearchParams(options, url.searchParams);
    const ctx = new RequestContext(url.toString(), HttpMethod.GET);
    await this.config.applySecurityAuthentication(ctx);

    const controller = new AbortController();
    const response = await this.fetchFn(url.toString(), {
      method: 'GET',
      headers: ctx.getHeaders(),
      dispatcher: ctx.getDispatcher(),
      signal: controller.signal,
    });
    if (response.status !== 200 || !response.body) {
      throw new ApiException(response.status, 'Error occurred in log request', undefined, {});
    }
    const source = Readable.fromWeb(response.body as never);
    // A failed or aborted body ends the sink (the caller sees the stream end); it must never go unhandled.
    source.on('error', () => stream.end());
    source.pipe(stream);
    return controller;
  }
}
