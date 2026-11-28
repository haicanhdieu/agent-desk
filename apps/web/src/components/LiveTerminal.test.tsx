import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeFitAddon, FakeWebglAddon, FakeXterm } from '@/test/fakeXterm';
import LiveTerminal, { type LiveTerminalHandle } from './LiveTerminal';

const encode = (s: string) => new TextEncoder().encode(s);

describe('LiveTerminal', () => {
  it('opens xterm with screen reader mode, the token theme and the fit addon size', () => {
    const onResize = vi.fn();
    FakeFitAddon.nextSize = { cols: 120, rows: 40 };
    render(<LiveTerminal onResize={onResize} />);
    const term = FakeXterm.latest();
    expect(term.options.screenReaderMode).toBe(true);
    expect(term.options.disableStdin).toBe(false);
    expect(term.options.theme).toEqual(expect.any(Object));
    expect(screen.getByRole('group', { name: 'Claude Code terminal' })).toContainElement(term.element ?? null);
    expect(onResize).toHaveBeenLastCalledWith({ cols: 120, rows: 40 });
  });

  it('a terminal mounted hidden sends no resize', () => {
    const onResize = vi.fn();
    FakeXterm.hostSize = { width: 0, height: 0 };
    render(<LiveTerminal onResize={onResize} />);
    expect(onResize).not.toHaveBeenCalled();
  });

  it('renders with WebGL, which draws the box and block glyphs Claude Code prints itself', () => {
    render(<LiveTerminal />);
    expect(FakeXterm.latest().addons.some((a) => a instanceof FakeWebglAddon)).toBe(true);
  });

  it('falls back to the DOM renderer when the WebGL context is lost', () => {
    render(<LiveTerminal />);
    const webgl = FakeXterm.latest().addons.find((a) => a instanceof FakeWebglAddon);
    expect(webgl).toBeInstanceOf(FakeWebglAddon);
    act(() => (webgl as FakeWebglAddon).loseContext());
    expect((webgl as FakeWebglAddon).disposed).toBe(true);
  });

  it('keeps working on the DOM renderer when WebGL cannot start', () => {
    FakeWebglAddon.failOnActivate = true;
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const ref = createRef<LiveTerminalHandle>();
    render(<LiveTerminal ref={ref} />);
    act(() => ref.current?.write('still here'));
    expect(FakeXterm.latest().written()).toBe('still here');
    // The fallback is logged, not silent.
    expect(debug).toHaveBeenCalledWith('WebGL renderer unavailable, using the DOM renderer', expect.any(Error));
    debug.mockRestore();
  });

  it('write() puts bytes and text into the terminal', () => {
    const ref = createRef<LiveTerminalHandle>();
    render(<LiveTerminal ref={ref} />);
    act(() => {
      ref.current?.write(encode('héllo '));
      ref.current?.write('world');
    });
    const term = FakeXterm.latest();
    expect(typeof term.writes[0]).not.toBe('string');
    expect(term.written()).toBe('héllo world');
  });

  it('passes typed input to onData', () => {
    const onData = vi.fn();
    render(<LiveTerminal onData={onData} />);
    act(() => FakeXterm.latest().type('ls\r'));
    expect(onData).toHaveBeenCalledWith('ls\r');
  });

  it('Enter submits with a carriage return', () => {
    const onData = vi.fn();
    render(<LiveTerminal onData={onData} />);
    act(() => FakeXterm.latest().pressEnter());
    expect(onData).toHaveBeenCalledOnce();
    expect(onData).toHaveBeenCalledWith('\r');
  });

  it('Shift+Enter sends ESC CR (a newline for Claude Code, not a submit) exactly once', () => {
    const onData = vi.fn();
    render(<LiveTerminal onData={onData} />);
    let event: KeyboardEvent | undefined;
    act(() => {
      event = FakeXterm.latest().pressEnter({ shiftKey: true });
    });
    expect(onData).toHaveBeenCalledOnce();
    expect(onData).toHaveBeenCalledWith('\x1b\r');
    expect(event?.defaultPrevented).toBe(true);
  });

  describe('copying the selection', () => {
    const writeText = vi.fn<(text: string) => Promise<void>>();
    beforeEach(() => {
      writeText.mockReset().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    });
    afterEach(() => {
      Reflect.deleteProperty(navigator, 'clipboard');
    });

    it('Ctrl+C with a selection copies it to the clipboard and does not send ETX', () => {
      const onData = vi.fn();
      render(<LiveTerminal onData={onData} />);
      const term = FakeXterm.latest();
      term.select('copy me');
      let event: KeyboardEvent | undefined;
      act(() => {
        event = term.pressKey('c', { ctrlKey: true });
      });
      expect(writeText).toHaveBeenCalledExactlyOnceWith('copy me');
      expect(onData).not.toHaveBeenCalled();
      expect(event?.defaultPrevented).toBe(true);
    });

    it('a second Ctrl+C after a copy is the interrupt again: the copy clears the selection', async () => {
      const onData = vi.fn();
      render(<LiveTerminal onData={onData} />);
      const term = FakeXterm.latest();
      term.select('copy me');
      act(() => term.pressKey('c', { ctrlKey: true }));
      await vi.waitFor(() => expect(term.hasSelection()).toBe(false));
      act(() => term.pressKey('c', { ctrlKey: true }));
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(onData).toHaveBeenCalledExactlyOnceWith('\x03');
    });

    it('Cmd+C with a selection copies it to the clipboard', () => {
      const onData = vi.fn();
      render(<LiveTerminal onData={onData} />);
      const term = FakeXterm.latest();
      term.select('copy me');
      act(() => term.pressKey('c', { metaKey: true }));
      expect(writeText).toHaveBeenCalledExactlyOnceWith('copy me');
      expect(onData).not.toHaveBeenCalled();
    });

    it('Ctrl+C with no selection still sends ETX (the interrupt) and copies nothing', () => {
      const onData = vi.fn();
      render(<LiveTerminal onData={onData} />);
      act(() => FakeXterm.latest().pressKey('c', { ctrlKey: true }));
      expect(onData).toHaveBeenCalledExactlyOnceWith('\x03');
      expect(writeText).not.toHaveBeenCalled();
    });

    it('read-only: Ctrl+C with a selection copies it', () => {
      render(<LiveTerminal readOnly initial="done" />);
      const term = FakeXterm.latest();
      term.select('done');
      act(() => term.pressKey('c', { ctrlKey: true }));
      expect(writeText).toHaveBeenCalledExactlyOnceWith('done');
    });

    it('a refused clipboard write is logged, not thrown', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const refused = new Error('denied');
      writeText.mockRejectedValue(refused);
      render(<LiveTerminal />);
      const term = FakeXterm.latest();
      term.select('copy me');
      act(() => term.pressKey('c', { ctrlKey: true }));
      await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('Could not copy the terminal selection', refused));
      warn.mockRestore();
    });

    it('Shift+Ctrl+C is not a copy key: it reaches xterm as before', () => {
      const onData = vi.fn();
      render(<LiveTerminal onData={onData} />);
      const term = FakeXterm.latest();
      term.select('copy me');
      act(() => term.pressKey('c', { ctrlKey: true, shiftKey: true }));
      expect(writeText).not.toHaveBeenCalled();
      expect(onData).toHaveBeenCalledExactlyOnceWith('\x03');
    });

    it('without the clipboard API the key is left to the browser copy event', () => {
      Reflect.deleteProperty(navigator, 'clipboard');
      const onData = vi.fn();
      render(<LiveTerminal onData={onData} />);
      const term = FakeXterm.latest();
      term.select('copy me');
      let event: KeyboardEvent | undefined;
      act(() => {
        event = term.pressKey('c', { ctrlKey: true });
      });
      expect(onData).not.toHaveBeenCalled();
      expect(event?.defaultPrevented).toBe(false);
    });
  });

  // Claude Code turns on mouse reporting and copies a selection itself: it prints OSC 52 (`ESC ] 52 ; c ; <base64> BEL`),
  // which xterm ignores unless something handles it. The handler gets the text after `52;`.
  describe('the clipboard sequence (OSC 52)', () => {
    const writeText = vi.fn<(text: string) => Promise<void>>();
    const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
    beforeEach(() => {
      writeText.mockReset().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    });
    afterEach(() => {
      Reflect.deleteProperty(navigator, 'clipboard');
      vi.restoreAllMocks();
    });
    // The write needs a user gesture a moment before: a press inside the terminal, released anywhere (a selection).
    const pointerUp = () => {
      fireEvent.pointerDown(screen.getByRole('group'));
      fireEvent.pointerUp(screen.getByRole('group'));
    };

    it('copies the text the program sets to the clipboard, decoded as UTF-8', () => {
      render(<LiveTerminal />);
      pointerUp();
      FakeXterm.latest().osc(52, `c;${b64('héllo ✻ wörld')}`);
      expect(writeText).toHaveBeenCalledExactlyOnceWith('héllo ✻ wörld');
    });

    it('accepts any selection parameter, including none (what tmux forwards)', () => {
      render(<LiveTerminal />);
      const term = FakeXterm.latest();
      pointerUp();
      term.osc(52, `;${b64('one')}`);
      term.osc(52, `pc;${b64('two')}`);
      expect(writeText.mock.calls).toEqual([['one'], ['two']]);
    });

    it('never answers the read query: a pod cannot read the host clipboard', () => {
      const onData = vi.fn();
      render(<LiveTerminal onData={onData} />);
      pointerUp();
      FakeXterm.latest().osc(52, 'c;?');
      expect(writeText).not.toHaveBeenCalled();
      expect(onData).not.toHaveBeenCalled();
    });

    it('ignores an empty payload and invalid base64 without throwing', () => {
      render(<LiveTerminal />);
      const term = FakeXterm.latest();
      pointerUp();
      term.osc(52, 'c;');
      term.osc(52, 'c;!!not base64!!');
      term.osc(52, 'c');
      expect(writeText).not.toHaveBeenCalled();
    });

    it('read-only: a finished run never writes the clipboard', () => {
      render(<LiveTerminal readOnly initial="done" />);
      pointerUp();
      FakeXterm.latest().osc(52, `c;${b64('replayed')}`);
      expect(writeText).not.toHaveBeenCalled();
    });

    it('does nothing after unmount', () => {
      const { unmount } = render(<LiveTerminal />);
      const term = FakeXterm.latest();
      unmount();
      term.osc(52, `c;${b64('late')}`);
      expect(writeText).not.toHaveBeenCalled();
    });

    it('a refused clipboard write is logged, not thrown', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const refused = new Error('denied');
      writeText.mockRejectedValue(refused);
      render(<LiveTerminal />);
      pointerUp();
      FakeXterm.latest().osc(52, `c;${b64('x')}`);
      await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('Could not copy the text the program set', refused));
      warn.mockRestore();
    });

    it('without the clipboard API it does nothing', () => {
      Reflect.deleteProperty(navigator, 'clipboard');
      render(<LiveTerminal />);
      pointerUp();
      expect(() => FakeXterm.latest().osc(52, `c;${b64('x')}`)).not.toThrow();
    });

    it('writes nothing when no user gesture came first: pod output cannot set the clipboard alone', () => {
      render(<LiveTerminal />);
      const term = FakeXterm.latest();
      term.osc(52, `c;${b64('injected')}`);
      expect(writeText).not.toHaveBeenCalled();
    });

    it('Ctrl+C is the interrupt sent to the pod, not a gesture: it does not open the window', () => {
      render(<LiveTerminal />);
      fireEvent.keyDown(screen.getByRole('group'), { key: 'c', ctrlKey: true });
      fireEvent.keyDown(screen.getByRole('group'), { key: 'a' });
      FakeXterm.latest().osc(52, `c;${b64('answer to the interrupt')}`);
      expect(writeText).not.toHaveBeenCalled();
    });

    it('a selection released outside the terminal still opens the window', () => {
      render(<LiveTerminal />);
      fireEvent.pointerDown(screen.getByRole('group'));
      fireEvent.pointerUp(document.body);
      FakeXterm.latest().osc(52, `c;${b64('dragged out')}`);
      expect(writeText).toHaveBeenCalledExactlyOnceWith('dragged out');
    });

    it('a press that did not start in the terminal is not a gesture', () => {
      render(<LiveTerminal />);
      fireEvent.pointerUp(document.body);
      FakeXterm.latest().osc(52, `c;${b64('elsewhere')}`);
      expect(writeText).not.toHaveBeenCalled();
    });

    it('a cancelled press is not a gesture: a later release elsewhere does not open the window', () => {
      render(<LiveTerminal />);
      fireEvent.pointerDown(screen.getByRole('group'));
      fireEvent.pointerCancel(screen.getByRole('group'));
      fireEvent.pointerUp(document.body);
      FakeXterm.latest().osc(52, `c;${b64('after a cancel')}`);
      expect(writeText).not.toHaveBeenCalled();
    });

    it('a newer press elsewhere supersedes one in the terminal that never ended', () => {
      render(<LiveTerminal />);
      fireEvent.pointerDown(screen.getByRole('group'));
      fireEvent.pointerDown(document.body);
      fireEvent.pointerUp(document.body);
      FakeXterm.latest().osc(52, `c;${b64('unrelated click')}`);
      expect(writeText).not.toHaveBeenCalled();
    });

    it('one press opens the window once: a later release with no press does not renew it', () => {
      let now = 10_000;
      vi.spyOn(performance, 'now').mockImplementation(() => now);
      render(<LiveTerminal />);
      pointerUp();
      now += 5_000;
      fireEvent.pointerUp(document.body);
      FakeXterm.latest().osc(52, `c;${b64('stale window')}`);
      expect(writeText).not.toHaveBeenCalled();
    });

    it('writes nothing once the gesture window has passed', () => {
      let now = 10_000;
      vi.spyOn(performance, 'now').mockImplementation(() => now);
      render(<LiveTerminal />);
      const term = FakeXterm.latest();
      pointerUp();
      now += 1_900;
      term.osc(52, `c;${b64('in time')}`);
      expect(writeText).toHaveBeenCalledExactlyOnceWith('in time');
      now += 200;
      term.osc(52, `c;${b64('too late')}`);
      expect(writeText).toHaveBeenCalledTimes(1);
    });

    it('stops listening for gestures after unmount', () => {
      const { unmount } = render(<LiveTerminal />);
      const removeHost = vi.spyOn(screen.getByRole('group'), 'removeEventListener');
      const removeDoc = vi.spyOn(document, 'removeEventListener');
      unmount();
      const gesture = (calls: unknown[][]) =>
        calls
          .filter(([type]) => type === 'pointerdown' || type === 'pointerup' || type === 'pointercancel')
          .map(([type, , options]) => [type, options]);
      expect(gesture(removeDoc.mock.calls)).toEqual([
        ['pointerdown', { capture: true }],
        ['pointercancel', { capture: true }],
        ['pointerup', { capture: true }],
      ]);
      expect(gesture(removeHost.mock.calls)).toEqual([]);
      expect(removeHost.mock.calls.some(([type]) => type === 'keydown')).toBe(false);
    });
  });

  describe('sendKey (the extra keys)', () => {
    it('one press is exactly one onData with the key bytes', () => {
      const onData = vi.fn();
      const ref = createRef<LiveTerminalHandle>();
      render(<LiveTerminal ref={ref} onData={onData} />);
      act(() => ref.current?.sendKey('tab'));
      expect(onData).toHaveBeenCalledTimes(1);
      expect(onData).toHaveBeenCalledWith('\t');
    });

    it('the arrows follow the terminal cursor mode', () => {
      const onData = vi.fn();
      const ref = createRef<LiveTerminalHandle>();
      render(<LiveTerminal ref={ref} onData={onData} />);
      act(() => ref.current?.sendKey('up'));
      FakeXterm.latest().setApplicationCursor(true);
      act(() => ref.current?.sendKey('up'));
      expect(onData.mock.calls).toEqual([['\x1b[A'], ['\x1bOA']]);
    });

    it('sends nothing on a read-only terminal', () => {
      const onData = vi.fn();
      const ref = createRef<LiveTerminalHandle>();
      render(<LiveTerminal ref={ref} readOnly onData={onData} />);
      act(() => ref.current?.sendKey('enter'));
      expect(onData).not.toHaveBeenCalled();
    });

    it('Ctrl-C is one interrupt even with text selected, and the selection is not copied', () => {
      const onData = vi.fn();
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
      const ref = createRef<LiveTerminalHandle>();
      render(<LiveTerminal ref={ref} onData={onData} />);
      FakeXterm.latest().select('some text');
      act(() => ref.current?.sendKey('ctrl-c'));
      expect(onData.mock.calls).toEqual([['\x03']]);
      expect(writeText).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('does nothing else: it does not take focus', () => {
      const ref = createRef<LiveTerminalHandle>();
      render(<LiveTerminal ref={ref} onData={vi.fn()} />);
      act(() => ref.current?.sendKey('esc'));
      expect(FakeXterm.latest().focusCalls).toBe(0);
    });
  });

  describe('refit', () => {
    /** Renders, then returns a function that fires the host's ResizeObserver (the animation frame runs at once). */
    function renderWithObserver() {
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
      render(<LiveTerminal />);
      const term = FakeXterm.latest();
      const fit = term.addons.find((a): a is FakeFitAddon => a instanceof FakeFitAddon);
      if (!fit) throw new Error('no fit addon');
      return { term, fit: vi.spyOn(fit, 'fit'), notify: () => act(notify) };
    }
    afterEach(() => vi.unstubAllGlobals());

    it('does nothing while the host has no size (hidden), and fits again once it has one', () => {
      const { term, fit, notify } = renderWithObserver();
      fit.mockClear();
      // A hidden host: the real fit addon still proposes a tiny size, which must not be applied.
      FakeXterm.hostSize = { width: 0, height: 0 };
      FakeFitAddon.nextSize = { cols: 2, rows: 1 };
      notify();
      expect(fit).not.toHaveBeenCalled();
      expect(term.cols).toBe(80);
      FakeXterm.hostSize = { width: 390, height: 500 };
      FakeFitAddon.nextSize = { cols: 40, rows: 20 };
      notify();
      expect(fit).toHaveBeenCalledTimes(1);
      expect(term.cols).toBe(40);
    });

    it('does nothing when the fit addon proposes no size', () => {
      const { fit, notify } = renderWithObserver();
      fit.mockClear();
      FakeFitAddon.hasSize = false;
      notify();
      expect(fit).not.toHaveBeenCalled();
    });
  });

  it('read-only: Shift+Enter sends nothing', () => {
    const onData = vi.fn();
    render(<LiveTerminal readOnly onData={onData} />);
    act(() => FakeXterm.latest().pressEnter({ shiftKey: true }));
    expect(onData).not.toHaveBeenCalled();
  });

  it('read-only: stdin disabled, input never reaches onData, `initial` written once', () => {
    const onData = vi.fn();
    const { rerender } = render(<LiveTerminal readOnly initial={'one\r\ntwo'} onData={onData} />);
    const term = FakeXterm.latest();
    expect(term.options.disableStdin).toBe(true);
    act(() => term.type('rm -rf /\r'));
    expect(onData).not.toHaveBeenCalled();
    rerender(<LiveTerminal readOnly initial={'one\r\ntwo\r\nthree'} onData={onData} />);
    expect(term.writes).toEqual(['one\r\ntwo']);
    expect(FakeXterm.instances).toHaveLength(1);
  });

  it('written text stays text', () => {
    render(<LiveTerminal readOnly initial="<img src=x onerror=alert(1)>" />);
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('disposes xterm on unmount', () => {
    const ref = createRef<LiveTerminalHandle>();
    const { unmount } = render(<LiveTerminal ref={ref} />);
    const term = FakeXterm.latest();
    unmount();
    expect(term.disposed).toBe(true);
  });
});
