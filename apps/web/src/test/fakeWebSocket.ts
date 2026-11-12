// WebSocket test double. src/test/setup.ts installs it as the global `WebSocket` and resets it after each test.
// A new socket is CONNECTING until the test calls `open()`; the test plays the server with `receive()` and
// `serverClose()`, and reads what the client sent from `sent`, `textFrames()` and `binaryFrames()`.

type Frame = string | ArrayBufferLike | Blob | ArrayBufferView;

export class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  /** Every socket created since the last reset, oldest first. */
  static instances: FakeWebSocket[] = [];

  /** The newest socket (throws when none was created). */
  static latest(): FakeWebSocket {
    const last = FakeWebSocket.instances.at(-1);
    if (!last) throw new Error('No WebSocket was created');
    return last;
  }

  static reset(): void {
    for (const s of FakeWebSocket.instances) s.readyState = FakeWebSocket.CLOSED;
    FakeWebSocket.instances = [];
  }

  readonly url: string;
  readonly protocol = '';
  readonly extensions = '';
  bufferedAmount = 0;
  binaryType: BinaryType = 'blob';
  readyState: number = FakeWebSocket.CONNECTING;
  /** Frames the client sent, in order. */
  readonly sent: Frame[] = [];
  /** The code the client closed with (`close()`), if it did. */
  clientCloseCode: number | undefined;

  constructor(url: string | URL, protocols?: string | string[]) {
    super();
    void protocols;
    this.url = String(url);
    FakeWebSocket.instances.push(this);
  }

  get pathname(): string {
    return new URL(this.url).pathname;
  }

  send(data: Frame): void {
    if (this.readyState !== FakeWebSocket.OPEN) throw new DOMException('WebSocket is not open', 'InvalidStateError');
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.clientCloseCode = code;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code, reason, wasClean: true }));
  }

  // Server side.

  /** The connection opens. */
  open(): void {
    if (this.readyState !== FakeWebSocket.CONNECTING) return;
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  /** A frame from the server: a string is a text frame, bytes a binary frame (an ArrayBuffer for `arraybuffer`). */
  receive(data: string | Uint8Array): void {
    if (this.readyState !== FakeWebSocket.OPEN) return;
    // Copied into this realm's ArrayBuffer (TextEncoder output can come from another realm in jsdom).
    const payload = typeof data === 'string' ? data : new ArrayBuffer(data.byteLength);
    if (payload instanceof ArrayBuffer && typeof data !== 'string') new Uint8Array(payload).set(data);
    this.dispatchEvent(new MessageEvent('message', { data: payload }));
  }

  /** The server (or the network: 1006) closes the connection. */
  serverClose(code: number, reason = ''): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code, reason, wasClean: code !== 1006 }));
  }

  /** The text frames the client sent. */
  textFrames(): string[] {
    return this.sent.filter((f): f is string => typeof f === 'string');
  }

  /** The binary frames the client sent, as bytes. */
  binaryFrames(): Uint8Array[] {
    return this.sent.flatMap((f) => {
      if (typeof f === 'string' || f instanceof Blob) return [];
      if (ArrayBuffer.isView(f)) return [new Uint8Array(f.buffer, f.byteOffset, f.byteLength)];
      return [new Uint8Array(f)];
    });
  }
}
