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

  static reset(): void {
    Terminal.instances = [];
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

  constructor(options: FakeXtermOptions = {}) {
    this.options = { ...options };
    Terminal.instances.push(this);
  }

  loadAddon(addon: { activate(term: Terminal): void }): void {
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

  focus(): void {}

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

  /** Everything written, decoded as text. */
  written(): string {
    return this.writes.map((w) => (typeof w === 'string' ? w : decoder.decode(w))).join('');
  }
}

export class FitAddon {
  /** The size the next `fit()` applies (the container's size in cells). */
  static nextSize: { cols: number; rows: number } = { cols: 80, rows: 24 };
  private term: Terminal | undefined;

  activate(term: Terminal): void {
    this.term = term;
  }

  fit(): void {
    this.term?.resize(FitAddon.nextSize.cols, FitAddon.nextSize.rows);
  }

  proposeDimensions(): { cols: number; rows: number } {
    return { ...FitAddon.nextSize };
  }

  dispose(): void {}
}

export const FakeXterm = Terminal;
export const FakeFitAddon = FitAddon;
