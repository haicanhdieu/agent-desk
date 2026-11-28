// matchMedia test double (jsdom has none). src/test/setup.ts installs it and resets the width to 1440 after each
// test. `setViewportWidth(px)` changes the width and fires `change` on every query whose result flipped.
// Supports `(max-width: Npx)` and `(min-width: Npx)`; any other query never matches.

const DEFAULT_WIDTH = 1440;
let width = DEFAULT_WIDTH;

function matches(query: string): boolean {
  const max = /\(\s*max-width:\s*(\d+(?:\.\d+)?)px\s*\)/.exec(query);
  if (max) return width <= Number(max[1]);
  const min = /\(\s*min-width:\s*(\d+(?:\.\d+)?)px\s*\)/.exec(query);
  if (min) return width >= Number(min[1]);
  return false;
}

class FakeMediaQueryList extends EventTarget {
  private last: boolean;
  constructor(readonly media: string) {
    super();
    this.last = matches(media);
    lists.add(this);
  }
  get matches(): boolean {
    return matches(this.media);
  }
  onchange: ((e: MediaQueryListEvent) => void) | null = null;
  addListener(cb: (e: MediaQueryListEvent) => void) {
    this.addEventListener('change', cb as EventListener);
  }
  removeListener(cb: (e: MediaQueryListEvent) => void) {
    this.removeEventListener('change', cb as EventListener);
  }
  refresh() {
    const now = matches(this.media);
    if (now === this.last) return;
    this.last = now;
    const event = new Event('change');
    Object.defineProperties(event, { matches: { value: now }, media: { value: this.media } });
    this.dispatchEvent(event);
  }
}

const lists = new Set<FakeMediaQueryList>();

export function setViewportWidth(px: number): void {
  width = px;
  for (const list of lists) list.refresh();
}

export function resetViewportWidth(): void {
  setViewportWidth(DEFAULT_WIDTH);
}

export function installFakeMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => new FakeMediaQueryList(query),
    configurable: true,
    writable: true,
  });
}
