// Test doubles for `@xterm/xterm` and `@xterm/addon-fit` (jsdom has no canvas, matchMedia or layout, so the real
// terminal cannot open there). src/test/setup.ts mocks both modules with these for every test, the stories smoke
// test included. Like xterm, the fake renders what is written as text (never markup), drops input while
// `disableStdin` is set, and fires `onResize` when the size changes. Tests drive it through `FakeXterm`.

interface Disposable {
  dispose(): void;
}

export interface FakeXtermOptions {
  disableStdin?: boolean;
  screenReaderMode?: boolean;
  theme?: Record<string, string | undefined>;
  [key: string]: unknown;
}

type Listener<T> = (value: T) => void;

function emitter<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    on(fn: Listener<T>): Disposable {
      listeners.add(fn);
      return { dispose: () => listeners.delete(fn) };
    },
    fire(value: T) {
      for (const fn of [...listeners]) fn(value);
    },
  };
}

const decoder = new TextDecoder();

export class Terminal {
  /** Every terminal created since the last reset, oldest first. */
  static instances: Terminal[] = [];

  /** The newest terminal (throws when none was created). */
  static latest(): Terminal {
    const last = Terminal.instances.at(-1);
    if (!last) throw new Error('No xterm Terminal was created');
    return last;
  }

  /** The size jsdom reports for every terminal host (it has no layout). 0 by 0: hidden, or not laid out yet. */
  static hostSize = { width: 800, height: 600 };

  static reset(): void {
    Terminal.instances = [];
    Terminal.hostSize = { width: 800, height: 600 };
  }

  readonly options: FakeXtermOptions;
  cols = 80;
  rows = 24;
  element: HTMLElement | undefined;
  disposed = false;
  /** Everything written, in order. */
  readonly writes: Array<string | Uint8Array> = [];
  private readonly data = emitter<string>();
  private readonly resized = emitter<{ cols: number; rows: number }>();
  private screen: HTMLElement | undefined;
  private keyHandler: ((event: KeyboardEvent) => boolean) | undefined;
  private selected = '';
  private readonly oscHandlers = new Map<number, (data: string) => boolean | Promise<boolean>>();

  /** The slice of xterm's escape sequence parser the app uses: OSC handlers. Fired by `osc()`. */
  readonly parser = {
    registerOscHandler: (ident: number, callback: (data: string) => boolean | Promise<boolean>): Disposable => {
      this.oscHandlers.set(ident, callback);
      return { dispose: () => this.oscHandlers.delete(ident) };
    },
  };

  constructor(options: FakeXtermOptions = {}) {
    this.options = { ...options };
    Terminal.instances.push(this);
  }

  /** Every addon loaded, in order. */
  readonly addons: Array<{ activate(term: Terminal): void }> = [];

  loadAddon(addon: { activate(term: Terminal): void }): void {
    this.addons.push(addon);
    addon.activate(this);
  }

  open(parent: HTMLElement): void {
    const element = document.createElement('div');
    element.className = 'xterm';
    const input = document.createElement('textarea');
    input.setAttribute('aria-label', 'Terminal input');
    input.className = 'xterm-helper-textarea';
    this.screen = document.createElement('div');
    this.screen.className = 'xterm-screen';
    element.append(input, this.screen);
    parent.append(element);
    for (const [name, dim] of [
      ['clientWidth', 'width'],
      ['clientHeight', 'height'],
    ] as const) {
      Object.defineProperty(parent, name, { configurable: true, get: () => Terminal.hostSize[dim] });
    }
    this.element = element;
  }

  write(data: string | Uint8Array, callback?: () => void): void {
    if (this.disposed) return;
    this.writes.push(data);
    const row = document.createElement('div');
    row.textContent = typeof data === 'string' ? data : decoder.decode(data);
    this.screen?.append(row);
    callback?.();
  }

  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void {
    this.keyHandler = handler;
  }

  hasSelection(): boolean {
    return this.selected !== '';
  }

  clearSelection(): void {
    this.selected = '';
  }

  getSelection(): string {
    return this.selected;
  }

  onData(fn: Listener<string>): Disposable {
    return this.data.on(fn);
  }

  onResize(fn: Listener<{ cols: number; rows: number }>): Disposable {
    return this.resized.on(fn);
  }

  resize(cols: number, rows: number): void {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.resized.fire({ cols, rows });
  }

  /** How many times `focus()` was called. */
  focusCalls = 0;

  focus(): void {
    this.focusCalls += 1;
  }

  /** The terminal modes the program has set; `applicationCursorKeysMode` is DECCKM. Tests flip it with `setApplicationCursor()`. */
  readonly modes = { applicationCursorKeysMode: false };

  /** Like xterm's `input()`: sends `data` as if typed, and is dropped while stdin is disabled. */
  input(data: string): void {
    if (this.options.disableStdin || this.disposed) return;
    this.data.fire(data);
  }

  dispose(): void {
    this.disposed = true;
    this.element?.remove();
  }

  // Test helpers.

  /** The user types `text` (dropped when stdin is disabled, as in xterm). */
  type(text: string): void {
    if (this.options.disableStdin || this.disposed) return;
    this.data.fire(text);
  }

  /**
   * The user presses Enter (with `init` modifiers). Like xterm, the custom key handler runs first (returning false
   * skips xterm's own handling), then Enter is sent as CR, or ESC CR with Alt, whatever Shift says. Returns the event.
   */
  pressEnter(init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, ...init });
    if (this.options.disableStdin || this.disposed) return event;
    if (this.keyHandler && !this.keyHandler(event)) return event;
    this.data.fire(event.altKey ? '\x1b\r' : '\r');
    return event;
  }

  /** The program prints an OSC sequence `ESC ] ident ; data BEL`: calls the handler registered for `ident`, with the data after the first `;`. */
  osc(ident: number, data: string): void {
    if (this.disposed) return;
    void this.oscHandlers.get(ident)?.(data);
  }

  /** The program turns application cursor mode (DECCKM) on or off. */
  setApplicationCursor(on: boolean): void {
    this.modes.applicationCursorKeysMode = on;
  }

  /** The user selects `text` on the screen (an empty string clears it). */
  select(text: string): void {
    this.selected = text;
  }

  /**
   * The user presses `key` (with `init` modifiers). Like xterm, the custom key handler runs first (it runs even with
   * stdin disabled; returning false skips xterm's own handling), then Ctrl+C is sent as ETX, which xterm does whatever
   * the selection is. Other keys are not modelled. Returns the event.
   */
  pressKey(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init });
    if (this.disposed) return event;
    if (this.keyHandler && !this.keyHandler(event)) return event;
    if (!this.options.disableStdin && event.ctrlKey && key.toLowerCase() === 'c') this.data.fire('\x03');
    return event;
  }

  /** Everything written, decoded as text. */
  written(): string {
    return this.writes.map((w) => (typeof w === 'string' ? w : decoder.decode(w))).join('');
  }
}

export class FitAddon {
  /** The size the next `fit()` applies (the container's size in cells). */
  static nextSize: { cols: number; rows: number } = { cols: 80, rows: 24 };
  /** False: the container has no size (hidden or not laid out), so `proposeDimensions()` reports none. Reset after every test. */
  static hasSize = true;
  private term: Terminal | undefined;

  activate(term: Terminal): void {
    this.term = term;
  }

  fit(): void {
    this.term?.resize(FitAddon.nextSize.cols, FitAddon.nextSize.rows);
  }

  proposeDimensions(): { cols: number; rows: number } | undefined {
    return FitAddon.hasSize ? { ...FitAddon.nextSize } : undefined;
  }

  dispose(): void {}
}

/** Stands in for `@xterm/addon-webgl`: records disposal, loses its context on demand, can fail to start. */
export class WebglAddon {
  /** Make `activate` throw, as it does where WebGL is unavailable. Reset after every test. */
  static failOnActivate = false;
  disposed = false;
  private readonly lost = emitter<void>();

  activate(): void {
    if (WebglAddon.failOnActivate) throw new Error('WebGL2 not supported');
  }

  readonly onContextLoss = (fn: Listener<void>): Disposable => this.lost.on(fn);

  dispose(): void {
    this.disposed = true;
  }

  // Test helper.
  loseContext(): void {
    this.lost.fire();
  }
}

export const FakeXterm = Terminal;
export const FakeFitAddon = FitAddon;
export const FakeWebglAddon = WebglAddon;
export type FakeWebglAddon = WebglAddon;
export type FakeFitAddon = FitAddon;
