import { act, render, screen } from '@testing-library/react';
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
      const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
      const refused = new Error('denied');
      writeText.mockRejectedValue(refused);
      render(<LiveTerminal />);
      const term = FakeXterm.latest();
      term.select('copy me');
      act(() => term.pressKey('c', { ctrlKey: true }));
      await vi.waitFor(() => expect(debug).toHaveBeenCalledWith('Could not copy the terminal selection', refused));
      debug.mockRestore();
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
