import type { ServerResponse } from 'node:http';

/** A client that lets this much unsent data pile up is not keeping up; it is dropped and reconnects (Last-Event-ID). */
export const MAX_BUFFERED_BYTES = 1024 * 1024;

/** Server-sent-events framing over a raw Node response. The caller owns the HTTP lifecycle (hijacked reply). */
export class SseWriter {
  private ended = false;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly closeHandlers: Array<() => void> = [];

  constructor(
    private readonly raw: ServerResponse,
    private readonly maxBuffered = MAX_BUFFERED_BYTES,
  ) {
    const onClose = (): void => this.finish();
    // `on`, not `once`: a second 'error' must still have a listener, or it would throw.
    raw.on('close', onClose);
    raw.on('error', onClose);
    if (raw.destroyed || raw.writableEnded) this.ended = true;
  }

  get closed(): boolean {
    return this.ended;
  }

  /** Runs once when the connection ends, from either side. */
  onClose(handler: () => void): void {
    if (this.ended) handler();
    else this.closeHandlers.push(handler);
  }

  /** Marks the stream over and runs the close handlers (once); does not touch the socket. */
  private finish(): void {
    this.ended = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const h of this.closeHandlers.splice(0)) h();
  }

  /** Gives up the stream without ending the response (used when an ordinary error response takes over). */
  release(): void {
    this.finish();
  }

  startHeartbeat(ms: number): void {
    if (this.ended) return;
    this.heartbeat = setInterval(() => this.comment('ping'), ms);
    this.heartbeat.unref();
  }

  start(headers: Record<string, string | number | string[] | undefined>): void {
    this.raw.writeHead(200, {
      ...headers,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    this.raw.flushHeaders();
  }

  event(name: string, data: unknown, id?: number): void {
    this.write(`event: ${name}\n${id === undefined ? '' : `id: ${id}\n`}data: ${JSON.stringify(data)}\n\n`);
  }

  comment(text: string): void {
    // Skipped while the socket is backed up: the next real frame (or the drop) tells the story.
    if (this.raw.writableNeedDrain) return;
    this.write(`: ${text}\n\n`);
  }

  /** Resolves once the socket has drained (or the connection is gone). */
  async drained(): Promise<void> {
    if (this.ended || !this.raw.writableNeedDrain) return;
    await new Promise<void>((resolve) => {
      const done = (): void => {
        this.raw.off('drain', done);
        this.raw.off('close', done);
        resolve();
      };
      this.raw.once('drain', done);
      this.raw.once('close', done);
    });
  }

  end(): void {
    if (this.ended) return;
    this.raw.end();
    this.finish();
  }

  private write(chunk: string): void {
    if (this.ended) return;
    this.raw.write(chunk);
    if (this.raw.writableLength > this.maxBuffered) {
      this.raw.destroy();
      this.finish();
    }
  }
}
