import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
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
