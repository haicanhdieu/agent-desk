import type { ServerResponse } from 'node:http';

/** A client that lets this much unsent data pile up is not keeping up; it is dropped and reconnects (Last-Event-ID). */
export const MAX_BUFFERED_BYTES = 1024 * 1024;

/** Server-sent-events framing over a raw Node response. The caller owns the HTTP lifecycle (hijacked reply). */
export class SseWriter {
  private ended = false;
  private readonly closeHandlers: Array<() => void> = [];

  constructor(
    private readonly raw: ServerResponse,
    private readonly maxBuffered = MAX_BUFFERED_BYTES,
  ) {
    const onClose = (): void => {
      this.ended = true;
      for (const h of this.closeHandlers.splice(0)) h();
    };
    raw.once('close', onClose);
    raw.once('error', onClose);
  }

  get closed(): boolean {
    return this.ended;
  }

  /** Runs once when the connection ends, from either side. */
  onClose(handler: () => void): void {
    if (this.ended) handler();
    else this.closeHandlers.push(handler);
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
    this.ended = true;
    this.raw.end();
    for (const h of this.closeHandlers.splice(0)) h();
  }

  private write(chunk: string): void {
    if (this.ended) return;
    this.raw.write(chunk);
    if (this.raw.writableLength > this.maxBuffered) {
      this.ended = true;
      this.raw.destroy();
      for (const h of this.closeHandlers.splice(0)) h();
    }
  }
}
