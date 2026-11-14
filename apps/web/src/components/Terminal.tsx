import { useEffect, useRef, type ReactNode } from 'react';
import styles from './Terminal.module.css';

export type TermTone =
  'dim' | 'bold' | 'cyan' | 'green' | 'red' | 'yellow' | 'magenta' | 'accent' | 'add' | 'del' | 'dot' | 'dotw';
export type TermSpan = { text: string; tone?: TermTone };
export type TermLine = TermSpan[];

const toneClass: Record<TermTone, string> = {
  dim: styles.tDim,
  bold: styles.tB,
  cyan: styles.tCy,
  green: styles.tGr,
  red: styles.tRd,
  yellow: styles.tYl,
  magenta: styles.tMag,
  accent: styles.tAcc,
  add: styles.tAdd,
  del: styles.tDel,
  dot: styles.tDot,
  dotw: styles.tDotw,
};

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(' ');

export interface TerminalProps {
  lines: TermLine[];
  cursor?: boolean;
  anchor?: 'bottom' | 'top';
  dimmed?: boolean;
  /** A log to read in full: long lines wrap, the pane scrolls (keyboard too) and opens at the end. */
  scrollable?: boolean;
  'aria-label'?: string;
}

/** Read-only transcript. Long lines are clipped (`white-space: pre`) unless `scrollable`. */
export function Terminal({
  lines,
  cursor,
  anchor = 'bottom',
  dimmed,
  scrollable,
  'aria-label': label = 'Claude Code terminal',
}: TerminalProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (scrollable && el) el.scrollTop = el.scrollHeight;
  }, [scrollable, lines.length]);
  const rows = cursor && lines.length === 0 ? [[]] : lines;
  // The cursor sits on the input prompt row (a lone "> ") when there is one, otherwise on the last row.
  let last = rows.length - 1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].length === 1 && rows[i][0].text.trim() === '>') {
      last = i;
      break;
    }
  }
  return (
    <div
      ref={ref}
      className={cx(styles.term, anchor === 'top' && styles.top, dimmed && styles.dimmed, scrollable && styles.scroll)}
      {...(scrollable && { tabIndex: 0 })}
      role="log"
      aria-live="off"
      aria-label={label}
    >
      {rows.map((line, i) => (
        <div key={i} className={styles.line}>
          {line.map((s, j) => (
            <span key={j} className={s.tone ? toneClass[s.tone] : undefined}>
              {s.text}
            </span>
          ))}
          {cursor && i === last && <span className={styles.cursor} />}
        </div>
      ))}
    </div>
  );
}

export interface TerminalPaneProps {
  notice?: ReactNode;
  bar: ReactNode;
  overlay?: ReactNode;
  children?: ReactNode;
}

export function TerminalPane({ notice, bar, overlay, children }: TerminalPaneProps) {
  return (
    <section className={styles.termwrap} aria-label="Terminal">
      {notice}
      {bar}
      <div className={styles.body}>
        {children}
        {overlay && (
          <>
            <div className={styles.scrim} />
            {overlay}
          </>
        )}
      </div>
    </section>
  );
}

export interface TerminalPlaceholderProps {
  title: string;
  body: ReactNode;
  children?: ReactNode;
}

export function TerminalPlaceholder({ title, body, children }: TerminalPlaceholderProps) {
  return (
    <div className={styles.placeholder}>
      <div className={styles.phCol}>
        <div className={styles.phHead}>
          <h2>{title}</h2>
          {body ? <p>{body}</p> : null}
        </div>
        {children}
      </div>
    </div>
  );
}
