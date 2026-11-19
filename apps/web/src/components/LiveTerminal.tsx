import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal as XTerm } from '@xterm/xterm';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import styles from './LiveTerminal.module.css';
import { terminalFont, terminalTheme } from './terminalTheme';

// The live terminal (spec §5.3): xterm with the fit addon and the token theme, screen reader mode on. It knows
// nothing about sockets: output comes in through the `write` handle, keystrokes go out through `onData` and the size
// in cells through `onResize`. Loaded with React.lazy (default export) so xterm only downloads on run detail.

export interface LiveTerminalHandle {
  write(data: Uint8Array | string): void;
}

export interface TerminalSize {
  cols: number;
  rows: number;
}

export interface LiveTerminalProps {
  /** Keystrokes (never called while `readOnly`). */
  onData?(data: string): void;
  /** The size in cells: once after opening, then whenever the container resize changes it. */
  onResize?(size: TerminalSize): void;
  /** Written once when the terminal opens (a finished run's scrollback); later changes are ignored. */
  initial?: string;
  /** No input (stdin disabled): a finished run's scrollback. Fixed for the component's lifetime. */
  readOnly?: boolean;
  'aria-label'?: string;
  ref?: Ref<LiveTerminalHandle>;
}

/** Lines kept above the screen (the stored scrollback is capped to the same count). */
const SCROLLBACK_LINES = 5000;

/** Ctrl+C or Cmd+C, with no other modifier. */
function isCopyKey(event: KeyboardEvent): boolean {
  return event.key.toLowerCase() === 'c' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
}

export default function LiveTerminal({
  onData,
  onResize,
  initial,
  readOnly = false,
  'aria-label': label = 'Claude Code terminal',
  ref,
}: LiveTerminalProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  // The terminal is created once; these hold the props it reads later.
  const callbacks = useRef({ onData, onResize });
  const opening = useRef({ initial, readOnly });

  useEffect(() => {
    callbacks.current = { onData, onResize };
  });

  useImperativeHandle(ref, () => ({ write: (data) => termRef.current?.write(data) }), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const { initial: text, readOnly: noInput } = opening.current;
    const term = new XTerm({
      theme: terminalTheme(host),
      ...terminalFont(host),
      screenReaderMode: true,
      disableStdin: noInput,
      cursorBlink: !noInput,
      scrollback: SCROLLBACK_LINES,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    // The DOM renderer draws every glyph with the font, so the block and box characters Claude Code prints (its logo,
    // frames and bullets) come out as font fallbacks. WebGL draws them itself; where it cannot start, or loses its
    // context, the DOM renderer stays.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch (err) {
      // No WebGL here (an expected case: old GPUs, blocked contexts): keep the DOM renderer.
      console.debug('WebGL renderer unavailable, using the DOM renderer', err);
    }

    // xterm sends the same CR for Enter and Shift+Enter, so a multi-line prompt could never be typed. Send ESC CR (what
    // Alt+Enter sends) for Shift+Enter instead: Claude Code reads it as "insert a newline" rather than "submit". Every
    // phase of the key (keydown, keypress, keyup) is swallowed so xterm does not also send a CR.
    //
    // Ctrl+C is also the interrupt: xterm turns it into ETX and cancels the key, so the browser never gets to copy. With
    // a selection, Ctrl+C or Cmd+C copies it instead (what a terminal emulator does) and nothing is sent; with none,
    // Ctrl+C stays the interrupt. A page without the clipboard API leaves the key to the browser copy event, which
    // xterm answers with the selection.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && isCopyKey(event) && term.hasSelection()) {
        if (navigator.clipboard) {
          event.preventDefault();
          navigator.clipboard.writeText(term.getSelection()).catch((err: unknown) => {
            console.debug('Could not copy the terminal selection', err);
          });
        }
        return false;
      }
      if (event.key !== 'Enter' || !event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return true;
      if (event.type === 'keydown') {
        event.preventDefault();
        if (!noInput) callbacks.current.onData?.('\x1b\r');
      }
      return false;
    });

    const report = () => callbacks.current.onResize?.({ cols: term.cols, rows: term.rows });
    const subscriptions = [
      term.onResize(report),
      term.onData((data) => {
        if (!noInput) callbacks.current.onData?.(data);
      }),
    ];
    const refit = () => {
      // The container may have no size yet (hidden, or not laid out); the next resize fits it.
      if (fit.proposeDimensions()) fit.fit();
    };
    refit();
    report();
    if (text) term.write(text);

    let frame = 0;
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(refit);
          });
    observer?.observe(host);
    // The web font changes the cell size once it has loaded.
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) refit();
    });

    return () => {
      live = false;
      observer?.disconnect();
      cancelAnimationFrame(frame);
      for (const s of subscriptions) s.dispose();
      termRef.current = null;
      term.dispose();
    };
  }, []);

  return <div ref={hostRef} className={styles.host} role="group" aria-label={label} />;
}
