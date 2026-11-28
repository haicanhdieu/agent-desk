import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { SCROLLBACK_ENDED_RUN, STOPPED_RUN, sessionEventFixtures, sessionRunFixtures } from '@/mocks/dto/sessionRuns';
import { mockDb } from '@/mocks/msw/db';
import { scenarios } from '@/mocks/msw/scenarios';
import { setViewportWidth } from '@/test/fakeMatchMedia';
import { FakeFitAddon, FakeXterm } from '@/test/fakeXterm';
import { FakeWebSocket } from '@/test/fakeWebSocket';
import { renderRoute } from '@/test/renderRoute';
import { RESIZE_DEBOUNCE_MS, TERMINAL_BACKOFF_MS } from './useTerminal';
import { TERMINAL_UNUSED_CLOSE_MS } from './unusedWatch';

// The phone run page (BR-60, BR-66, BR-67, BR-69): the extra keys, the "Terminal | Details" view switch and the
// visual viewport sizing. The real guard and the real fake pod socket frames; the access check is never mocked.

const P1 = ids.project.invoicerApi;
const base = `/o/acme/p/${P1}`;
const IDLE = 62;
const PAUSED = 64;
const SUCCEEDED = 60;
const ALICE = ids.user.alice;
const OTHER = 'user-someone-else';
const PHONE_WIDTH = 390;

const KEYS = ['Esc', 'Tab', 'Left arrow', 'Up arrow', 'Down arrow', 'Right arrow', 'Ctrl-C', 'Enter'];
const BYTES = ['\x1b', '\t', '\x1b[D', '\x1b[A', '\x1b[B', '\x1b[C', '\x03', '\r'];

const dbRun = (n: number) => {
  const r = mockDb.state.runs.find((x) => x.projectId === P1 && x.number === n);
  if (!r) throw new Error(`run ${n} missing`);
  return r;
};

type Seat = Parameters<typeof scenarios.onboarding>[0];
const open = (path: string, seat: Seat = 'owner', owners: Record<number, string | null> = {}) =>
  renderRoute(path, {
    scenario: () => {
      scenarios.onboarding(seat);
      mockDb.addRuns(sessionRunFixtures, sessionEventFixtures);
      for (const [n, owner] of Object.entries(owners)) dbRun(Number(n)).ownerUserId = owner;
    },
  });

const keysRow = () => screen.queryByRole('group', { name: 'Terminal keys' });
const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const sentText = (ws: FakeWebSocket) => ws.binaryFrames().map(decode);

/** Opens the live run on a phone and its terminal socket; returns the socket. */
async function openLive(seat: Seat = 'owner', owners: Record<number, string | null> = { [IDLE]: ALICE }) {
  setViewportWidth(PHONE_WIDTH);
  const rendered = await open(`${base}/runs/${IDLE}`, seat, owners);
  await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
  return { ...rendered, ws: FakeWebSocket.latest() };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('phone run page, the extra keys', () => {
  it('TC-66.1 / BR-67: the row has the keys in order and each press is exactly one binary frame', async () => {
    const { ws, user } = await openLive();
    act(() => ws.open());
    const row = await screen.findByRole('group', { name: 'Terminal keys' });
    const buttons = within(row).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(KEYS);
    for (const [i, button] of buttons.entries()) {
      await user.click(button);
      expect(ws.binaryFrames()).toHaveLength(i + 1);
    }
    expect(sentText(ws)).toEqual(BYTES);
  });

  it('BR-67: an arrow sends the ESC O form while the program is in application cursor mode', async () => {
    const { ws, user } = await openLive();
    act(() => ws.open());
    const term = FakeXterm.instances.find((t) => !t.options.disableStdin);
    term?.setApplicationCursor(true);
    await user.click(await screen.findByRole('button', { name: 'Up arrow' }));
    expect(sentText(ws)).toEqual(['\x1bOA']);
  });

  it.each([639, 640, 1023])('TC-66.2: the row shows at %i wide', async (width) => {
    const { ws } = await openLive();
    act(() => ws.open());
    await screen.findByRole('group', { name: 'Terminal keys' });
    act(() => setViewportWidth(width));
    expect(keysRow()).toBeInTheDocument();
  });

  it('TC-66.3: no row at 1024 wide', async () => {
    const { ws } = await openLive();
    act(() => ws.open());
    await screen.findByRole('group', { name: 'Terminal keys' });
    act(() => setViewportWidth(1024));
    expect(keysRow()).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Run view switch' })).not.toBeInTheDocument();
  });

  it('a tap keeps the focus in the terminal when it had it', async () => {
    const { ws, user } = await openLive();
    act(() => ws.open());
    const input = await screen.findByLabelText('Terminal input');
    act(() => input.focus());
    await user.click(screen.getByRole('button', { name: 'Tab' }));
    expect(input).toHaveFocus();
    expect(sentText(ws)).toEqual(['\t']);
  });

  it('a tap does not focus the terminal when it had no focus', async () => {
    const { ws, user } = await openLive();
    act(() => ws.open());
    const term = FakeXterm.instances.find((t) => !t.options.disableStdin);
    await user.click(await screen.findByRole('button', { name: 'Tab' }));
    expect(term?.focusCalls).toBe(0);
    expect(screen.getByLabelText('Terminal input')).not.toHaveFocus();
  });

  it('a tap restarts the unused-socket timer, and after that close nothing is sent', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });
    const { ws, user } = await openLive();
    act(() => ws.open());
    const tab = await screen.findByRole('button', { name: 'Tab' });
    const almost = TERMINAL_UNUSED_CLOSE_MS - 60_000;
    act(() => vi.advanceTimersByTime(almost));
    await user.click(tab);
    act(() => vi.advanceTimersByTime(almost));
    // Without the tap the socket would have closed by now.
    expect(ws.clientCloseCode).toBeUndefined();
    expect(keysRow()).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(120_000));
    expect(ws.clientCloseCode).toBe(1000);
    await waitFor(() => expect(keysRow()).not.toBeInTheDocument());
    expect(sentText(ws)).toEqual(['\t']);
  });
});

describe('phone run page, no keys when the terminal is not open and writable (BR-69)', () => {
  it('TC-69.5: none while connecting', async () => {
    await openLive();
    await screen.findByRole('group', { name: 'Claude Code terminal' });
    expect(keysRow()).not.toBeInTheDocument();
  });

  it('TC-69.5: none while retrying or after the retries gave up', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    const { ws } = await openLive();
    act(() => ws.open());
    await screen.findByRole('group', { name: 'Terminal keys' });
    act(() => ws.serverClose(1006));
    await waitFor(() => expect(keysRow()).not.toBeInTheDocument());
    for (const delay of TERMINAL_BACKOFF_MS) {
      act(() => vi.advanceTimersByTime(delay));
      act(() => FakeWebSocket.latest().serverClose(1006));
    }
    expect(await screen.findByText('Connection to the terminal lost')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect now' })).toBeInTheDocument();
    expect(keysRow()).not.toBeInTheDocument();
  });

  it('TC-69.6: none once the terminal was closed for inactivity', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });
    const { ws } = await openLive();
    act(() => ws.open());
    await screen.findByRole('group', { name: 'Terminal keys' });
    act(() => vi.advanceTimersByTime(TERMINAL_UNUSED_CLOSE_MS + 1_000));
    expect(await screen.findByText('Terminal closed for inactivity')).toBeInTheDocument();
    expect(keysRow()).not.toBeInTheDocument();
  });

  it('TC-69.1: a viewer sees no row and no frame is sent', async () => {
    const { ws } = await openLive('viewer');
    act(() => ws.serverClose(4403));
    expect(await screen.findByText("You can't open this terminal")).toBeInTheDocument();
    expect(keysRow()).not.toBeInTheDocument();
    expect(ws.sent).toEqual([]);
  });

  it('TC-69.1: a viewer gets no row even if the socket opened', async () => {
    const { ws } = await openLive('viewer');
    act(() => ws.open());
    expect(keysRow()).not.toBeInTheDocument();
    expect(ws.binaryFrames()).toEqual([]);
  });

  it("TC-69.2: a member on someone else's run sees no row and no frame is sent", async () => {
    const { ws } = await openLive('member', { [IDLE]: OTHER });
    act(() => ws.serverClose(4403));
    expect(await screen.findByText("You can't open this terminal")).toBeInTheDocument();
    expect(keysRow()).not.toBeInTheDocument();
    expect(ws.sent).toEqual([]);
  });

  it("TC-69.2: a member on someone else's run gets no row even if the socket opened", async () => {
    const { ws } = await openLive('member', { [IDLE]: OTHER });
    act(() => ws.open());
    expect(keysRow()).not.toBeInTheDocument();
    expect(ws.binaryFrames()).toEqual([]);
  });

  it('a member on their own run has the row', async () => {
    const { ws } = await openLive('member', { [IDLE]: ALICE });
    act(() => ws.open());
    expect(await screen.findByRole('group', { name: 'Terminal keys' })).toBeInTheDocument();
  });

  it.each([
    ['TC-69.3: a paused run', PAUSED],
    ['TC-69.4: an ended run with a saved transcript', SUCCEEDED],
    ['TC-69.4: an ended run with only the final scrollback', SCROLLBACK_ENDED_RUN],
    ['TC-69.4: a stopped run', STOPPED_RUN],
  ])('%s has no row and no socket', async (_name, run) => {
    setViewportWidth(PHONE_WIDTH);
    await open(`${base}/runs/${run}`, 'owner', { [run]: ALICE });
    expect(await screen.findByRole('region', { name: /Transcript|Terminal/ })).toBeInTheDocument();
    expect(keysRow()).not.toBeInTheDocument();
    expect(FakeWebSocket.instances.filter((ws) => ws.readyState === FakeWebSocket.OPEN)).toEqual([]);
  });
});

describe('phone run page, the Terminal | Details switch', () => {
  it('shows the terminal first and swaps the views with one socket and one terminal', async () => {
    const { ws, user } = await openLive();
    act(() => ws.open());
    const switchGroup = await screen.findByRole('radiogroup', { name: 'Run view switch' });
    const terminals = FakeXterm.instances.length;
    expect(within(switchGroup).getByRole('radio', { name: 'Terminal' })).toBeChecked();
    expect(screen.queryByRole('complementary', { name: 'Run context' })).not.toBeInTheDocument();

    await user.click(within(switchGroup).getByRole('radio', { name: 'Details' }));
    expect(await screen.findByRole('complementary', { name: 'Run context' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Terminal', hidden: true })).not.toBeVisible();
    await user.click(within(switchGroup).getByRole('radio', { name: 'Terminal' }));
    expect(screen.getByRole('region', { name: 'Terminal' })).toBeVisible();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeXterm.instances).toHaveLength(terminals);
    expect(FakeXterm.instances.every((t) => !t.disposed)).toBe(true);
  });

  it('the Details view holds the run agent name', async () => {
    const { ws, user } = await openLive();
    act(() => ws.open());
    await user.click(await screen.findByRole('radio', { name: 'Details' }));
    const panel = await screen.findByRole('complementary', { name: 'Run context' });
    expect(within(panel).getByText(dbRun(IDLE).agent.name)).toBeInTheDocument();
  });

  it('no keys while Details shows, and the same row when back on Terminal', async () => {
    const { ws, user } = await openLive();
    act(() => ws.open());
    await user.click(await screen.findByRole('radio', { name: 'Details' }));
    expect(screen.getByRole('group', { name: 'Terminal keys', hidden: true })).not.toBeVisible();
    await user.click(screen.getByRole('radio', { name: 'Terminal' }));
    expect(screen.getByRole('group', { name: 'Terminal keys' })).toBeVisible();
  });

  it('sends no resize frame while the terminal is hidden', async () => {
    let notify = () => undefined as void;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          notify = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      cb();
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    const { ws, user } = await openLive();
    act(() => ws.open());
    await user.click(await screen.findByRole('radio', { name: 'Details' }));
    const before = ws.textFrames().length;
    // The hidden host is measured as 0 by 0; the fit addon would propose a tiny size.
    FakeXterm.hostSize = { width: 0, height: 0 };
    FakeFitAddon.nextSize = { cols: 2, rows: 1 };
    act(() => notify());
    act(() => vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS * 3));
    expect(ws.textFrames()).toHaveLength(before);
  });
});

describe('phone run page, the visual viewport (BR-60)', () => {
  class FakeVisualViewport extends EventTarget {
    height = 400;
  }

  it('sizes the phone run view to the visual viewport height, and follows it', async () => {
    const vv = new FakeVisualViewport();
    vi.stubGlobal('visualViewport', vv);
    const { ws } = await openLive();
    act(() => ws.open());
    const main = await screen.findByRole('main');
    expect(main).toHaveStyle({ height: '400px' });
    act(() => {
      vv.height = 320;
      vv.dispatchEvent(new Event('resize'));
    });
    expect(main).toHaveStyle({ height: '320px' });
  });

  it('leaves the size alone at 1024 and wider', async () => {
    vi.stubGlobal('visualViewport', new FakeVisualViewport());
    const { ws } = await openLive();
    act(() => ws.open());
    const main = await screen.findByRole('main');
    act(() => setViewportWidth(1024));
    expect(main.style.height).toBe('');
  });

  it('does nothing where the browser has no visual viewport', async () => {
    vi.stubGlobal('visualViewport', undefined);
    const { ws } = await openLive();
    act(() => ws.open());
    const main = await screen.findByRole('main');
    expect(main.style.height).toBe('');
  });
});

describe('phone run page, the run actions (BR-60)', () => {
  it('TC-60.2: the header offers the same actions at 390 as at 1440', async () => {
    const header = () => {
      const h = within(screen.getByRole('main')).getByRole('heading', { level: 1 }).closest('header');
      if (!h) throw new Error('no page header');
      return within(h);
    };
    const names = () =>
      header()
        .getAllByRole('button')
        .map((b) => b.textContent);
    const { ws } = await openLive();
    act(() => ws.open());
    await screen.findByRole('group', { name: 'Terminal keys' });
    const phone = names();
    act(() => setViewportWidth(1440));
    expect(names().filter((n) => phone.includes(n))).toEqual(phone);
    expect(phone).toEqual(expect.arrayContaining(['Finish run', 'Stop session', 'Cancel run']));
  });
});
