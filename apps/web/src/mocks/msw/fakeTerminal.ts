import { FINAL_RUN_STATUSES, type RunStatus } from '@agentdesk/contracts';
import { mockDb } from './db';
import { appendRunEvent, subscribeRun, subscribeSetupTest } from './live';

// dev:mock only (main.tsx loads this module in mock mode only): MSW's service worker cannot answer WebSockets, so
// `installFakeTerminal()` wraps `window.WebSocket`. Sockets to `/api/runs/:runId/terminal` and
// `/api/setup-tests/:setupTestId/terminal` get a fake terminal that
// prints a banner and echoes what is typed; every other socket (Vite's HMR) is a real WebSocket. When the run ends
// in the mock store, the session is stored as the run's scrollback and the socket closes with 4409, like the server.

const TERMINAL_PATH = /^\/api\/(runs|setup-tests)\/([^/]+)\/terminal$/;
type OwnerKind = 'run' | 'setup-test';
const CLOSE_RUN_GONE = 4409;
const CLOSE_NOT_FOUND = 4404;
const ESC = '\u001b';
const PROMPT = '\r\n> ';

const isFinal = (s: RunStatus) => FINAL_RUN_STATUSES.some((f) => f === s);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

class FakeTerminalSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readonly url: string;
  readonly protocol = '';
  readonly extensions = '';
  readonly bufferedAmount = 0;
  binaryType: BinaryType = 'blob';
  readyState: number = FakeTerminalSocket.CONNECTING;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;

  private readonly runId: string;
  private readonly kind: OwnerKind;
  private transcript = '';
  private unsubscribe: (() => void) | undefined;

  constructor(url: URL, kind: OwnerKind, runId: string) {
    super();
    this.url = url.href;
    this.kind = kind;
    this.runId = runId;
    setTimeout(() => this.accept(), 150);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== FakeTerminalSocket.OPEN)
      throw new DOMException('WebSocket is not open', 'InvalidStateError');
    // Text frames are resize messages; the fake terminal has no size.
    if (typeof data === 'string' || data instanceof Blob) return;
    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);
    this.output(this.echo(decoder.decode(bytes)));
  }

  close(code = 1000, reason = ''): void {
    this.finish(code, reason);
  }

  private get run() {
    return mockDb.state.runs.find((r) => r.id === this.runId);
  }

  /** A setup test's workspace: a shell once setup finished (passed or failed); until the test ends. */
  private acceptSetupTest(): void {
    const test = mockDb.state.setupTests.find((t) => t.id === this.runId);
    if (!test) return this.finish(CLOSE_NOT_FOUND, 'Setup test not found');
    if (test.status !== 'passed' && test.status !== 'failed') return this.finish(CLOSE_RUN_GONE, 'Setup test ended');
    this.readyState = FakeTerminalSocket.OPEN;
    this.fire(new Event('open'));
    this.unsubscribe = subscribeSetupTest(this.runId, (m) => {
      if (m.event === 'status' && m.data.status === 'ended') this.finish(CLOSE_RUN_GONE, 'Setup test ended');
    });
    this.output(
      `${ESC}[34magent-desk fake terminal${ESC}[0m${ESC}[90m  setup test  ·  dev:mock${ESC}[0m\r\n` +
        `${ESC}[90mThis is not a real workspace: what you type is echoed back.${ESC}[0m\r\n${PROMPT}`,
    );
  }

  private accept(): void {
    if (this.readyState !== FakeTerminalSocket.CONNECTING) return;
    if (this.kind === 'setup-test') return this.acceptSetupTest();
    const run = this.run;
    if (!run) return this.finish(CLOSE_NOT_FOUND, 'Run not found');
    if (isFinal(run.status)) return this.finish(CLOSE_RUN_GONE, 'Run ended');
    this.readyState = FakeTerminalSocket.OPEN;
    this.fire(new Event('open'));
    this.unsubscribe = subscribeRun(this.runId, (m) => {
      if (m.event === 'status' && isFinal(m.data.status)) this.runEnded();
    });
    this.output(
      `${ESC}[34magent-desk fake terminal${ESC}[0m${ESC}[90m  run ${run.number}  ·  dev:mock${ESC}[0m\r\n` +
        `${ESC}[90mThis is not Claude Code: what you type is echoed back.${ESC}[0m\r\n${PROMPT}`,
    );
  }

  /** The run ended: its session becomes the stored scrollback, then the server closes with 4409. */
  private runEnded(): void {
    const run = this.run;
    const stored = run && (mockDb.state.runEvents[run.id] ?? []).some((e) => e.type === 'scrollback');
    if (run && !stored) appendRunEvent(run, 'scrollback', { text: this.transcript.replace(/\r\n/g, '\n') });
    this.finish(CLOSE_RUN_GONE, 'Run ended');
  }

  private echo(input: string): string {
    // Arrow keys and other escape sequences are not echoed.
    // eslint-disable-next-line no-control-regex -- matching control characters is the point.
    return [...input.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|O.)?/g, '')]
      .map((ch) => {
        if (ch === '\r') return PROMPT;
        if (ch === '\u007f') return '\b \b';
        // Other control characters (Ctrl-keys) are not echoed.
        return ch < ' ' ? '' : ch;
      })
      .join('');
  }

  private output(text: string): void {
    if (this.readyState !== FakeTerminalSocket.OPEN || text === '') return;
    this.transcript += text;
    const bytes = encoder.encode(text);
    const data = this.binaryType === 'arraybuffer' ? bytes.slice().buffer : new Blob([bytes]);
    setTimeout(() => this.fire(new MessageEvent('message', { data })), 0);
  }

  private finish(code: number, reason: string): void {
    if (this.readyState === FakeTerminalSocket.CLOSED) return;
    this.readyState = FakeTerminalSocket.CLOSED;
    this.unsubscribe?.();
    setTimeout(() => this.fire(new CloseEvent('close', { code, reason, wasClean: true })), 0);
  }

  private fire(event: Event): void {
    this.dispatchEvent(event);
    if (event instanceof CloseEvent) this.onclose?.(event);
    else if (event instanceof MessageEvent) this.onmessage?.(event);
    else if (event.type === 'open') this.onopen?.(event);
  }
}

let installed = false;

/** Answers the run terminal sockets with the fake terminal; other WebSockets are untouched. Idempotent. */
export function installFakeTerminal(): void {
  if (installed) return;
  installed = true;
  window.WebSocket = new Proxy(window.WebSocket, {
    construct(target, args: ConstructorParameters<typeof WebSocket>) {
      const [url, protocols] = args;
      const parsed = new URL(url, window.location.href);
      const match = parsed.host === window.location.host ? TERMINAL_PATH.exec(parsed.pathname) : null;
      if (match?.[1] && match[2])
        return new FakeTerminalSocket(parsed, match[1] === 'runs' ? 'run' : 'setup-test', match[2]);
      return new target(url, protocols);
    },
  });
}
