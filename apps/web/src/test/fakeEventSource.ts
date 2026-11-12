// EventSource test double (jsdom has none). src/test/setup.ts installs it as the global `EventSource` and resets it
// after each test. A new source is CONNECTING until the test calls `open()`; `fail()` is a dropped connection the
// browser retries (CONNECTING), `fail(FakeEventSource.CLOSED)` one it gives up on.

export class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;

  /** Every source created since the last reset, oldest first. */
  static instances: FakeEventSource[] = [];

  /** The newest source (throws when none was created). */
  static latest(): FakeEventSource {
    const last = FakeEventSource.instances.at(-1);
    if (!last) throw new Error('No EventSource was created');
    return last;
  }

  /** The sources whose URL starts with `prefix` (e.g. '/api/projects/'). */
  static matching(prefix: string): FakeEventSource[] {
    return FakeEventSource.instances.filter((s) => s.url.startsWith(prefix));
  }

  static reset(): void {
    for (const s of FakeEventSource.instances) s.close();
    FakeEventSource.instances = [];
  }

  readonly url: string;
  readonly withCredentials: boolean;
  readyState: number = FakeEventSource.CONNECTING;

  constructor(url: string | URL, init?: EventSourceInit) {
    super();
    this.url = String(url);
    this.withCredentials = init?.withCredentials ?? false;
    FakeEventSource.instances.push(this);
  }

  get closed(): boolean {
    return this.readyState === FakeEventSource.CLOSED;
  }

  /** The connection opens (or reopens after `fail()`). */
  open(): void {
    if (this.closed) return;
    this.readyState = FakeEventSource.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  /** A message of `type`; objects are sent as JSON; `id` becomes `lastEventId`. Ignored once closed. */
  emit(type: string, data: unknown, id?: string | number): void {
    if (this.closed) return;
    this.dispatchEvent(
      new MessageEvent(type, {
        data: typeof data === 'string' ? data : JSON.stringify(data),
        lastEventId: id === undefined ? '' : String(id),
      }),
    );
  }

  /** The connection drops: CONNECTING (the browser reconnects) or CLOSED (it gives up). */
  fail(readyState: number = FakeEventSource.CONNECTING): void {
    if (this.closed) return;
    this.readyState = readyState;
    this.dispatchEvent(new Event('error'));
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }
}
